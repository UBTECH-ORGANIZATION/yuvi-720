"""Email delivery service using Azure Communication Services."""

import asyncio
import os

from azure.communication.email import EmailClient


CONTACT_SUBJECTS = {
    "he": "פנייה חדשה מדף הנחיתה של Yuvi Spark",
    "en": "New contact form message from the Yuvi Spark landing page",
    "ar": "رسالة تواصل جديدة من صفحة الهبوط الخاصة بـ Yuvi Spark",
}

CONTACT_LABELS = {
    "he": {"name": "שם", "email": "אימייל", "message": "הודעה"},
    "en": {"name": "Name", "email": "Email", "message": "Message"},
    "ar": {"name": "الاسم", "email": "البريد الإلكتروني", "message": "الرسالة"},
}

LEAD_SUBJECT = "ליד חדש מדף הנחיתה של קמפיין 720"

LEAD_LABELS = [
    ("full_name", "שם מלא"),
    ("role", "תפקיד"),
    ("organization", "בית ספר / רשות"),
    ("city", "יישוב / עיר"),
    ("phone", "טלפון"),
    ("email", "מייל"),
    ("grades", "שכבות גיל רלוונטיות"),
    ("message", "הודעה"),
    ("source", "מקור"),
]


def _recipients() -> list[str]:
    raw = os.environ.get("CONTACT_EMAILS", "")
    return [address.strip() for address in raw.split(",") if address.strip()]


def missing_email_settings() -> list[str]:
    """Which of the three mailer settings are absent or empty.

    Named and public so a deploy check can ask the same question the sender asks,
    instead of a human inferring it from a 502 hours later.
    """
    missing = []
    if not os.environ.get("AZURE_COMMUNICATION_CONNECTION_STRING", "").strip():
        missing.append("AZURE_COMMUNICATION_CONNECTION_STRING")
    if not os.environ.get("ACS_SENDER_ADDRESS", "").strip():
        missing.append("ACS_SENDER_ADDRESS")
    if not _recipients():
        missing.append("CONTACT_EMAILS")
    return missing


def _send_sync(subject: str, plain_text: str, reply_to_email: str = "", reply_to_name: str = "") -> None:
    connection_string = os.environ.get("AZURE_COMMUNICATION_CONNECTION_STRING", "")
    sender_address = os.environ.get("ACS_SENDER_ADDRESS", "")

    # Name the gap. The old message said only "not fully configured", so a
    # production 502 told you the mailer was broken but not which of three
    # settings to go and set — and the answer is not visible from the outside.
    missing = missing_email_settings()
    if missing:
        raise RuntimeError(
            "Azure Communication Services is not fully configured — missing/empty: "
            + ", ".join(missing)
        )
    recipients = _recipients()

    client = EmailClient.from_connection_string(connection_string)
    message_payload = {
        "senderAddress": sender_address,
        "recipients": {"to": [{"address": address} for address in recipients]},
        "content": {
            "subject": subject,
            "plainText": plain_text,
        },
    }
    if reply_to_email:
        message_payload["replyTo"] = [
            {"address": reply_to_email, "displayName": reply_to_name or reply_to_email}
        ]

    poller = client.begin_send(message_payload)
    poller.result()


async def send_contact_email(name: str, email: str, message: str, language: str) -> None:
    """Send a contact-form submission to the configured support inboxes."""
    labels = CONTACT_LABELS.get(language, CONTACT_LABELS["he"])
    subject = CONTACT_SUBJECTS.get(language, CONTACT_SUBJECTS["he"])
    plain_text = (
        f"{labels['name']}: {name}\n"
        f"{labels['email']}: {email}\n\n"
        f"{labels['message']}:\n{message}"
    )
    await asyncio.to_thread(_send_sync, subject, plain_text, email, name)


async def send_lead_email(lead: dict[str, str]) -> None:
    """Send a campaign landing page lead to the configured inboxes."""
    lines = [f"{label}: {lead.get(key, '')}" for key, label in LEAD_LABELS if lead.get(key)]
    plain_text = "\n".join(lines)
    await asyncio.to_thread(
        _send_sync,
        LEAD_SUBJECT,
        plain_text,
        lead.get("email", ""),
        lead.get("full_name", ""),
    )

