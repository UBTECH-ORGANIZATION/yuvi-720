FROM node:22-slim AS frontend-builder

WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && addgroup --system adminapp \
    && adduser --system --ingroup adminapp adminapp

COPY backend ./backend
COPY scripts ./scripts
COPY --from=frontend-builder /build/dist ./frontend/dist
RUN test -f ./frontend/dist/index.html

USER adminapp
EXPOSE 8000

# Seed the pricing catalog, but never let a transient MongoDB/Cosmos hiccup take
# down the web tier: the sync is idempotent and re-runs on every start, so a
# failure is logged and startup continues. `exec` makes uvicorn PID 1 for clean
# shutdown signal handling.
CMD ["sh", "-c", "python -m scripts.sync_pricing || echo 'WARN: pricing sync failed; starting web server anyway'; exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
