# Mondaily STT Appliance (faster-whisper)

Self-hosted speech-to-text that powers **Meeting Memory** — it turns a recorded call's audio into a
transcript, which the app then summarizes through the sovereign AI gateway. FULL SOVEREIGNTY: no
third-party STT SaaS; this runs entirely on your own box (same Hetzner host as the search
appliance is fine). Deploy it, then point the app at it with one env var in Vercel.

## Contract (what the app calls)
`packages/api/src/lib/livekit.ts` → `transcribeAudio()`:
- `POST $SOVEREIGN_STT_URL/transcribe`
  - header `Authorization: Bearer $SOVEREIGN_STT_KEY` (only sent if the key is set)
  - body `{ "audio_url": "<livekit egress file url>", "diarize": true }`
  - → `{ "text": "...", "segments": [ { "speaker": "Speaker", "text": "...", "start": 0.0 } ] }`

The app's `mapSttResponse` accepts either the `segments` array (preferred) or a bare `text` blob, so
a simpler response still works. Every segment here is labeled `"Speaker"` — this build does **not**
guess who spoke (see *Diarization* below to add that honestly later).

> Note: the audio URL is the LiveKit egress file location. The STT box must be able to reach it —
> if egress writes to private object storage, either use a signed/public URL or run this appliance
> where it can read that bucket.

## Deploy
1. Install Docker + compose (Ubuntu): `curl -fsSL https://get.docker.com | sh`
2. Copy this folder to the server: `scp -r deploy/stt-appliance root@HETZNER_IP:/opt/mondaily-stt`
3. `cd /opt/mondaily-stt`
4. (recommended) set a shared secret: `export STT_API_KEY=$(openssl rand -hex 16)`
5. `docker compose up -d --build`  — first boot downloads the model (a minute or two)
6. Verify:
   ```
   curl localhost:8090/health
   curl -X POST localhost:8090/transcribe -H 'content-type: application/json' \
     -H "Authorization: Bearer $STT_API_KEY" \
     -d '{"audio_url":"https://download.samplelib.com/mp3/sample-3s.mp3"}'
   ```

## Point the app at it (Vercel env)
- `SOVEREIGN_STT_URL = https://stt.your-domain.com` (or `http://HETZNER_IP:8090` behind a firewall)
- `SOVEREIGN_STT_KEY = <the STT_API_KEY you set>` (omit if you left it open)

That alone flips `transcriptionEnabled()` on. Recording also needs LiveKit egress configured +
`LIVEKIT_RECORDING_ENABLED=1`, and the LiveKit webhook pointed at
`https://api.mondaily.com/api/v1/webhooks/livekit`. Until all three are set the feature stays
invisible and inert (fail-closed) — nothing fake is ever shown.

## Model sizing
| WHISPER_MODEL | Hardware | Notes |
|---|---|---|
| `base` / `small` | CPU (int8) | Good for short internal calls; the default. |
| `medium` | strong CPU / small GPU | Better accuracy, slower on CPU. |
| `large-v3` | GPU | Best accuracy; needs the GPU variant below. |

### GPU variant
Swap the base image in `stt/Dockerfile` for an NVIDIA CUDA image (e.g.
`nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` + install python), install the NVIDIA Container
Toolkit on the host, add `deploy.resources.reservations.devices` for the GPU in
`docker-compose.yml`, and set `WHISPER_DEVICE=cuda WHISPER_COMPUTE=float16 WHISPER_MODEL=large-v3`.

## Diarization (optional, later)
To attribute lines to real speakers, add a `pyannote/speaker-diarization` pass and map each
whisper segment to the overlapping speaker turn, emitting `speaker: "Speaker 1" | "Speaker 2"`.
The API already renders whatever `speaker` label you send — no app change needed. This needs a
HuggingFace token for the pyannote weights (a model download, still self-hosted — no inference
leaves the box).

## Security
- **SSRF protection is built in.** `/transcribe` fetches `audio_url` server-side, so the appliance
  validates it: http(s) only, redirects disabled, and any URL resolving to a private / loopback /
  link-local / reserved address (localhost, RFC-1918, cloud metadata `169.254.169.254`, …) is
  rejected. Set `STT_ALLOWED_HOSTS` (comma-separated) to your egress storage host(s) for a strict
  allowlist — the strongest defense.
- **Firewall / auth.** If you expose the port publicly, keep `STT_API_KEY` set and terminate TLS at
  a reverse proxy (Caddy/nginx). Behind a private network you can leave it open on `:8090`.
