"""pytest config for game_gen tests: registers the ``slow`` marker."""
import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: launches a real headless Chromium")
