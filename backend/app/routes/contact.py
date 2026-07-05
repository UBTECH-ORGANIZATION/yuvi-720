"""Landing page contact form route."""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.localization import normalize_language
from app.services.email import send_contact_email


router = APIRouter(prefix="/api", tags=["contact"])

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=1, max_length=2000)
    language: str | None = None


@router.post("/contact")
async def submit_contact_form(data: ContactRequest):
    """Send a landing page contact form submission to the support inboxes."""
    if not EMAIL_PATTERN.match(data.email):
        raise HTTPException(status_code=422, detail="invalid_email")

    language = normalize_language(data.language)

    try:
        await send_contact_email(data.name.strip(), data.email.strip(), data.message.strip(), language)
    except Exception as exc:
        print(f"⚠️ Contact form email send failed: {exc}")
        raise HTTPException(status_code=502, detail="email_send_failed") from exc

    return {"ok": True}
