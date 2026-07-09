"""
Mondaily sovereign STT appliance.

A tiny, self-hosted speech-to-text service (faster-whisper) that the Mondaily API calls to turn a
recorded call's audio file into a transcript. FULL SOVEREIGNTY: no third-party STT SaaS — this runs
entirely on your own box. The Mondaily API integration (packages/api/src/lib/livekit.ts) expects:

    POST /transcribe
      headers: Authorization: Bearer <STT_API_KEY>   (only if STT_API_KEY is set)
      body:    { "audio_url": "https://.../rec.ogg", "diarize": true }
      ->       { "text": "...", "segments": [ { "speaker": "Speaker", "text": "...", "start": 0.0 } ] }

`diarize` is accepted for forward-compat; this build labels every segment "Speaker" (honest — it
does NOT invent who spoke). See the README for adding real diarization (pyannote) later; the API's
mapSttResponse already handles both the single-speaker and diarized shapes.
"""
import ipaddress
import os
import socket
import tempfile
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
API_KEY = os.environ.get("STT_API_KEY", "").strip()
MAX_BYTES = int(os.environ.get("MAX_AUDIO_BYTES", str(500 * 1024 * 1024)))
# Optional comma-separated host allowlist (e.g. your egress storage host). When set, only these
# hosts may be fetched — the strongest SSRF defense. When unset, we still block private/internal IPs.
ALLOWED_HOSTS = {h.strip().lower() for h in os.environ.get("STT_ALLOWED_HOSTS", "").split(",") if h.strip()}

app = FastAPI(title="mondaily-stt")


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

# Load the model once at startup (downloaded + cached in the mounted volume on first run).
_model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


def _check_auth(authorization: str | None):
    # Fail-closed only when a key is configured; open access is allowed behind a firewall.
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="invalid token")


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
async def transcribe(payload: dict, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    audio_url = (payload or {}).get("audio_url")
    if not audio_url:
        raise HTTPException(status_code=400, detail="audio_url required")

    path = await _download(audio_url)
    try:
        # vad_filter trims long silences so timestamps + cost stay tight.
        segments, _info = _model.transcribe(path, vad_filter=True)
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
