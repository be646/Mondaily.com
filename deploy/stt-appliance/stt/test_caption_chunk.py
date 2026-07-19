"""
Lightweight tests for POST /caption/chunk.

These run WITHOUT the heavy faster-whisper/ctranslate2 model: we set STT_SKIP_MODEL_LOAD=1 so the
module imports without loading a model, then inject a fake model. They exercise the endpoint's
contract (shapes, status codes, auth, size/concurrency guards, silence handling) and the pure audio
decoders. Real acoustic accuracy still needs the actual model on appliance runtime — see the module
docstring and the report.

Run:  cd deploy/stt-appliance/stt && STT_SKIP_MODEL_LOAD=1 pytest -q
"""
import io
import os
import struct
import wave

os.environ["STT_SKIP_MODEL_LOAD"] = "1"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402


class _FakeSegment:
    def __init__(self, text, avg_logprob=-0.2):
        self.text = text
        self.avg_logprob = avg_logprob


class _FakeInfo:
    language = "en"


class FakeModel:
    """Stand-in for WhisperModel: returns a fixed transcript for non-empty audio, nothing for silence."""

    def __init__(self, text="hello there this is a test"):
        self.text = text
        self.calls = 0

    def transcribe(self, audio, **kwargs):
        self.calls += 1
        # Treat near-silent input (very low energy) as no speech.
        if isinstance(audio, np.ndarray) and float(np.abs(audio).mean()) < 1e-4:
            return iter([]), _FakeInfo()
        return iter([_FakeSegment(self.text)]), _FakeInfo()


def _pcm_bytes(seconds=3.0, sr=16000, freq=220.0, amp=0.2):
    t = np.arange(int(seconds * sr)) / sr
    sig = (np.sin(2 * np.pi * freq * t) * amp * 32767).astype("<i2")
    return sig.tobytes()


def _silence_pcm_bytes(seconds=3.0, sr=16000):
    return np.zeros(int(seconds * sr), dtype="<i2").tobytes()


def _wav_bytes(seconds=3.0, sr=16000, freq=220.0, amp=0.2, channels=1):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sr)
        t = np.arange(int(seconds * sr)) / sr
        sig = (np.sin(2 * np.pi * freq * t) * amp * 32767).astype("<i2")
        if channels > 1:
            sig = np.repeat(sig, channels)
        w.writeframes(sig.tobytes())
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    # Fresh fake model + no auth + clean concurrency gauge for each test.
    server._model = FakeModel()
    server._active = 0
    monkeypatch.setattr(server, "API_KEY", "")
    yield


@pytest.fixture
def client():
    return TestClient(server.app)


def _post(client, data_bytes, fmt="pcm_s16le", sample_rate=16000, seq=1, headers=None, session="s1"):
    files = {"audio": ("chunk.bin", data_bytes, "application/octet-stream")}
    form = {"format": fmt, "sample_rate": str(sample_rate), "session": session, "seq": str(seq)}
    return client.post("/caption/chunk", files=files, data=form, headers=headers or {})


# --- contract / shape -------------------------------------------------------------------------------
def test_valid_pcm_chunk_returns_expected_shape(client):
    r = _post(client, _pcm_bytes(3.0), seq=7)
    assert r.status_code == 200
    j = r.json()
    assert set(j) == {"text", "final", "language", "confidence", "duration_ms", "seq", "no_speech"}
    assert j["text"] == "hello there this is a test"
    assert j["no_speech"] is False
    assert j["seq"] == 7
    assert j["language"] == "en"
    assert 0.0 <= j["confidence"] <= 1.0
    assert 2900 <= j["duration_ms"] <= 3100


def test_valid_wav_chunk(client):
    r = _post(client, _wav_bytes(2.0), fmt="wav", sample_rate=0, seq=2)
    assert r.status_code == 200
    j = r.json()
    assert j["no_speech"] is False
    assert 1900 <= j["duration_ms"] <= 2100


def test_stereo_wav_downmixes(client):
    r = _post(client, _wav_bytes(1.0, channels=2), fmt="wav", sample_rate=0)
    assert r.status_code == 200
    assert r.json()["duration_ms"] and r.json()["duration_ms"] <= 1100


def test_non_16k_pcm_is_resampled(client):
    r = _post(client, _pcm_bytes(2.0, sr=8000), sample_rate=8000)
    assert r.status_code == 200
    # 2s of 8k audio resampled to 16k should still report ~2000ms.
    assert 1900 <= r.json()["duration_ms"] <= 2100


