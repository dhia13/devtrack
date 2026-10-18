FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DEVTRACK_DB=/data/devtrack.db
RUN apt-get update && apt-get install -y --no-install-recommends tzdata git && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# Repos are mounted read-only and owned by another user; let git read them anyway.
RUN git config --system safe.directory '*'  && useradd --system --uid 10001 devtrack && mkdir /data /backups && chown devtrack /data /backups
USER devtrack
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787", "--proxy-headers"]
