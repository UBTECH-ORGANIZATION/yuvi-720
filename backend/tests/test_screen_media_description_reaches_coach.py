"""The nightly browser pass pays a vision call to describe every graphic on a
slide; the description must reach the coach whole, not cut to a stub.

Measured 2026-09-16 on the nightly shards: 20 of 29 media descriptions were
truncated by a 90-char cap in the bundle, after content_intelligence had
already bounded each line at ENRICHMENT_MEDIA_LABEL_CAP. The bundle cap now
follows the source cap."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach import _render_context  # noqa: E402
from app.brain import context_engine  # noqa: E402
from app.services import content_intelligence  # noqa: E402

COMPONENT = "c-01"
ITEM = "c-01-002"
BRAIN = {
    "current_state": {"component_id": COMPONENT, "unit_id": "u-1", "item_id": ITEM, "question_id": "q1"},
    "goals": [],
    "identity": {"locale": "he"},
}
QUESTIONS = [{"questionId": "q1", "questionText": "מי מהמדידות חריגה?", "answers": ["12.0", "12.1", "18.7"],
              "correctAnswers": ["18.7"]}]
ROW = {"id": ITEM, "title": "מדידות מסה", "media_format": "interactive-content",
       "content_type": "practice", "question_count": 1, "kind": "question"}

DESCRIPTION = ("איור של מאזניים דו־כפיים: בכף השמאלית קובייה כחולה ובכף הימנית שלוש משקולות "
               "של 100 גרם, המאזניים נוטים שמאלה כך שהקובייה כבדה יותר מ־300 גרם")
MEDIA_LINE = f"image: מאזניים — {DESCRIPTION}"


class MediaDescriptionSurvivesTheBundle(unittest.IsolatedAsyncioTestCase):
    async def test_the_whole_description_is_in_the_prompt(self):
        self.assertGreater(len(MEDIA_LINE), 90)
        self.assertLessEqual(len(MEDIA_LINE), content_intelligence.ENRICHMENT_MEDIA_LABEL_CAP)
        with patch.object(context_engine, "view_for", new=AsyncMock(return_value=BRAIN)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": COMPONENT}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=QUESTIONS), \
             patch("app.services.kata_catalog.item_profile", return_value=ROW), \
             patch("app.services.kata_catalog.resolve_catalog_item_id", side_effect=lambda *a, **k: ITEM), \
             patch("app.services.kata_catalog.information_for_item", return_value="הערות פריט"), \
             patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])), \
             patch("app.services.content_intelligence.enrichment",
                   return_value={"visible_text": "לפניכם מאזניים", "media": [MEDIA_LINE]}), \
             patch("app.services.content_intelligence.screen_anchors", return_value=None):
            bundle = await context_engine.build_coach_bundle("L", surface_context={"screen": "learning_lesson"})
        media = bundle["current"]["screen_enrichment"]["media"]
        self.assertEqual(media, [MEDIA_LINE])
        rendered = _render_context(dict(bundle, coach_mode="lesson_coach"), "מה רואים בתמונה?")
        self.assertIn(f"current_screen_media_inventory: {MEDIA_LINE}", rendered)


if __name__ == "__main__":
    unittest.main()
