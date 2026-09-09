"""IRI constants + the mandatory 720 statement envelope.

Every outbound statement carries: actor (exidentifier), grouping
(lms + session + program, plus content-vendor/ecat on content events), and
team (NMM group preferred, school symbol fallback) — per the 720 PDF.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.lrs import config

MOE = "https://lxp.education.gov.il/xapi/moe"
VERB = f"{MOE}/verbs"
ACTIVITY = f"{MOE}/activities"
EXT = f"{MOE}/extensions"

EXIDENTIFIER_HOMEPAGE = f"{MOE}/identity/exidentifier"
NMM_HOMEPAGE = f"{MOE}/identity/nmm/kvutsa"
SCHOOL_HOMEPAGE = f"{MOE}/school"
ECAT_ITEM_BASE = f"{MOE}/ecat/item"
# `grouping→content-vendor` identifies the content SUPPLIER (MoE, 03/08), which
# is not the same thing as a catalog ITEM id — so it gets its own IRI space.
# Integration report 4 (against spec v1.1) settled the base the other way from
# the 16/08 examples page: the required shape is
# `…/xapi/moe/ecat/content-vendor/<vendorId>` — the bare `…/moe/content-vendor/…`
# spelling we sent was rejected ("שדה לא תקין: content-vendor.id").
CONTENT_VENDOR_BASE = f"{MOE}/ecat/content-vendor"
# The base report 4 retired — anything configured/cached under it is rewritten
# onto CONTENT_VENDOR_BASE before it reaches the wire.
_LEGACY_CONTENT_VENDOR_BASE = f"{MOE}/content-vendor"

# 720 media dictionary. The Activity type of a media object follows the media
# kind ("סוג ה-Activity יהיה בהתאם לסוג המדיה"). Anything outside the dictionary
# stays `item`: inventing an activity IRI the ministry does not publish is a
# worse failure than a generic-but-valid one.
MEDIA_ACTIVITY_TYPES = {"video": "video", "audio": "audio", "animation": "animation"}

# Vendor spellings for the SAME three kinds. Kata types a clip screen
# `mediaFormat: "interactive-content"` and puts the real kind in `contentType`,
# which is why the ministry saw `object.type = item` on a video and a
# `mediaFormat` value that is not in their list at all. These are the vendor's
# own words for the ministry's three kinds — a translation, not a guess.
# Anything not listed here resolves to nothing and is simply not reported.
_MEDIA_FORMAT_ALIASES = {
    "video": "video", "movie": "video", "clip": "video", "video-clip": "video",
    "youtube": "video", "mp4": "video", "סרטון": "video", "וידאו": "video",
    "audio": "audio", "sound": "audio", "podcast": "audio", "mp3": "audio",
    "שמע": "audio",
    "animation": "animation", "animated": "animation", "gif": "animation",
    "אנימציה": "animation",
}


def resolve_media_format(*candidates: Optional[str]) -> Optional[str]:
    """The 720 `mediaFormat` for a screen, from whatever the catalog spelled it.

    Candidates are tried in order (mediaFormat first, then contentType) and the
    first one that maps onto the ministry's closed list wins. A screen that is
    not one of the three kinds returns None — `interactive-content` is a
    contentType, and reporting it as a mediaFormat is what the review rejected.
    """
    for candidate in candidates:
        key = str(candidate or "").strip().lower()
        resolved = _MEDIA_FORMAT_ALIASES.get(key)
        if resolved:
            return resolved
    return None


def verb(slug: str) -> dict[str, Any]:
    return {"id": f"{VERB}/{slug}"}


def activity(
    object_id: str, activity_type: str, name_he: Optional[str] = None
) -> dict[str, Any]:
    definition: dict[str, Any] = {"type": f"{ACTIVITY}/{activity_type}"}
    if name_he:
        definition["name"] = {"he": name_he}
    return {"objectType": "Activity", "id": object_id, "definition": definition}


def build_actor(exidentifier: str) -> dict[str, Any]:
    return {
        "objectType": "Agent",
        "account": {"homePage": EXIDENTIFIER_HOMEPAGE, "name": exidentifier},
    }


def build_team(school: Optional[str], nmm: Optional[str]) -> Optional[dict[str, Any]]:
    """NMM learning group preferred; school symbol until the NMM is known."""
    if nmm:
        return {
            "objectType": "Group",
            "account": {"homePage": NMM_HOMEPAGE, "name": nmm},
        }
    if school:
        return {
            "objectType": "Group",
            "account": {"homePage": SCHOOL_HOMEPAGE, "name": school},
        }
    return None


def session_activity(session_id: str) -> dict[str, Any]:
    return activity(
        f"{config.supplier_domain()}/session/{session_id}", "session", "Session"
    )


def build_grouping(
    session_id: Optional[str],
    *,
    ecat_item_id: Optional[str] = None,
    extra: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Mandatory grouping: lms + session + program (+ content-vendor for content).

    Order follows the ministry's examples page: lms, session, program,
    content-vendor, then the content ancestry."""
    grouping: list[dict[str, Any]] = [
        activity(config.supplier_domain(), "lms"),
    ]
    if session_id:
        grouping.append(session_activity(session_id))
    grouping.append(activity(config.program_iri(), "program"))
    if ecat_item_id:
        # Already an IRI (the supplier id, namespaced by `hierarchy`) → sent as
        # it is; a bare vendor/catalog id is namespaced here. Report 4 pinned
        # the one valid base (…/moe/ecat/content-vendor/…), so the retired one
        # is rewritten rather than trusted — env maps configured before v1.1
        # must not keep the old spelling on the wire.
        identifier = str(ecat_item_id)
        if identifier.startswith(f"{_LEGACY_CONTENT_VENDOR_BASE}/"):
            identifier = (
                f"{CONTENT_VENDOR_BASE}/"
                f"{identifier[len(_LEGACY_CONTENT_VENDOR_BASE) + 1:]}"
            )
        elif not identifier.startswith(("http://", "https://")):
            identifier = f"{CONTENT_VENDOR_BASE}/{identifier}"
        grouping.append(activity(identifier, "content-vendor"))
    if extra:
        # De-dupe so content-origin statements can't add a SECOND lms/session/
        # program (the MoE would receive two `session` groupings with different
        # ids). For those singleton types ours win by TYPE; everything else
        # (curriculum tags, etc.) de-dupes by id and is kept.
        singleton_types = {
            f"{ACTIVITY}/lms", f"{ACTIVITY}/session", f"{ACTIVITY}/program"
        }

        def _type(entry: dict[str, Any]) -> Optional[str]:
            return ((entry.get("definition") or {}).get("type"))

        seen_ids = {entry.get("id") for entry in grouping}
        seen_singletons = {
            _type(entry) for entry in grouping if _type(entry) in singleton_types
        }
        for entry in extra:
            if not isinstance(entry, dict):
                continue
            entry_type = _type(entry)
            if entry_type in singleton_types and entry_type in seen_singletons:
                continue
            if entry.get("id") in seen_ids:
                continue
            grouping.append(entry)
            seen_ids.add(entry.get("id"))
    return grouping


def extensions(values: dict[str, Any]) -> dict[str, Any]:
    """Map short extension names → fully-qualified MoE extension IRIs."""
    return {f"{EXT}/{key}": value for key, value in values.items() if value is not None}
