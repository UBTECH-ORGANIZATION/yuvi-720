"""Anything Vite copies from `frontend/public` has to be reachable in production.

The bug this pins: the class book's picture plates live in `frontend/public/
moments/`, and Vite copies that directory verbatim to the build ROOT — only
hashed bundle output goes under `/assets`. `mount_static_assets` mounted
`/assets`, `/shared`, `/locales`, `/campaign` and `/unity-world`, and nothing
covering the root, so `/moments/breakthrough-1.jpg` answered 404 on every
deployed environment. So did `/yuvi-favicon.png`, which had been broken far
longer without anyone noticing.

It was invisible in development because Vite's dev server serves `public/` at
`/` itself — the whole class of bug only exists in the built image. And it
failed *quietly*: the album falls back through variant → first → hand-drawn SVG
scene, so a book with no photographs looked like a book that was designed
without them.

The invariant is therefore stated over the directory, not over the one file
that broke: every entry a developer drops into `frontend/public` must answer
200. A test naming only `moments/` would pass the day someone adds the next
one.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import static_pages

PUBLIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public"


class PublicAssetsAreServed(unittest.TestCase):
    """Mount against a stand-in build tree, then ask for each public file.

    Built against a temporary directory rather than the repo's `static/react`
    on purpose: that directory is a build artefact which may be stale or absent
    on a fresh checkout, and a test that silently skips when it is missing is
    exactly the kind of test that lets this ship again.
    """

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        # A build output is `public/` copied verbatim plus the bundles.
        shutil.copytree(PUBLIC_DIR, self.tmp, dirs_exist_ok=True)
        (self.tmp / "index.html").write_text("<!doctype html>")

        self._originals = {
            name: getattr(static_pages, name)
            for name in ("REACT_APP_DIR", "REACT_ASSETS_DIR", "UNITY_WORLD_DIR")
        }
        static_pages.REACT_APP_DIR = self.tmp
        static_pages.REACT_ASSETS_DIR = self.tmp / "assets"
        static_pages.UNITY_WORLD_DIR = self.tmp / "unity-world"

        app = FastAPI()
        static_pages.mount_static_assets(app)
        app.include_router(static_pages.router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for name, value in self._originals.items():
            setattr(static_pages, name, value)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_every_public_entry_answers(self) -> None:
        """One probe per entry in `frontend/public`, by the URL the app uses."""
        probes: list[str] = []
        for entry in sorted(PUBLIC_DIR.iterdir()):
            if entry.name.startswith("."):
                continue
            if entry.is_file():
                probes.append(f"/{entry.name}")
                continue
            # A directory: probe a real file inside it, at whatever depth, so
            # the mount is proved rather than the directory's existence.
            first = next((path for path in sorted(entry.rglob("*")) if path.is_file()), None)
            if first is not None:
                probes.append("/" + first.relative_to(PUBLIC_DIR).as_posix())

        self.assertTrue(probes, "frontend/public is empty — the probe list is vacuous")
        for url in probes:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(
                    response.status_code, 200,
                    f"{url} is in frontend/public but nothing serves it in the built app. "
                    "Add a mount in `mount_static_assets`.",
                )

    def test_a_book_plate_comes_back_as_an_image(self) -> None:
        """The original failure, stated concretely.

        Status alone is not enough here: the interesting near-miss is a route
        that answers 200 with the SPA shell, which an `<img>` cannot decode and
        which would look identical to this test if it only counted 200s.
        """
        response = self.client.get("/moments/breakthrough-1.jpg")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/jpeg")
        # JPEG magic number — proof it is the picture and not an error document.
        self.assertEqual(response.content[:2], b"\xff\xd8")


if __name__ == "__main__":
    unittest.main()
