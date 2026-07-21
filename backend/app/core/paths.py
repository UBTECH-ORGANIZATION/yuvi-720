"""Shared filesystem paths for backend route modules."""

from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[3]
LEARNING_AGENT_DIR = BASE_DIR / "learning-agent"
SHARED_DIR = BASE_DIR / "shared"
LOCALES_DIR = BASE_DIR / "locales"
REACT_APP_DIR = BASE_DIR / "static" / "react"
REACT_ASSETS_DIR = REACT_APP_DIR / "assets"
UNITY_WORLD_DIR = REACT_APP_DIR / "unity-world"
LEARNING_GAME_FILE = LEARNING_AGENT_DIR / "game.html"