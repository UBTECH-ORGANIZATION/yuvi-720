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
# The base follows the ministry's own examples page (720_xAPI_JSON_Examples,
# refreshed 16/08): `…/xapi/moe/content-vendor/<catalog-id>` — chosen over the
# `…/moe/ecat/content-vendor/…` spelling from the email thread, per Gal, 17/08.
CONTENT_VENDOR_BASE = f"{MOE}/content-vendor"

# 720 media dictionary. The Activity type of a media object follows the media
# kind ("סוג ה-Activity יהיה בהתאם לסוג המדיה"). Anything outside the dictionary
# stays `item`: inventing an activity IRI the ministry does not publish is a
# worse failure than a generic-but-valid one.
MEDIA_ACTIVITY_TYPES = {"video": "video", "audio": "audio", "animation": "animation"}


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
        # it is; a bare catalog item id is namespaced here.
        identifier = (
            ecat_item_id
            if str(ecat_item_id).startswith(("http://", "https://"))
            else f"{ECAT_ITEM_BASE}/{ecat_item_id}"
        )
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