# --- silence ----------------------------------------------------------------------------------------
def test_silence_returns_no_speech_200(client):
    r = _post(client, _silence_pcm_bytes(3.0))
    assert r.status_code == 200
    j = r.json()
    assert j["no_speech"] is True
    assert j["text"] == ""


# --- bad input --------------------------------------------------------------------------------------
def test_invalid_codec_returns_415(client):
    r = _post(client, b"\x1a\x45\xdf\xa3 not really webm", fmt="webm_opus")
    assert r.status_code == 415


def test_unknown_format_returns_415(client):
    r = _post(client, _pcm_bytes(1.0), fmt="flac")
    assert r.status_code == 415


def test_pcm_without_sample_rate_returns_400(client):
    r = _post(client, _pcm_bytes(1.0), sample_rate=0)
    assert r.status_code == 400


def test_corrupt_wav_returns_415(client):
    r = _post(client, b"RIFFnope not a wav body", fmt="wav", sample_rate=0)
    assert r.status_code == 415


# --- payload guard ----------------------------------------------------------------------------------
def test_oversized_payload_returns_413(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_CHUNK_BYTES", 1024)
    r = _post(client, _pcm_bytes(3.0))  # ~96KB >> 1KB
    assert r.status_code == 413


# --- auth -----------------------------------------------------------------------------------------
def test_missing_auth_returns_401_when_key_set(client, monkeypatch):
    monkeypatch.setattr(server, "API_KEY", "secret")
    r = _post(client, _pcm_bytes(1.0))
    assert r.status_code == 401


def test_bad_auth_returns_401_when_key_set(client, monkeypatch):
    monkeypatch.setattr(server, "API_KEY", "secret")
    r = _post(client, _pcm_bytes(1.0), headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_good_auth_passes_when_key_set(client, monkeypatch):
    monkeypatch.setattr(server, "API_KEY", "secret")
    r = _post(client, _pcm_bytes(1.0), headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200


# --- concurrency guard ------------------------------------------------------------------------------
def test_over_concurrency_returns_503(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_CONCURRENCY", 1)
    server._active = 1  # simulate a decode already in flight
    r = _post(client, _pcm_bytes(1.0))
    assert r.status_code == 503


# --- timeout -----------------------------------------------------------------------------------
def test_slow_decode_returns_504(client, monkeypatch):
    import time as _t

    class SlowModel(FakeModel):
        def transcribe(self, audio, **kwargs):
            _t.sleep(1.0)  # exceeds the tiny budget below
            return super().transcribe(audio, **kwargs)

    server._model = SlowModel()
    monkeypatch.setattr(server, "CHUNK_TIMEOUT_S", 0.05)
    r = _post(client, _pcm_bytes(2.0))
    assert r.status_code == 504


# --- health / ready ---------------------------------------------------------------------------------
def test_health_reports_model_and_concurrency(client):
    j = client.get("/health").json()
    assert j["ok"] is True
    assert j["model"] == server.MODEL_NAME
    assert j["ready"] is True  # fake model injected
    assert j["concurrency"] == {"active": 0, "max": server.MAX_CONCURRENCY}


def test_ready_ok_when_model_present(client):
    r = client.get("/ready")
    assert r.status_code == 200
    assert r.json()["ready"] is True


def test_ready_503_when_model_missing(client):
    server._model = None
    r = client.get("/ready")
    assert r.status_code == 503
    assert r.json()["ready"] is False


# --- privacy: metadata-only logs, no audio on disk --------------------------------------------------
def test_logs_contain_no_transcript_text(client, caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="mondaily-stt"):
        _post(client, _pcm_bytes(2.0), session="sess-xyz", seq=9)
    joined = " ".join(rec.getMessage() for rec in caplog.records)
    assert "sess-xyz" in joined          # metadata present
    assert "seq=9" in joined
    assert "hello there this is a test" not in joined  # transcript text NEVER logged


def test_no_audio_files_written(client, tmp_path, monkeypatch):
    # The chunk path decodes in-memory; assert no temp .audio files are created during a request.
    before = set(os.listdir(tmp_path))
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    _post(client, _pcm_bytes(2.0))
    after = set(os.listdir(tmp_path))
    assert before == after  # nothing written


# --- pure decoders ----------------------------------------------------------------------------------
def test_pcm_decoder_odd_byte_is_trimmed():
    samples = server._pcm_s16le_to_float32(b"\x01\x02\x03")  # 3 bytes -> 1 sample
    assert samples.shape == (1,)


def test_resample_preserves_duration():
    src = np.zeros(8000, dtype=np.float32)  # 1s @ 8k
    out = server._resample_to_16k(src, 8000)
    assert abs(out.size - 16000) <= 1
