"""Every guardrail the control plane can raise must be sayable to an admin.

The failure this prevents is quiet and specific: someone adds a new `AdminError`
to `admin_org.py`, the console renders it through `t('adm.refusal.<code>')`,
`t()` returns the raw key when a translation is missing — and an admin is told
`adm.refusal.school_year_closed` instead of what went wrong.

Scanning the source rather than importing is deliberate: the codes are raised
inline at their guard, which is where they belong, so there is no enumeration to
import. This test is the enumeration.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
SERVICE = BACKEND / "app" / "services" / "admin_org.py"
LOCALES = REPO / "locales"

LANGUAGES = ("he", "en", "ar")

# `raise AdminError("code")` / `AdminError("code", "message")`
CODE_PATTERN = re.compile(r'AdminError\(\s*"([a-z0-9_]+)"')

# Raised by the route layer rather than the service, so the scan cannot see them.
ROUTE_CODES = {"http_400", "http_403", "http_409", "http_500"}
# Synthesised by the client when a response carries no code at all.
CLIENT_CODES = {"unexpected"}


def _codes() -> set[str]:
    return set(CODE_PATTERN.findall(SERVICE.read_text(encoding="utf-8")))


def _bundle(language: str) -> dict[str, str]:
    return json.loads((LOCALES / f"{language}.json").read_text(encoding="utf-8"))


class AdminRefusalLocaleTest(unittest.TestCase):
    def test_the_scan_actually_finds_the_guardrails(self):
        """A regex that silently matches nothing would make this whole file pass."""
        codes = _codes()
        self.assertGreater(len(codes), 8, f"expected many AdminError codes, found {codes}")
        # The three that carry the most weight — if the scan misses these it is broken.
        for expected in ("would_leave_group_unstaffed", "cannot_revoke_self",
                         "cannot_remove_last_admin"):
            self.assertIn(expected, codes)

    def test_every_refusal_code_has_a_message_in_every_language(self):
        codes = _codes() | CLIENT_CODES
        for language in LANGUAGES:
            bundle = _bundle(language)
            for code in sorted(codes):
                with self.subTest(language=language, code=code):
                    key = f"adm.refusal.{code}"
                    self.assertIn(key, bundle, f"{language} cannot explain {code}")
                    self.assertTrue(bundle[key].strip(), f"{language}.{key} is blank")

    def test_no_orphan_refusal_messages(self):
        """A message for a code nothing raises is dead weight that reads as coverage."""
        live = _codes() | CLIENT_CODES | ROUTE_CODES
        bundle = _bundle("he")
        declared = {
            key[len("adm.refusal."):] for key in bundle
            if key.startswith("adm.refusal.")
        }
        # `confirm` and `dismiss` are the notice's own buttons, not codes.
        declared -= {"confirm", "dismiss"}
        self.assertEqual(declared - live, set(), "locale declares refusals nothing raises")


if __name__ == "__main__":
    unittest.main()
