"""
Mondaily sovereign STT appliance.

A tiny, self-hosted speech-to-text service (faster-whisper) that the Mondaily API calls. FULL
SOVEREIGNTY: no third-party STT SaaS — this runs entirely on your own box. Two endpoints:

  POST /transcribe        (batch — post-call Meeting Memory)
    headers: Authorization: Bearer <STT_API_KEY>   (only if STT_API_KEY is set)
    body:    { "audio_url": "https://.../rec.ogg", "diarize": true }
    ->       { "text": "...", "segments": [ { "speaker": "Speaker", "text": "...", "start": 0.0 } ] }

  POST /caption/chunk     (live captions — see deploy/stt-appliance/LIVE_CAPTIONS_STT_CONTRACT.md)
    headers: Authorization: Bearer <STT_API_KEY>   (only if STT_API_KEY is set)
    multipart/form-data: audio=<bytes> format=<pcm_s16le|wav> sample_rate=<int>
                         session=<opaque id> seq=<int> [language=<str>] [final=<bool>]
    ->       { "text","final","language","confidence","duration_ms","seq","no_speech" }

`diarize` is accepted on /transcribe for forward-compat; this build labels every segment "Speaker"
(honest — it does NOT invent who spoke). Live captions use per-participant self-captioning, so the
chunk endpoint needs no diarization at all: the speaker is always the publisher.

Privacy: chunk audio is decoded in-memory (never written to disk) and discarded immediately. Logs are
metadata only — never transcript text, never audio bytes.
"""
from __future__ import annotations

import ipaddress
import io
import logging
import os
import socket
import tempfile
import time
import wave
from typing import Optional
from urllib.parse import urlparse

import httpx
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
API_KEY = os.environ.get("STT_API_KEY", "").strip()
MAX_BYTES = int(os.environ.get("MAX_AUDIO_BYTES", str(500 * 1024 * 1024)))
# Live-caption chunk caps — a chunk is a couple of seconds of audio, so a few MB is plenty. A larger
# body is rejected 413 before any decode work.
MAX_CHUNK_BYTES = int(os.environ.get("STT_MAX_CHUNK_BYTES", str(10 * 1024 * 1024)))
# Bounded concurrent decodes. Whisper decode is CPU-heavy; past this we shed load (503) rather than
# thrash. Default is conservative for CPU; raise it on a GPU box.
MAX_CONCURRENCY = max(1, int(os.environ.get("STT_MAX_CONCURRENCY", "2")))
# Per-chunk decode budget. Past this the request fails 504 and the caller drops that chunk.
CHUNK_TIMEOUT_S = float(os.environ.get("STT_CHUNK_TIMEOUT_S", "15"))
TARGET_SR = 16000
# Optional comma-separated host allowlist (e.g. your egress storage host). When set, only these
# hosts may be fetched — the strongest SSRF defense. When unset, we still block private/internal IPs.
ALLOWED_HOSTS = {h.strip().lower() for h in os.environ.get("STT_ALLOWED_HOSTS", "").split(",") if h.strip()}

logger = logging.getLogger("mondaily-stt")
logging.basicConfig(level=os.environ.get("STT_LOG_LEVEL", "INFO"))

app = FastAPI(title="mondaily-stt")

# ---------------------------------------------------------------------------------------------------
# Model — loaded lazily so the module can be imported (and unit-tested with a fake model) without the
# heavy faster-whisper/ctranslate2 stack present. Set STT_SKIP_MODEL_LOAD=1 to guarantee no eager load.
# ---------------------------------------------------------------------------------------------------
_model = None


def _load_model():
    global _model
    from faster_whisper import WhisperModel  # imported lazily — see note above

    _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
    return _model


def _get_model():
    if _model is None:
        _load_model()
    return _model


if os.environ.get("STT_SKIP_MODEL_LOAD") != "1":
    # Eager-load at startup so /health readiness is honest and the first real request isn't slow.
    _load_model()

# Simple in-loop concurrency gauge. The event loop is single-threaded, so the check-and-increment
# below is atomic (no await between them); the actual decode runs in a worker thread.
_active = 0


def _check_auth(authorization: Optional[str]):
    # Fail-closed only when a key is configured; open access is allowed behind a firewall.
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": DEVICE,
        "ready": _model is not None,
        "concurrency": {"active": _active, "max": MAX_CONCURRENCY},
    }


