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
        ca-certificates curl fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-list | grep -qi "NotoSansHebrew" \
    && fc-list | grep -qi "NotoSansArabic" \
    || (echo "RTL fonts missing from the image" && exit 1)

WORKDIR /app
COPY workers/game_gen/requirements.txt workers/game_gen/requirements.txt
RUN pip install -r workers/game_gen/requirements.txt \
    && python -m playwright install --with-deps chromium \
    # Pre-fetch the pinned Copilot CLI runtime at build time so a cold replica
    # does not download it on first job (the SDK would otherwise do this lazily).
    && python -m copilot

COPY backend/app backend/app
COPY workers/game_gen workers/game_gen

# Non-root: the Copilot CLI keeps session state under $HOME/.copilot.
RUN useradd -m -u 10001 worker && mkdir -p /home/worker/.copilot && chown -R worker:worker /home/worker /ms-playwright
USER worker
ENV HOME=/home/worker

# Task #548 replaces this with the Service Bus consumer entrypoint.
CMD ["python", "-m", "game_gen.spike", "--help"]
