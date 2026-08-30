"""Yuvi Workshop API — a learner builds something and watches it happen.

Two things shape this module.

First, identity is never taken from the request. Every path resolves the learner
from the session cookie and then checks ownership against the stored project, so
guessing a project id gets you a 404 and nothing else.

Second, the artifact route serves learner-authored HTML from our own origin. It
is safe only because of the response headers: `CSP: sandbox` without
`allow-same-origin` gives the document an opaque origin — no cookies, no storage,
no access to the parent — and `connect-src 'none'` denies it the network. Those
headers are the security boundary, not a nicety; do not relax them.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.agents import safety
from app.auth.dependencies import require_learner
from app.core.localization import normalize_language
from app.services.workshop import builder, repository, sanitizer, storage

router = APIRouter(prefix="/api/workshop", tags=["workshop"])

MAX_DAILY_BUILDS = 30
MAX_MESSAGE_LENGTH = 1000


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _owned_project(project_id: str, learner_id: str) -> dict[str, Any]:
    """Load a project, or 404 — a project you do not own does not exist to you."""
    project = await repository.get_project(project_id)
    if project is None or project.get("learner_id") != learner_id:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project


def _request_language(request: Request, fallback: Optional[str] = None) -> str:
    header = request.headers.get("x-spark-language") or request.headers.get("accept-language")
    return normalize_language(fallback or (header or "").split(",")[0])


@router.get("/projects")
async def list_projects(learner_id: str = Depends(require_learner)) -> dict[str, Any]:
    projects = await repository.list_projects(learner_id)
    return {"projects": [repository.public_project(project) for project in projects]}


@router.post("/projects")
async def create_project(
    data: dict,
    request: Request,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    if await repository.count_projects(learner_id) >= repository.MAX_PROJECTS_PER_LEARNER:
        raise HTTPException(status_code=409, detail="project_limit_reached")

    language = _request_language(request, data.get("language"))
    title = (data.get("title") or "").strip()
    screened = safety.screen_input(title, language)
    if screened.flagged:
        title = ""

    project = await repository.create_project(
        learner_id,
        title=title,
        kind=(data.get("kind") or "game"),
        language=language,
        objective_id=(data.get("objectiveId") or None),
    )
    return {"project": repository.public_project(project)}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    project = await _owned_project(project_id, learner_id)
    versions = await repository.list_versions(project_id)
    return {
        "project": repository.public_project(project),
        "versions": [repository.public_version(version) for version in versions],
    }


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    await _owned_project(project_id, learner_id)
    await repository.delete_project(project_id)
    return {"deleted": True}


async def _artifact_response(project_id: str, learner_id: str, version: int) -> Response:
    """Replay one artifact version under the sandbox headers."""
    if version < 1:
        raise HTTPException(status_code=404, detail="artifact_not_found")

    record = await repository.get_version(project_id, version)
    if record is None:
        raise HTTPException(status_code=404, detail="artifact_not_found")

    try:
        html = await storage.get(record["blob_path"])
    except storage.StorageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None

    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Security-Policy": sanitizer.content_security_policy(),
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/projects/{project_id}/artifact")
async def get_current_artifact(
    project_id: str,
    learner_id: str = Depends(require_learner),
) -> Response:
    project = await _owned_project(project_id, learner_id)
    return await _artifact_response(
        project_id, learner_id, int(project.get("current_version") or 0)
    )


@router.get("/projects/{project_id}/versions/{version}/artifact")
async def get_version_artifact(
    project_id: str,
    version: int,
    learner_id: str = Depends(require_learner),
) -> Response:
    await _owned_project(project_id, learner_id)
    return await _artifact_response(project_id, learner_id, version)


@router.post("/projects/{project_id}/versions/{version}/restore")
async def restore_version(
    project_id: str,
    version: int,
    learner_id: str = Depends(require_learner),
) -> dict[str, Any]:
    """Bring an old version back as a new one, so nothing is ever lost."""
    project = await _owned_project(project_id, learner_id)
    source = await repository.get_version(project_id, version)
    if source is None:
        raise HTTPException(status_code=404, detail="artifact_not_found")

    try:
        html = await storage.get(source["blob_path"])
        next_version = int(project.get("current_version") or 0) + 1
        blob_path = storage.build_path(learner_id, project_id, next_version)
        await storage.put(blob_path, html)
    except storage.StorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None

    await repository.add_version(
        project_id,
        learner_id,
        version=next_version,
        blob_path=blob_path,
        request=f"restore:v{version}",
        summary=source.get("summary") or "",
        safety_codes=source.get("safety_codes") or [],
    )
    await repository.update_project(project_id, {"current_version": next_version})
    return {"version": next_version}


@router.post("/projects/{project_id}/build")
async def build_project(
    project_id: str,
    data: dict,
    learner_id: str = Depends(require_learner),
) -> StreamingResponse:
    """Run one build turn and stream what happens as it happens."""
    project = await _owned_project(project_id, learner_id)
    language = normalize_language(data.get("language") or project.get("language"))
    message = (data.get("message") or "").strip()[:MAX_MESSAGE_LENGTH]
    history = data.get("history") if isinstance(data.get("history"), list) else []

    async def stream():
        yield _sse({"disclosure": safety.disclosure(language)})

        if not message:
            yield _sse({"error": "empty_request"})
            yield "data: [DONE]\n\n"
            return

        # PII is redacted and the build continues; harmful content is the only
        # thing that stops a child from making something.
        screened = safety.screen_input(message, language)
        if safety.harmful_content_category(screened.text):
            yield _sse({"blocked": safety.redirect_message("respect", language)})
            yield "data: [DONE]\n\n"
            return

        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        if await repository.count_builds_since(learner_id, since) >= MAX_DAILY_BUILDS:
            yield _sse({"error": "daily_build_limit"})
            yield "data: [DONE]\n\n"
            return

        current_version = int(project.get("current_version") or 0)
        previous_html: Optional[str] = None
        if current_version > 0:
            record = await repository.get_version(project_id, current_version)
            if record is not None:
                try:
                    previous_html = await storage.get(record["blob_path"])
                except storage.StorageError:
                    previous_html = None

        try:
            understanding = await builder.understand(
                learner_id,
                message=screened.text,
                language=language,
                history=history,
                has_existing_version=previous_html is not None,
            )
        except Exception as exc:
            print(f"⚠️ workshop understand failed: {type(exc).__name__}: {exc}")
            understanding = {"ready": True, "question": "", "options": [], "title": "", "kind": "game"}

        if not understanding["ready"]:
            yield _sse({
                "question": understanding["question"],
                "options": understanding["options"],
            })
            yield "data: [DONE]\n\n"
            return

        if understanding.get("title") and not (project.get("title") or "").strip():
            await repository.update_project(
                project_id,
                {"title": understanding["title"], "kind": understanding["kind"]},
            )
            yield _sse({"title": understanding["title"]})

        objective_title = (data.get("objectiveTitle") or "").strip() or None

        steps: list[dict[str, str]] = []
        if previous_html is None:
            try:
                steps = await builder.plan(
                    learner_id,
                    message=screened.text,
                    language=language,
                    objective_title=objective_title,
                )
            except Exception as exc:
                print(f"⚠️ workshop plan failed: {type(exc).__name__}: {exc}")
            if steps:
                yield _sse({"plan": steps})

        collected: list[str] = []
        try:
            async for chunk in builder.build(
                learner_id,
                message=screened.text,
                language=language,
                history=history,
                previous_html=previous_html,
                objective_title=objective_title,
                plan_steps=steps,
            ):
                collected.append(chunk)
                yield _sse({"code": chunk})
        except Exception as exc:
            print(f"⚠️ workshop build failed: {type(exc).__name__}: {exc}")

        html = builder.extract_document("".join(collected))
        result = sanitizer.scan(html)
        if "empty_document" in result.codes or "unparsable" in result.codes:
            yield _sse({"error": "build_failed"})
            yield "data: [DONE]\n\n"
            return

        next_version = current_version + 1
        try:
            blob_path = storage.build_path(learner_id, project_id, next_version)
            await storage.put(blob_path, html)
        except storage.StorageError as exc:
            yield _sse({"error": str(exc)})
            yield "data: [DONE]\n\n"
            return

        await repository.add_version(
            project_id,
            learner_id,
            version=next_version,
            blob_path=blob_path,
            request=screened.text,
            summary=steps[0]["title"] if steps else "",
            safety_codes=result.codes,
        )
        await repository.update_project(project_id, {"current_version": next_version})

        yield _sse({
            "ready": {
                "version": next_version,
                "url": f"/api/workshop/projects/{project_id}/versions/{next_version}/artifact",
                "publishable": result.safe,
            }
        })

        learned = await builder.cards(
            learner_id,
            message=screened.text,
            language=language,
            objective_title=objective_title,
        )
        if learned.get("know") or learned.get("challenge"):
            yield _sse({"cards": learned})

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
