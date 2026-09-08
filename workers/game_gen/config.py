"""Environment-driven settings for the game_gen worker.

Ported from vibe-coding-kids ``src/backend/agent/config.py`` (model routing,
Copilot CLI path resolution, APIM provider config, reasoning-effort support
cache, blocked tools, language rule) and the client-auth logic of
``agent_service.AgentService.start``.  Adapted to github-copilot-sdk 1.0.13:
the bundled-binary lookup now goes through ``copilot._cli_download`` instead
of the removed ``copilot.client._get_bundled_cli_path``.

Kid-facing / HITL settings from vibe are intentionally absent.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any

logger = logging.getLogger("game_gen.copilot")

# ============================================================================
# Environment
# ============================================================================


def _find_and_load_env() -> None:
    """Load the nearest ``.env`` walking up from this file (vibe's helper).

    python-dotenv is optional for the worker; without it we rely on the
    process environment only.
    """
    try:
        from dotenv import load_dotenv  # type: ignore[import-not-found]
    except ImportError:
        return
    current = Path(__file__).resolve().parent
    for _ in range(5):
        env_file = current / ".env"
        if env_file.exists():
            load_dotenv(env_file, override=False)
            return
        current = current.parent
    load_dotenv()


_find_and_load_env()

# ============================================================================
# Copilot CLI path
# ============================================================================

_VSCODE_COPILOT_CLI = (
    "~/Library/Application Support/Code/User/globalStorage/"
    "github.copilot-chat/copilotCli/copilot"
)


def _sdk_bundled_cli_path() -> str | None:
    """Return the SDK-provisioned runtime binary if it is already cached.

    SDK 1.0.13 no longer ships the binary inside the wheel; it downloads a
    pinned runtime into a cache dir on first use.  We only *look* here (no
    download) so import stays side-effect free.
    """
    try:
        from copilot._cli_download import get_cached_cli_path

        cached = get_cached_cli_path()
        if cached and os.path.exists(cached):
            return cached
    except Exception as exc:  # pragma: no cover - defensive around SDK internals
        logger.debug("SDK cached runtime lookup failed: %s", exc)
    return None


def resolve_copilot_cli_path() -> str | None:
    """Resolve the Copilot CLI binary path.

    Priority (ported from vibe, with ``shutil.which`` inserted):
      1. ``COPILOT_CLI_PATH`` env var (explicit override)
      2. SDK-provisioned runtime binary (cached download)
      3. ``copilot`` on ``PATH``
      4. VS Code copilot-chat extension path (local macOS dev)

    Returns ``None`` when nothing exists, letting the SDK provision its own
    runtime (``RuntimeConnection.for_stdio(path=None)``).
    """
    env_path = os.getenv("COPILOT_CLI_PATH")
    if env_path:
        logger.info("CLI path from env: %s", env_path)
        return env_path

    bundled = _sdk_bundled_cli_path()
    if bundled:
        logger.info("CLI path from SDK runtime cache: %s", bundled)
        return bundled

    on_path = shutil.which("copilot")
    if on_path:
        logger.info("CLI path from PATH: %s", on_path)
        return on_path

    fallback = os.path.expanduser(_VSCODE_COPILOT_CLI)
    if os.path.exists(fallback):
        logger.info("CLI path fallback (VS Code): %s", fallback)
        return fallback

    logger.info("No Copilot CLI found; SDK will provision its runtime")
    return None


COPILOT_CLI_PATH: str | None = resolve_copilot_cli_path()
COPILOT_LOG_LEVEL: str = os.getenv("COPILOT_LOG_LEVEL", "warning")

# ============================================================================
# Auth
# ============================================================================


def github_token() -> str | None:
    """Token for Copilot auth (server/CI).  ``None`` → logged-in CLI user."""
    return (
        os.getenv("COPILOT_GITHUB_TOKEN")
        or os.getenv("GITHUB_TOKEN")
        or os.getenv("COPILOT_SDK_AUTH_TOKEN")
        or None
    )


def use_logged_in_user() -> bool:
    """Local dev authenticates with the logged-in Copilot CLI user unless a token is set."""
    return github_token() is None


# ============================================================================
# Model routing
# ============================================================================

# Azure APIM gateway (optional).  Same env names as vibe.
APIM_BASE_URL: str = os.getenv("APIM_BASE_URL", "")
APIM_SUBSCRIPTION_KEY: str = os.getenv("APIM_SUBSCRIPTION_KEY", "")
APIM_API_VERSION: str = os.getenv("APIM_API_VERSION", "2024-10-21")

COPILOT_MODEL: str = os.getenv("COPILOT_MODEL", "claude-opus-5")

# Models that must bypass APIM and go through GitHub Copilot directly
# (not deployed on the Azure APIM gateway).  Any ``claude-*`` also qualifies.
_GITHUB_DIRECT_MODELS: frozenset[str] = frozenset({
    "claude-sonnet-4", "claude-opus-4.5", "claude-opus-4.6", "claude-opus-4.7",
    "claude-haiku-4.5", "claude-sonnet-4.5", "gemini-3-pro-preview",
})


def needs_github_direct(model_name: str) -> bool:
    """True if the model must be routed directly via GitHub (not APIM)."""
    return model_name in _GITHUB_DIRECT_MODELS or model_name.startswith("claude-")


def apim_provider_config() -> dict[str, Any] | None:
    """APIM ``ProviderConfig`` dict, or ``None`` when APIM is not configured.

    The SDK's ``ProviderConfig`` is a TypedDict, so a plain dict is the wire
    shape.  ``AzureProviderOptions`` from vibe is now the ``azure`` sub-dict.
    """
    if not (APIM_BASE_URL and APIM_SUBSCRIPTION_KEY):
        return None
    return {
        "type": "azure",
        "base_url": APIM_BASE_URL,
        "api_key": APIM_SUBSCRIPTION_KEY,
        "azure": {"api_version": APIM_API_VERSION},
    }


def provider_for_model(model_name: str) -> dict[str, Any] | None:
    """Provider to attach to a session: APIM unless the model is GitHub-direct."""
    if needs_github_direct(model_name):
        return None
    return apim_provider_config()


# ============================================================================
# Reasoning-effort support (populated once from the SDK)
# ============================================================================

_reasoning_models: set[str] | None = None

# Fallback: known non-reasoning models (vibe's static allowlist).
_NO_REASONING_MODELS: frozenset[str] = frozenset({
    "gpt-4o-mini", "gpt-4.1", "claude-sonnet-4.5",
    "claude-haiku-4.5", "claude-opus-4.5", "gemini-3-pro-preview",
})


def model_supports_reasoning(model_name: str) -> bool:
    """Whether ``reasoning_effort`` may be passed for this model.

    Uses the SDK capability cache once populated; otherwise the static list.
    """
    if _reasoning_models is not None:
        return model_name in _reasoning_models
    return model_name not in _NO_REASONING_MODELS


async def populate_reasoning_models(client: Any) -> None:
    """Query ``client.list_models()`` once to learn which models support reasoning_effort."""
    global _reasoning_models
    if _reasoning_models is not None or client is None:
        return
    try:
        models = await client.list_models()
        _reasoning_models = {
            m.id for m in models if m.capabilities.supports.reasoning_effort
        }
        logger.info("Reasoning-effort models: %s", sorted(_reasoning_models))
    except Exception as exc:
        logger.warning("Could not query model capabilities: %s", exc)


def reset_reasoning_cache() -> None:
    """Forget the cached capability set (tests / client restart)."""
    global _reasoning_models
    _reasoning_models = None


# ============================================================================
# Tools
# ============================================================================

# File-writing tools to block (the model must return code in its response).
BLOCKED_TOOLS: frozenset[str] = frozenset({
    "write_file", "create_file", "edit_file", "insert_edit_into_file",
    "replace_string_in_file", "create_directory", "mv", "cp",
})

# ============================================================================
# Language support (ported verbatim from vibe)
# ============================================================================

_LANGUAGE_NAMES = {
    "he": "Hebrew",
    "en": "English",
    "ar": "Arabic",
    "ru": "Russian",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
}

_RTL_LANGUAGES = {"he", "ar", "fa", "ur"}


def _get_language_rule(preferred_language: str) -> str:
    """Return the language instruction to inject into every agent prompt."""
    lang = preferred_language or "he"
    lang_name = _LANGUAGE_NAMES.get(lang, lang.upper())
    direction = "rtl" if lang in _RTL_LANGUAGES else "ltr"
    if lang == "he":
        font_stack = "Heebo, Rubik, sans-serif"
    elif lang == "ar":
        font_stack = "Noto Sans Arabic, sans-serif"
    else:
        font_stack = "system-ui, sans-serif"

    return (
        f"\n\n🌐 LANGUAGE RULE (MANDATORY):\n"
        f"The user's preferred language is \"{lang}\" ({lang_name}).\n"
        f"You MUST respond in {lang_name}.\n"
        f"ALL text visible to the user (UI labels, explanations, button text, "
        f"comments inside code, error messages) MUST be in {lang_name}.\n"
        f"Your internal reasoning / thinking MUST also be in {lang_name} — "
        f"the user can see it in real-time!\n"
        f"Generated HTML must use: <html lang=\"{lang}\"> "
        f"and font-family: {font_stack}.\n"
        f"For text elements (headings, paragraphs, buttons), set dir=\"{direction}\" on those elements.\n"
        f"⚠️ Do NOT put dir=\"rtl\" on the <html> or <body> tag in games/canvas apps — "
        f"it reverses CSS layout and breaks arrow key directions!\n"
    )


get_language_rule = _get_language_rule
