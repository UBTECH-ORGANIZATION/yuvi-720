# Learning Game Lab worker — Copilot SDK (claude-opus-5) + Playwright validator.
# Build from the repo root so backend/app (usage ledger, notifications) is on the path:
#   docker build -f workers/game_gen/Dockerfile -t yuvi720acr.azurecr.io/game-gen:dev .
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PYTHONPATH=/app/workers:/app/backend

# Fonts: fonts-noto-core carries Noto Sans Hebrew + Arabic on bookworm (same
# recipe and assertion as the main Dockerfile — a game screenshot with tofu is a
# bug, not a warning).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl fontconfig fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* \
    && ls /usr/share/fonts/truetype/noto/ | grep -qi "NotoSansHebrew" \
    && ls /usr/share/fonts/truetype/noto/ | grep -qi "NotoSansArabic" \
    || (echo "RTL fonts missing from the image" && exit 1)

WORKDIR /app
COPY workers/game_gen/requirements.txt workers/game_gen/requirements-backend.txt workers/game_gen/
RUN pip install -r workers/game_gen/requirements.txt -r workers/game_gen/requirements-backend.txt \
    && python -m playwright install --with-deps chromium \
    # Chromium runs at a lower CPU priority than the worker: a 3D game rendered in
    # software must not starve the Service Bus keepalives and lock renewals.
    && bin="$(ls -d /ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1)" \
    && [ -n "$bin" ] || bin="$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome | head -1)" \
    && printf '#!/bin/sh\nexec nice -n 10 %s "$@"\n' "$bin" > /usr/local/bin/chromium-nice \
    && chmod +x /usr/local/bin/chromium-nice
ENV CHROMIUM_EXECUTABLE=/usr/local/bin/chromium-nice

# backend/app plus the root modules it imports (learner_state & co.); no server.py.
COPY backend/app backend/app
COPY backend/learner_state.py backend/mock_data.py backend/questionnaire_locales.py backend/
COPY workers/game_gen workers/game_gen

# Non-root: the Copilot CLI keeps session state under $HOME/.copilot.
RUN useradd -m -u 10001 worker && mkdir -p /home/worker/.copilot && chown -R worker:worker /home/worker /ms-playwright
USER worker
ENV HOME=/home/worker
# Pre-fetch the pinned Copilot CLI runtime as the runtime user so a cold replica
# never downloads it on its first job (the SDK would otherwise do this lazily).
RUN python -m copilot download-runtime

CMD ["python", "-m", "game_gen.worker"]
