FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY receiver.py sender.py .
# Two entrypoints — compose runs each as its own service.
CMD ["python", "receiver.py"]
