"""720 marketing campaign landing page and lead capture."""

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.core.paths import CAMPAIGN_DIR
from app.services.email import send_lead_email


router = APIRouter(tags=["campaign"])

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_PATTERN = re.compile(r"^[0-9+()\-\s]{7,20}$")


class LeadRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    organization: str = Field(min_length=1, max_length=160)
    city: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=1, max_length=30)
    email: str = Field(min_length=3, max_length=200)
    grades: str = Field(default="", max_length=120)
    message: str = Field(default="", max_length=1000)
    source: str = Field(default="landing-720", max_length=60)
    # Hidden honeypot field; real people leave it empty.
    company: str = Field(default="", max_length=200)


def _serve_campaign_file(filename: str):
    page = CAMPAIGN_DIR / filename
    if page.exists():
        return FileResponse(page)
    return JSONResponse(content={"error": "campaign page not found"}, status_code=404)


@router.get("/landing")
async def campaign_landing():
    """Serve the standalone 720 campaign landing page."""
    return _serve_campaign_file("index.html")


@router.get("/landing/thank-you")
async def campaign_thank_you():
    """Serve the campaign thank-you page used for conversion tracking."""
    return _serve_campaign_file("thank-you.html")


@router.post("/api/leads")
async def submit_lead(data: LeadRequest):
    """Email a campaign lead to the YuviLab inboxes."""
    if data.company.strip():
        # Bot filled the honeypot: accept silently without emailing anyone.
        return {"ok": True}

    if not EMAIL_PATTERN.match(data.email.strip()):
        raise HTTPException(status_code=422, detail="invalid_email")
    if not PHONE_PATTERN.match(data.phone.strip()):
        raise HTTPException(status_code=422, detail="invalid_phone")

    lead = {
        "full_name": data.full_name.strip(),
        "role": data.role.strip(),
        "organization": data.organization.strip(),
        "city": data.city.strip(),
        "phone": data.phone.strip(),
        "email": data.email.strip(),
        "grades": data.grades.strip(),
        "message": data.message.strip(),
        "source": data.source.strip(),
    }

    try:
        await send_lead_email(lead)
    except Exception as exc:
        print(f"⚠️ Campaign lead email send failed: {exc}")
        raise HTTPException(status_code=502, detail="email_send_failed") from exc

    return {"ok": True}
