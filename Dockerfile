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

# Manim's Cairo/Pango renderer and still/video export dependencies.
#
# `fonts-noto-core` carries the RTL faces Manim asks for — it ships both
# NotoSansHebrew-Regular.ttf and NotoSansArabic-Regular.ttf under
# /usr/share/fonts/truetype/noto (verified against the Debian bookworm package
# contents). There are no `fonts-noto-hebrew` / `fonts-noto-arabic` packages in
# Debian; requiring them failed the image build outright with "Unable to locate
# package", which is how a fix for tofu became a fix for nothing.
#
# `fc-cache -f` makes the installed families visible to Pango/manimpango at
# runtime, which is what `app/agents/manim_worker.py:font_for` probes.
RUN apt-get update && apt-get install -y --no-install-recommends \
	build-essential \
	ffmpeg \
	fonts-noto-core \
	libcairo2-dev \
	libpango1.0-dev \
	pkg-config \
	&& fc-cache -f \
	&& rm -rf /var/lib/apt/lists/*

# Fail loudly at BUILD time if the RTL faces are missing, rather than shipping an
# image that renders Hebrew labels as tofu boxes and only tells us in a log line.
RUN fc-list | grep -qi "NotoSansHebrew" \
	&& fc-list | grep -qi "NotoSansArabic" \
	|| (echo "RTL fonts missing from the image — Manim would render tofu" && exit 1)

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
