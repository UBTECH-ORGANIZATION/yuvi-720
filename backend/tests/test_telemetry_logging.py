"""The telemetry exporter must not flood the slot's log stream.

``azure.core`` logs every telemetry upload at INFO — request URL, all the
headers, the response — and the exporter narrates each transmission. On the
App Service log stream that was a screenful per flush, burying the app's own
lines. `_quiet_exporter_logs` raises exactly those loggers to WARNING.
"""

from __future__ import annotations

import logging
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import telemetry

NOISY = (
    "azure.core.pipeline.policies.http_logging_policy",
    "azure.monitor.opentelemetry.exporter",
)


class ExporterChatterIsSilenced(unittest.TestCase):

    def setUp(self):
        self._levels = {name: logging.getLogger(name).level for name in NOISY}

    def tearDown(self):
        for name, level in self._levels.items():
            logging.getLogger(name).setLevel(level)

    def test_the_noisy_loggers_drop_to_warning(self):
        for name in NOISY:
            logging.getLogger(name).setLevel(logging.NOTSET)
        telemetry._quiet_exporter_logs()
        for name in NOISY:
            self.assertEqual(logging.getLogger(name).level, logging.WARNING, name)

    def test_warnings_still_pass(self):
        # Silencing the play-by-play must not hide real delivery failures.
        telemetry._quiet_exporter_logs()
        for name in NOISY:
            self.assertTrue(logging.getLogger(name).isEnabledFor(logging.WARNING))


if __name__ == "__main__":
    unittest.main()
