FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# app.py already runs Socket.IO (threading mode) on $PORT, single process
CMD ["python", "app.py"]