@app.get("/ready")
def ready():
    # 200 only when the model is resident and we have a free decode slot — a clean load-balancer probe.
    if _model is None:
        return JSONResponse({"ready": False, "reason": "model_loading"}, status_code=503)
    if _active >= MAX_CONCURRENCY:
        return JSONResponse(
            {"ready": False, "reason": "overloaded", "concurrency": {"active": _active, "max": MAX_CONCURRENCY}},
            status_code=503,
        )
    return {"ready": True, "model": MODEL_NAME, "device": DEVICE, "concurrency": {"active": _active, "max": MAX_CONCURRENCY}}


# ---------------------------------------------------------------------------------------------------
# Audio decoding — pure, in-memory, unit-testable. Returns float32 mono @ 16 kHz for Whisper.
# ---------------------------------------------------------------------------------------------------
def _pcm_s16le_to_float32(data: bytes) -> np.ndarray:
    if len(data) < 2:
        raise HTTPException(status_code=422, detail="no_audio")
    # Drop a dangling odd byte rather than misalign the int16 view.
    if len(data) % 2:
        data = data[:-1]
    samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
    return samples


def _wav_to_float32(data: bytes) -> tuple[np.ndarray, int]:
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            n_channels = w.getnchannels()
            sampwidth = w.getsampwidth()
            sr = w.getframerate()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError, OSError):
        raise HTTPException(status_code=415, detail="unsupported_media_type")
    if sampwidth != 2:
        # Only 16-bit PCM WAV is supported — keeps the appliance dependency-free (no codec libs).
        raise HTTPException(status_code=415, detail="unsupported_media_type")
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if n_channels > 1:
        # Downmix to mono by averaging channels.
        samples = samples.reshape(-1, n_channels).mean(axis=1)
    return samples, sr


def _resample_to_16k(samples: np.ndarray, sr: int) -> np.ndarray:
    if sr == TARGET_SR or samples.size == 0:
        return samples
    if sr <= 0:
        raise HTTPException(status_code=400, detail="bad_request")
    # Light linear resample — good enough for speech; avoids a scipy dependency.
    duration = samples.size / float(sr)
    n_out = max(1, int(round(duration * TARGET_SR)))
    x_old = np.linspace(0.0, duration, num=samples.size, endpoint=False)
    x_new = np.linspace(0.0, duration, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)


def _prepare_audio(data: bytes, fmt: str, sample_rate: int) -> np.ndarray:
    """Decode a caption chunk to float32 mono @ 16 kHz. Raises 4xx HTTPException on bad input."""
    fmt = (fmt or "").strip().lower()
    if fmt == "pcm_s16le":
        if sample_rate <= 0:
            raise HTTPException(status_code=400, detail="bad_request: sample_rate required for pcm_s16le")
        samples = _pcm_s16le_to_float32(data)
        return _resample_to_16k(samples, sample_rate)
    if fmt == "wav":
        samples, sr = _wav_to_float32(data)
        return _resample_to_16k(samples, sr)
    # webm_opus (and anything else) is intentionally NOT decoded here: per-chunk webm fragments aren't
    # independently decodable and decoding it safely needs ffmpeg. Fail closed, honestly.
    raise HTTPException(status_code=415, detail="unsupported_media_type")


def _transcribe_samples(model, samples: np.ndarray, language: str | None):
    """Run the model over an in-memory float32 array. Returns (text, language, confidence)."""
    kwargs = {"vad_filter": True, "beam_size": 1}
    if language:
        kwargs["language"] = language
    segments, info = model.transcribe(samples, **kwargs)
    parts: list[str] = []
    logprobs: list[float] = []
    for seg in segments:
        text = (getattr(seg, "text", "") or "").strip()
        if not text:
            continue
        parts.append(text)
        alp = getattr(seg, "avg_logprob", None)
        if isinstance(alp, (int, float)):
            logprobs.append(float(alp))
    text = " ".join(parts).strip()
    lang = getattr(info, "language", None) or language or None
    confidence = None
    if logprobs:
        confidence = round(float(np.clip(np.mean(np.exp(logprobs)), 0.0, 1.0)), 2)
    return text, lang, confidence


