# yuvi-720 — Vite React build + Python runtime.
FROM node:20-slim AS frontend-builder

WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend ./frontend
COPY locales ./locales
RUN cd frontend && npm run build

FROM python:3.11-slim

# Flush stdout/stderr immediately so logs show up in Azure App Service.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python deps first for better layer caching.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the whole repo (server.py resolves static dirs relative to the repo root).
COPY . .
COPY --from=frontend-builder /app/static/react ./static/react

# The backend imports sibling modules (mock_data) and resolves BASE_DIR = parent of backend/.
WORKDIR /app/backend

EXPOSE 8000

# --proxy-headers / --forwarded-allow-ips trust X-Forwarded-* from Azure App Service + Front Door.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
