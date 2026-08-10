"""End-to-end check against a live uvicorn instance on port 8721."""
import asyncio
import json
import os
import sys

import httpx
import websockets

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = "http://127.0.0.1:8721"
WS = "ws://127.0.0.1:8721/api/support/ws"
TOKEN = "test-secret"


async def main() -> None:
    from app.auth.tokens import create_session_token

    teacher = create_session_token(user_id="moti", username="moti", roles=["teacher"])
    learner = create_session_token(user_id="gal", username="gal", roles=["learner"])
    other = create_session_token(user_id="other", username="other", roles=["teacher"])

    async with httpx.AsyncClient(base_url=BASE, timeout=20) as http:
        opened = await http.post(
            "/api/support/conversations",
            json={"subject": "ws check", "message": "hello"},
            cookies={"spark_session": teacher},
        )
        print("open conversation:", opened.status_code)
        conversation_id = opened.json()["conversation"]["id"]

        try:
            async with websockets.connect(WS):
                print("FAIL: anonymous socket accepted")
        except Exception as exc:
            print("anonymous socket refused:", type(exc).__name__)

        try:
            async with websockets.connect(
                WS, additional_headers={"Cookie": f"spark_session={learner}"}
            ):
                print("FAIL: learner socket accepted")
        except Exception as exc:
            print("learner socket refused:", type(exc).__name__)

        async with websockets.connect(
            WS, additional_headers={"Cookie": f"spark_session={teacher}"}
        ) as socket:
            signed = await http.post(
                "/internal/support/notify",
                json={"type": "message.created", "conversation_id": conversation_id},
                headers={"X-Support-Token": TOKEN},
            )
            print("signed notify status:", signed.status_code)
            event = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
            print("socket received:", event)

            replied = await http.post(
                f"/api/support/conversations/{conversation_id}/messages",
                json={"body": "another message"},
                cookies={"spark_session": teacher},
            )
            print("teacher reply status:", replied.status_code)
            live = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
            print("socket received on reply:", live)

        unsigned = await http.post(
            "/internal/support/notify",
            json={"type": "message.created", "conversation_id": conversation_id},
            headers={"X-Support-Token": "wrong"},
        )
        print("unsigned notify status:", unsigned.status_code)

        cross = await http.get(
            f"/api/support/conversations/{conversation_id}/messages",
            cookies={"spark_session": other},
        )
        print("cross-teacher read:", cross.status_code)

        anonymous = await http.get("/api/support/tickets/mine")
        print("anonymous tickets:", anonymous.status_code)


asyncio.run(main())
