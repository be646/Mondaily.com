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
import os
import tempfile

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
API_KEY = os.environ.get("STT_API_KEY", "").strip()
MAX_BYTES = int(os.environ.get("MAX_AUDIO_BYTES", str(500 * 1024 * 1024)))

app = FastAPI(title="mondaily-stt")

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
    """Stream the audio to a temp file, enforcing the size cap."""
    fd, path = tempfile.mkstemp(suffix=".audio")
    written = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
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
