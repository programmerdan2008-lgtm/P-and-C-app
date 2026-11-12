FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# ONE worker + many threads (presence state lives in memory, Socket.IO uses threading mode)
CMD gunicorn app:app --worker-class gthread --workers 1 --threads 100 --timeout 120 --bind 0.0.0.0:${PORT:-5000}
