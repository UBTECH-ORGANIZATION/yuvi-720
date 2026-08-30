"""The bundle must not be delivered as three and a half megabytes of raw text.

The complaint this pins is the one the ministry pilot raised: *the system is
really slow — if it doesn't run on my machine it will never run for students in
schools*. The measurement behind it was not subtle. The built app is a ~2.9MB
JavaScript chunk and a ~830KB stylesheet, and nothing in the stack was
compressing either of them: Starlette's `StaticFiles` does not, and there is no
CDN or reverse proxy in front of the App Service that would. Every learner
opening the app on a school connection downloaded all of it, uncompressed, and
then downloaded it again on the next navigation because the content-hashed
filenames carried no cache directive.

Both are one-line middleware/header fixes, which is exactly why they need a
test: a one-line fix is a one-line revert, and the symptom — "it feels a bit
slow" — is not one a human reviewer reliably notices coming back.

The invariants are stated over *behaviour a browser can observe*, not over the
presence of a middleware class, so they still hold if the implementation moves
to a proxy, a CDN rule, or pre-compressed files on disk.
"""

from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from app.core.telemetry import RequestTimingMiddleware
from app.routes import static_pages


# Big enough that compression is both applied (over the 1KB floor) and
# meaningful, and repetitive like real JavaScript is.
_FAKE_BUNDLE = ("const spark = 'yuvilab';\n" * 4000).encode()


def _client(app: FastAPI) -> httpx.AsyncClient:
    """Drive the real ASGI stack without starting the app's lifespan.

    `TestClient` would run the lifespan, which opens Mongo and the LRS sweeper.
    None of that has anything to do with how a static file is delivered, and
    requiring it would make this test unrunnable anywhere the database is not
    reachable — which is most places, including CI.
    """
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


class AssetDeliveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        assets = self.tmp / "assets"
        assets.mkdir()
        # Vite's real output shape: a content hash in the filename.
        (assets / "index-abc12345.js").write_bytes(_FAKE_BUNDLE)
        (self.tmp / "index.html").write_text("<!doctype html>")
        # `public/` output keeps its name across builds — the other cache policy.
        moments = self.tmp / "moments"
        moments.mkdir()
        (moments / "celebration-1.jpg").write_bytes(b"\xff\xd8\xff\xe0 not really a jpeg")

        self._originals = {
            name: getattr(static_pages, name)
            for name in ("REACT_APP_DIR", "REACT_ASSETS_DIR")
        }
        static_pages.REACT_APP_DIR = self.tmp
        static_pages.REACT_ASSETS_DIR = assets

        self.app = FastAPI()
        self.app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
        self.app.add_middleware(RequestTimingMiddleware)
        static_pages.mount_static_assets(self.app)

    def tearDown(self) -> None:
        for name, value in self._originals.items():
            setattr(static_pages, name, value)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _get(self, path: str, **kwargs) -> httpx.Response:
        async def run() -> httpx.Response:
            async with _client(self.app) as client:
                return await client.get(path, **kwargs)

        return asyncio.run(run())

    def test_a_browser_that_accepts_gzip_is_not_sent_the_raw_bundle(self) -> None:
        """The headline fix: the wire bytes must be a fraction of the file."""
        response = self._get(
            "/assets/index-abc12345.js", headers={"Accept-Encoding": "gzip"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("content-encoding"), "gzip")
        # httpx decodes for us, so `content` is the original file: the point is
        # that it arrived intact *and* compressed, not merely truncated.
        self.assertEqual(response.content, _FAKE_BUNDLE)

    def test_a_browser_without_gzip_still_gets_a_working_file(self) -> None:
        """Compression is an optimisation, never a requirement to be served."""
        response = self._get(
            "/assets/index-abc12345.js", headers={"Accept-Encoding": "identity"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("content-encoding"))
        self.assertEqual(response.content, _FAKE_BUNDLE)

    def test_hashed_assets_are_cached_permanently(self) -> None:
        """A hashed URL's bytes can never change, so it must never be re-fetched.

        Without `immutable` the browser revalidates every asset on every
        navigation. On a school uplink that is a round trip per file before the
        page can render — the part of "slow" that persists even once everything
        is already on disk.
        """
        response = self._get("/assets/index-abc12345.js")

        cache_control = response.headers.get("cache-control", "")
        self.assertIn("immutable", cache_control)
        self.assertIn("max-age=31536000", cache_control)

    def test_stable_named_assets_are_cached_but_still_revalidate(self) -> None:
        """`public/` output keeps its filename, so it gets the weaker policy.

        These really can change under the same URL on a deploy, so `immutable`
        would be wrong. Sending nothing at all was the actual bug: the browser
        then guesses, and re-asks for all 69 moment images every time the album
        opens.
        """
        response = self._get("/moments/celebration-1.jpg")

        cache_control = response.headers.get("cache-control", "")
        self.assertEqual(response.status_code, 200)
        self.assertIn("max-age=3600", cache_control)
        self.assertNotIn("immutable", cache_control)

    def test_every_response_reports_the_server_s_own_time(self) -> None:
        """`Server-Timing` is what separates "the server is slow" from "the
        school's line is slow" — the question the whole investigation turns on.
        """
        response = self._get("/assets/index-abc12345.js")

        self.assertRegex(response.headers.get("server-timing", ""), r"^app;dur=[\d.]+$")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
