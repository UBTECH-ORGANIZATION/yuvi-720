"""The Mongo clients must carry bounded pools.

2026-08-30: the default pool of 100 sockets let one teacher-dashboard load
stampede the dev cluster; sockets abandoned at the 10s client timeout left
zombie queries executing server-side until even `currentOp` queued behind
them. A bounded pool queues the burst client-side instead. These tests pin
the bound so a refactor cannot silently return to the default.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAKE = "mongodb://user:pw@example.invalid:27017/?tls=true"


class TheAppRepositoryPoolIsBounded(unittest.TestCase):

    def test_repository_client_pool(self):
        from app.brain import repository

        with (
            patch.object(repository.db_config, "verify_configuration"),
            patch.object(repository.db_config, "connection_string", return_value=FAKE),
            patch.object(repository, "_mongo_client", None),
        ):
            self.assertIsNotNone(repository._get_collection())
            options = repository._mongo_client.options.pool_options
            self.assertEqual(options.max_pool_size, 20)
            self.assertEqual(options.wait_queue_timeout, 10.0)

    def test_learner_state_client_pool(self):
        import learner_state

        with (
            patch.object(learner_state.db_config, "verify_configuration"),
            patch.object(learner_state.db_config, "connection_string", return_value=FAKE),
            patch.object(learner_state, "_mongo_client", None),
        ):
            self.assertIsNotNone(learner_state._get_collection())
            options = learner_state._mongo_client.options.pool_options
            self.assertEqual(options.max_pool_size, 10)
            self.assertEqual(options.wait_queue_timeout, 10.0)


if __name__ == "__main__":
    unittest.main()
