"""Test-suite wiring.

The one job of this file is to make it impossible for the suite to reach a real
database. A test run inherits the developer's shell and `backend/.env`, and both
have historically held a connection string that reaches production — so a test
that forgets to patch its store would write to live learner records.

The variables are blanked rather than deleted: `app.core.env` only fills in keys
that are *absent*, so an empty value is what actually stops `.env` from putting
production back.
"""

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["MONGODB_CONNECTION_STRING"] = ""
os.environ["MONGODB_DATABASE"] = ""
os.environ["MONGODB_DB"] = ""
os.environ["SPARK_ALLOW_PRODUCTION_DB"] = ""
os.environ["SPARK_STORAGE"] = "json"  # deliberate offline fallback, not a misconfiguration
os.environ["SPARK_ENVIRONMENT"] = "test"
os.environ["ENVIRONMENT"] = "test"

from app.core import database as _database  # noqa: E402  (after the env is blanked)

_database.reset_verification_cache()
