"""The seven device extensions the 720 test script asks for on session `enter`.

TC-SES-01 / TC-SES-07: deviceType, platform, operatingSystem, osVersion,
browser, browserVersion, applicationVersion. Everything but the last is read
off the User-Agent; a version that header does not disclose is omitted.
"""

from __future__ import annotations

import os
import unittest
from unittest import mock

from app.routes.auth import _device_from_request


class _Request:
    def __init__(self, user_agent: str) -> None:
        self.headers = {"user-agent": user_agent}


CHROME_MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36"
)
EDGE_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.2651.98"
)
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
CHROME_ANDROID = (
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
)


class SessionDeviceExtensionTests(unittest.TestCase):
    def test_the_os_version_is_never_a_bare_dotted_number(self):
        """The ministry's spreadsheet turned "10.15.7" into 15/10/2007."""
        device = _device_from_request(_Request(CHROME_MAC))
        self.assertEqual(device["osVersion"], "macOS 10.15.7")
        self.assertFalse(device["osVersion"][0].isdigit())

    def test_the_browser_and_os_versions_are_reported(self):
        for user_agent, expected in (
            (CHROME_MAC, {
                "deviceType": "Desktop", "operatingSystem": "macOS",
                "osVersion": "macOS 10.15.7", "browser": "Chrome",
                "browserVersion": "128.0.6613.120",
            }),
            (EDGE_WINDOWS, {
                "deviceType": "Desktop", "operatingSystem": "Windows",
                "osVersion": "Windows 10.0", "browser": "Edge",
                "browserVersion": "127.0.2651.98",
            }),
            (SAFARI_IPHONE, {
                "deviceType": "Mobile", "operatingSystem": "iOS",
                "osVersion": "iOS 17.5.1", "browser": "Safari",
                "browserVersion": "17.5",
            }),
            (CHROME_ANDROID, {
                "deviceType": "Mobile", "operatingSystem": "Android",
                "osVersion": "Android 14", "browser": "Chrome",
                "browserVersion": "126.0.0.0",
            }),
        ):
            with self.subTest(user_agent=user_agent[:40]):
                device = _device_from_request(_Request(user_agent))
                self.assertEqual(device["platform"], "Web")
                for key, value in expected.items():
                    self.assertEqual(device[key], value)

    def test_an_iphone_is_not_reported_as_a_mac(self):
        """Its UA says "like Mac OS X" — matched before the iPhone check, every
        phone in the country used to be reported as a desktop Mac."""
        device = _device_from_request(_Request(SAFARI_IPHONE))
        self.assertEqual(device["operatingSystem"], "iOS")

    def test_an_unknown_user_agent_reports_no_version_at_all(self):
        device = _device_from_request(_Request(""))
        self.assertNotIn("osVersion", device)
        self.assertNotIn("browserVersion", device)

    def test_the_deployed_build_is_reported_when_the_pipeline_sets_it(self):
        with mock.patch.dict(os.environ, {"APP_VERSION": "2026.08.27.1"}):
            device = _device_from_request(_Request(CHROME_MAC))
        self.assertEqual(device["applicationVersion"], "2026.08.27.1")
        # The deploy workflow stamps SPARK_RELEASE (the commit sha), never
        # APP_VERSION — the slot must still name its build.
        with mock.patch.dict(os.environ, {"APP_VERSION": "", "SPARK_RELEASE": "0123456789abcdef0123"}):
            device = _device_from_request(_Request(CHROME_MAC))
        self.assertEqual(device["applicationVersion"], "0123456789ab")

    def test_a_local_run_names_its_working_tree(self):
        from app.routes import auth
        with mock.patch.dict(os.environ, {"APP_VERSION": "", "SPARK_RELEASE": "", "IMAGE_TAG": "", "GIT_SHA": "", "GITHUB_SHA": ""}):
            auth._git_version = None
            device = _device_from_request(_Request(CHROME_MAC))
        self.assertRegex(device.get("applicationVersion", ""), r"^[0-9a-f]{7,12}$")


if __name__ == "__main__":
    unittest.main()
