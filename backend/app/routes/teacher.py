"""Teacher view + org/permissions routes (F6, F8). Thin: scope + delegate.

Access is enforced server-side in the Teacher Insights agent (group scoping)
before any brain read. Every insight/flag carries its raw evidence.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.agents import teacher_insights
from app.agents.teacher_insights import AccessDenied
from app.auth.dependencies import require_teacher
from app.brain import org
from app.core.localization import normalize_language
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api", tags=["teacher"])


@router.post("/agent/insights")
async def agent_insights(data: dict, teacher_id: str = Depends(require_teacher)):
    """Explainable teacher insights (F6), scoped to the teacher's groups (F8)."""
    language = normalize_language(data.get("language"))
    try:
        if data.get("group_id"):
            return JSONResponse(content=await teacher_insights.group_view(
                teacher_id, data["group_id"], language))
        if data.get("learner_id"):
            return JSONResponse(content=await teacher_insights.student_view(
                teacher_id, normalize_learner_id(data["learner_id"]), language))
    except AccessDenied as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=403)
    return JSONResponse(content={"error": "group_id or learner_id required"}, status_code=400)


@router.post("/teacher/directive")
async def teacher_directive(data: dict, teacher_id: str = Depends(require_teacher)):
    """Teacher write lane — append a directive to a learner (non-LLM, §5.8)."""
    try:
        directive = await teacher_insights.add_directive(
            teacher_id,
            normalize_learner_id(data.get("learner_id")),
            text=data.get("text", ""),
            scope=data.get("scope"),
            priority=data.get("priority", "normal"),
            visible_to_learner=bool(data.get("visible_to_learner", False)),
        )
    except AccessDenied as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=403)
    return JSONResponse(content=directive)


@router.get("/groups")
async def list_groups(teacher_id: str = Depends(require_teacher)):
    """Groups the teacher may access (admin → all)."""
    return JSONResponse(content={"groups": org.groups_for_teacher(teacher_id)})


@router.get("/orgs")
async def list_orgs(teacher_id: str = Depends(require_teacher)):
    """Org overview (admin only)."""
    if not org.is_admin(teacher_id):
        return JSONResponse(content={"error": "admin_only"}, status_code=403)
    return JSONResponse(content={"schools": org.SCHOOLS, "teachers": org.TEACHERS, "groups": org.GROUPS})
