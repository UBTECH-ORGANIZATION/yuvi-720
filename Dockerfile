# yuvi-720 — Vite React build + Python runtime.
FROM node:20-slim AS frontend-builder

WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend ./frontend
COPY locales ./locales
RUN cd frontend && npm run build
RUN test -s /app/static/react/unity-world/Build/unity-world.loader.js \
	&& test -s /app/static/react/unity-world/Build/unity-world.data \
	&& test -s /app/static/react/unity-world/Build/unity-world.framework.js \
	&& test -s /app/static/react/unity-world/Build/unity-world.wasm

FROM python:3.11-slim

# Flush stdout/stderr immediately so logs show up in Azure App Service.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Manim's Cairo/Pango renderer and still/video export dependencies.
# fonts-noto-core has NO Hebrew/Arabic glyphs — those live in the separate
# fonts-noto-hebrew / fonts-noto-arabic packages. Without them, Manim's Pango
# text falls back to a glyphless font and Hebrew/Arabic labels render as tofu
# boxes (see app/agents/manim_worker.py:font_for). fc-cache -f makes the newly
# installed families visible to Pango/manimpango at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
	build-essential \
	ffmpeg \
	fonts-noto-core \
	fonts-noto-hebrew \
	fonts-noto-arabic \
	libcairo2-dev \
	libpango1.0-dev \
	pkg-config \
	&& fc-cache -f \
	&& rm -rf /var/lib/apt/lists/*

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