@app.post("/caption/chunk")
async def caption_chunk(
    audio: UploadFile = File(...),
    format: str = Form(...),
    sample_rate: int = Form(0),
    session: str = Form(""),
    seq: int = Form(0),
    language: Optional[str] = Form(None),
    final: bool = Form(False),
    authorization: Optional[str] = Header(default=None),
):
    global _active
    _check_auth(authorization)

    # Payload guard — bounded read so an oversized body can't exhaust memory before we reject it.
    data = await audio.read(MAX_CHUNK_BYTES + 1)
    if len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(status_code=413, detail="payload_too_large")

    # Decode BEFORE taking a concurrency slot — cheap, and lets bad codecs fail fast (415).
    samples = _prepare_audio(data, format, sample_rate)
    duration_ms = int(round(samples.size / float(TARGET_SR) * 1000)) if samples.size else 0

    # Empty / all-silence after VAD-friendly trimming → honest no_speech, not an error.
    if samples.size == 0:
        _log(session, seq, format, duration_ms, 0.0, "no_speech")
        return {"text": "", "final": final, "language": language, "confidence": None,
                "duration_ms": duration_ms, "seq": seq, "no_speech": True}

    if _active >= MAX_CONCURRENCY:
        raise HTTPException(status_code=503, detail="overloaded")

    started = time.monotonic()
    _active += 1
    try:
        text, lang, confidence = await _decode_with_timeout(samples, language)
    except TimeoutError:
        _log(session, seq, format, duration_ms, (time.monotonic() - started) * 1000, "timeout")
        raise HTTPException(status_code=504, detail="timeout")
    finally:
        _active -= 1

    latency_ms = (time.monotonic() - started) * 1000
    no_speech = len(text) == 0
    _log(session, seq, format, duration_ms, latency_ms, "no_speech" if no_speech else "ok")
    return {
        "text": text,
        "final": final,
        "language": lang,
        "confidence": confidence,
        "duration_ms": duration_ms,
        "seq": seq,
        "no_speech": no_speech,
    }


async def _decode_with_timeout(samples: np.ndarray, language: str | None):
    """Run the blocking decode in a worker thread with a hard timeout (raises TimeoutError on
    expiry). `abandon_on_cancel=True` lets the request return 504 promptly even though the (now
    orphaned) decode thread can't be interrupted — the safety valve is about not hanging the caller."""
    from anyio import fail_after, to_thread

    with fail_after(CHUNK_TIMEOUT_S):
        return await to_thread.run_sync(
            _transcribe_samples, _get_model(), samples, language, abandon_on_cancel=True
        )


def _log(session: str, seq: int, fmt: str, duration_ms: int, latency_ms: float, status: str):
    # METADATA ONLY — never transcript text, never audio bytes.
    logger.info(
        "caption_chunk session=%s seq=%s format=%s duration_ms=%s latency_ms=%.0f status=%s",
        session or "-", seq, fmt, duration_ms, latency_ms, status,
    )


# ---------------------------------------------------------------------------------------------------
# Batch transcription (unchanged behavior) — post-call Meeting Memory.
# ---------------------------------------------------------------------------------------------------
def _validate_url(url: str) -> None:
    """SSRF guard: only http(s), only allowlisted hosts (if configured), and NEVER an address that
    resolves to a private / loopback / link-local / reserved range (blocks cloud metadata at
    169.254.169.254, localhost, RFC-1918, etc.). Defense in depth — the caller is trusted, but the
    appliance must not be an open proxy into the internal network."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(status_code=400, detail="audio_url must be http(s) with a host")
    host = p.hostname.lower()
    if ALLOWED_HOSTS and host not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="audio_url host not allowed")
    try:
        infos = socket.getaddrinfo(host, p.port or (443 if p.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="audio_url host does not resolve")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise HTTPException(status_code=400, detail="audio_url resolves to a disallowed address")


async def _download(url: str) -> str:
    """Stream the audio to a temp file, enforcing the size cap. Redirects are DISABLED so a 30x can't
    bounce a validated host to an internal one (recording URLs are direct/presigned)."""
    _validate_url(url)
    fd, path = tempfile.mkstemp(suffix=".audio")
    written = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async with httpx.AsyncClient(timeout=120, follow_redirects=False) as client:
                async with client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        raise HTTPException(status_code=400, detail=f"could not fetch audio ({resp.status_code})")
                    async for chunk in resp.aiter_bytes():
                        written += len(chunk)
                        if written > MAX_BYTES:
                            raise HTTPException(status_code=413, detail="audio too large")
                        f.write(chunk)
        return path
    except Exception:
        os.path.exists(path) and os.remove(path)
        raise


@app.post("/transcribe")
async def transcribe(payload: dict, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    audio_url = (payload or {}).get("audio_url")
    if not audio_url:
        raise HTTPException(status_code=400, detail="audio_url required")

    path = await _download(audio_url)
    try:
        # vad_filter trims long silences so timestamps + cost stay tight.
        segments, _info = _get_model().transcribe(path, vad_filter=True)
        out = []
        parts = []
        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            out.append({"speaker": "Speaker", "text": text, "start": round(seg.start, 2)})
            parts.append(text)
        return JSONResponse({"text": " ".join(parts), "segments": out})
    finally:
        os.path.exists(path) and os.remove(path)
