"""HTTP transport for posting xAPI statements to the MoE LRS.

Headers per the Postman collection (verbatim): Bearer token, JSON content
type, and `X-Experience-API-Version: 1.0.3`. A 401 triggers exactly one
token refresh + retry; every other failure raises a typed `LrsError` that
the outbox turns into a scheduled resend — never a user-facing error.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.services.lrs import auth, config


class LrsError(RuntimeError):
    """A safe transport error: status/code only, never learner data."""

    def __init__(self, code: str, status_code: int = 0) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


async def post_statement(statement: dict[str, Any]) -> dict[str, Any]:
    """POST one statement. Returns {"status": int, "body": parsed-or-text}.

    The LRS answers 200 with an array of accepted statement ids (or 204).
    A duplicate `statement.id` is rejected by the LRS — that rejection is the
    spec's own de-dup mechanism and is treated as success by the outbox.
    """
    token = await auth.get_access_token()
    for attempt in range(2):  # second pass only after a 401 refresh
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Experience-API-Version": config.xapi_version(),
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(config.timeout_seconds())
            ) as client:
                response = await client.post(
                    config.statements_url(), json=statement, headers=headers
                )
        except httpx.HTTPError as exc:
            raise LrsError(f"transport:{type(exc).__name__}") from exc

        if response.status_code == 401 and attempt == 0:
            auth.invalidate_token()
            token = await auth.get_access_token(force_refresh=True)
            continue
        if response.status_code >= 400:
            raise LrsError("lrs_rejected", response.status_code)
        try:
            body: Any = response.json() if response.content else None
        except ValueError:
            body = response.text
        return {"status": response.status_code, "body": body}
    raise LrsError("unreachable")  # pragma: no cover
