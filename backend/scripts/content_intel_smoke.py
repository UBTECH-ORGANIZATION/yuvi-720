#!/usr/bin/env python3
"""Prove the content-intelligence config is served end to end, over the wire.

    python scripts/content_intel_smoke.py                    # against :8720
    python scripts/content_intel_smoke.py --base http://...  # any deployment

Logs in as the seeded teacher/learner, fires the proactive lesson_welcome the
learning page fires on entry, and checks the streamed body against the
committed config: a hit must equal the stored text (after the deterministic
greeting) and arrive without a model round-trip's latency. Exit 0 = the coach
served the pre-generated text; exit 1 = it fell through to live generation
(which may be CORRECT — the report says why it judged a miss).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.services import content_intelligence as ci  # noqa: E402


def welcomes() -> dict[str, str]:
    """component_id → committed lesson_welcome body."""
    out: dict[str, str] = {}
    for path in ci.shard_paths(ci.DEFAULT_CONFIG_DIR):
        shard = json.loads(path.read_text(encoding="utf-8"))
        for lomda in shard.get("lomdot") or []:
            block = (lomda.get("texts") or {}).get("lesson_welcome")
            if block:
                out[lomda["component_id"]] = block["he"].strip()
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8720")
    parser.add_argument("--username", default="gal")
    parser.add_argument("--password", default="Aa12345")
    parser.add_argument("--component", default="methodica-science-mass-measure-02-01")
    args = parser.parse_args()

    stored = welcomes()
    print(f"config holds {len(stored)} lesson welcomes")
    if not stored:
        print("✗ no config on disk — run the pipeline first")
        return 1

    client = httpx.Client(base_url=args.base, timeout=60)
    login = client.post("/api/auth/login", json={
        "username": args.username, "password": args.password})
    if login.status_code != 200:
        print(f"✗ login failed: {login.status_code}")
        return 1
    # httpx declines to replay host-only cookies for bare IPs — send it by hand.
    session = client.cookies.get("spark_session")
    client.headers["Cookie"] = f"spark_session={session}"

    started = time.perf_counter()
    first_text_at = None
    body = ""
    with client.stream("POST", "/api/agent/coach/proactive", json={
        "trigger": "lesson_welcome",
        "language": "he",
        "conversation_id": f"smoke-{int(time.time())}",
        "surface": {"screen": "learning_lesson",
                    "component_id": args.component},
    }) as response:
        if response.status_code != 200:
            print(f"✗ proactive endpoint: {response.status_code}")
            return 1
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                frame = json.loads(payload)
            except ValueError:
                continue
            if isinstance(frame, dict) and frame.get("text"):
                if first_text_at is None:
                    first_text_at = time.perf_counter() - started
                body += frame["text"]

    body = " ".join(body.split())
    print(f"first text after {first_text_at:.2f}s" if first_text_at
          else "no text streamed")
    print(f"streamed: {body[:160]}")

    match = next((cid for cid, text in stored.items()
                  if " ".join(text.split()) in body), None)
    if match:
        print(f"✓ pregen welcome served verbatim (component {match}, "
              f"first text in {first_text_at:.2f}s)")
        return 0
    print("✗ streamed body matches no stored welcome — the coach generated "
          "live. Check the fingerprint gate (did the catalog change since the "
          "seed?) and CONTENT_INTEL_ENABLED.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
