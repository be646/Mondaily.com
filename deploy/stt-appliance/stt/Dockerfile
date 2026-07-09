# Sovereign speech-to-text appliance — faster-whisper behind a tiny FastAPI wrapper.
# CPU build (int8). For GPU, see the README (swap the base image for an nvidia/cuda one and set
# WHISPER_DEVICE=cuda / WHISPER_COMPUTE=float16).
FROM python:3.11-slim

# ffmpeg is required by faster-whisper to decode arbitrary audio containers (LiveKit egress .ogg).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .

EXPOSE 8090
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8090"]
