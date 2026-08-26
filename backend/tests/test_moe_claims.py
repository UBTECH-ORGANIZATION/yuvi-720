"""Reading a ministry token: claim names, role mapping, and the opaque id.

The published OpenID claim table is ambiguous, so `claims.py` matches through
aliases. These fixtures pin the shapes the ministry documents — the comma
formats in particular, because a naive split breaks both of them.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.moe.claims import ClaimsError, parse_profile, split_top_level
from app.auth.moe.identity import derive_learner_id
from app.auth.moe.roles import resolve_roles

STUDENT = {
    "exidentifier": "1003106405",
    "givenname": "יאיר",
    "surname": "כהן",
    "displayname": "יאיר כהן",
    "isstudent": "Yes",
    "studentmosad": "270041",
    "studentkita": "6",
    "studentmakbila": "2",
    "IshurHorim": "13",
}

TEACHER = {
    "exidentifier": "1003106407",
    "displayname": "רונית לוי",
    "isstudent": "No",
    "orgrolessimple": "667,1",
    "orgrolecomplex": "667[mosad:189084],1[mosad:390153]",
    "orgrolesyeshuyot": "189084,390153",
}


class SplitTest(unittest.TestCase):
    def test_commas_inside_brackets_do_not_split(self):
        # `3[112409:6,1]` is ONE placement. A plain str.split would read four
        # fragments and lose the class/parallel pair.
        self.assertEqual(
            split_top_level("3[112409:6,1],4[190210:7,2]"),
            ["3[112409:6,1]", "4[190210:7,2]"],
        )


class StudentProfileTest(unittest.TestCase):
    def setUp(self):
        self.profile = parse_profile(STUDENT)

    def test_identity_and_flags(self):
        self.assertEqual(self.profile.exidentifier, "1003106405")
        self.assertEqual(self.profile.display_name, "יאיר כהן")
        self.assertTrue(self.profile.is_student)
        self.assertEqual(self.profile.parental_consent, "13")

    def test_class_placement_becomes_a_group_key(self):
        school = self.profile.schools[0]
        self.assertEqual(school.symbol, "270041")
        self.assertEqual(school.group_key, "270041-62")

    def test_student_resolves_to_learner(self):
        self.assertEqual(resolve_roles(self.profile), ["learner"])

    def test_y_is_accepted_as_well_as_yes(self):
        self.assertTrue(parse_profile({**STUDENT, "isstudent": "Y"}).is_student)

    def test_extra_placement_adds_a_second_school(self):
        profile = parse_profile({**STUDENT, "shibutznosaf": "3[112409:6,1]"})
        symbols = sorted(item.symbol for item in profile.schools)
        self.assertEqual(symbols, ["112409", "270041"])

    def test_own_school_stays_primary(self):
        # First entry becomes `school_symbol` on the account, which is what the
        # LRS statements are addressed with — an extra placement must not win it.
        profile = parse_profile({**STUDENT, "shibutznosaf": "3[112409:6,1]"})
        self.assertEqual(profile.schools[0].symbol, "270041")


class TeacherProfileTest(unittest.TestCase):
    def setUp(self):
        self.profile = parse_profile(TEACHER)

    def test_complex_roles_become_institutions(self):
        self.assertEqual(
            sorted(item.symbol for item in self.profile.schools),
            ["189084", "390153"],
        )
        self.assertEqual(self.profile.role_codes, ("667", "1"))

    def test_configured_teacher_code_wins(self):
        with patch.dict("os.environ", {"MOE_ROLE_MAP_JSON": '{"teacher": ["667"]}'}):
            self.assertEqual(resolve_roles(self.profile), ["teacher"])

    def test_school_attachment_is_the_fallback_while_codes_are_unpublished(self):
        with patch.dict("os.environ", {"MOE_ROLE_MAP_JSON": ""}):
            self.assertEqual(resolve_roles(self.profile), ["teacher"])

    def test_ict_role_reaches_the_teacher_lane(self):
        profile = parse_profile({
            "exidentifier": "1003106408", "isstudent": "No", "orgrolessimple": "795",
        })
        self.assertEqual(resolve_roles(profile), ["teacher"])


class NoRoleTest(unittest.TestCase):
    def test_authenticated_but_unaffiliated_gets_nothing(self):
        # The ministry test appendix §11.4.3 case: identified, not permitted.
        profile = parse_profile({"exidentifier": "1003106409", "isstudent": "No"})
        self.assertEqual(resolve_roles(profile), [])

    def test_token_without_exidentifier_is_refused(self):
        with self.assertRaises(ClaimsError):
            parse_profile({"displayname": "מישהו", "isstudent": "Yes"})


class LearnerIdTest(unittest.TestCase):
    def test_stable_and_opaque(self):
        with patch.dict("os.environ", {"MOE_ID_PEPPER": "pepper-a"}):
            first = derive_learner_id("1003106405")
            second = derive_learner_id("1003106405")
        self.assertEqual(first, second)
        self.assertTrue(first.startswith("moe_"))
        # The whole point: the ministry id must not be recoverable from the key.
        self.assertNotIn("1003106405", first)

    def test_different_people_get_different_ids(self):
        with patch.dict("os.environ", {"MOE_ID_PEPPER": "pepper-a"}):
            self.assertNotEqual(derive_learner_id("1"), derive_learner_id("2"))

    def test_pepper_changes_the_id(self):
        with patch.dict("os.environ", {"MOE_ID_PEPPER": "pepper-a"}):
            first = derive_learner_id("1003106405")
        with patch.dict("os.environ", {"MOE_ID_PEPPER": "pepper-b"}):
            second = derive_learner_id("1003106405")
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
