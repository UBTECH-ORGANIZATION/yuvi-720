"""Teacher/student messaging and calendar API routes."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

import classroom_store as store


router = APIRouter(prefix="/api", tags=["classroom"])

DEFAULT_TEACHER_ID = "demo-teacher"
DEFAULT_LEARNER_ID = "demo-learner"


def _participants(source: dict) -> tuple[str, str]:
    teacher_id = store.normalize_actor_id(source.get("teacher_id"), DEFAULT_TEACHER_ID)
    learner_id = store.normalize_actor_id(source.get("learner_id"), DEFAULT_LEARNER_ID)
    return teacher_id, learner_id


@router.get("/messages/threads")
async def read_threads(request: Request):
    """List every thread belonging to a teacher, newest activity first."""
    teacher_id = store.normalize_actor_id(request.query_params.get("teacher_id"), DEFAULT_TEACHER_ID)
    threads = await store.list_threads(teacher_id)
    threads.sort(key=lambda thread: thread.get("updated_at", ""), reverse=True)
    return JSONResponse(content={"threads": threads})


@router.get("/messages/thread")
async def read_thread(request: Request):
    teacher_id, learner_id = _participants(dict(request.query_params))
    return JSONResponse(content=await store.get_thread(teacher_id, learner_id))


@router.post("/messages/thread")
async def post_message(data: dict):
    teacher_id, learner_id = _participants(data)
    text = str(data.get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message text is required")
    sender = "teacher" if data.get("sender") == "teacher" else "learner"
    return JSONResponse(content=await store.append_message(teacher_id, learner_id, sender, text))


@router.post("/messages/thread/read")
async def post_thread_read(data: dict):
    teacher_id, learner_id = _participants(data)
    reader = "teacher" if data.get("reader") == "teacher" else "learner"
    return JSONResponse(content=await store.mark_thread_read(teacher_id, learner_id, reader))


@router.get("/calendar/events")
async def read_events(request: Request):
    owner_id = store.normalize_actor_id(request.query_params.get("owner_id"), DEFAULT_TEACHER_ID)
    return JSONResponse(content={"events": await store.list_events(owner_id)})


@router.post("/calendar/events")
async def post_event(data: dict):
    owner_id = store.normalize_actor_id(data.get("owner_id"), DEFAULT_TEACHER_ID)
    if not str(data.get("title", "")).strip():
        raise HTTPException(status_code=400, detail="Event title is required")
    if not str(data.get("date", "")).strip():
        raise HTTPException(status_code=400, detail="Event date is required")
    return JSONResponse(content=await store.create_event(owner_id, data))


@router.patch("/calendar/events/{event_id}")
async def patch_event(event_id: str, data: dict):
    owner_id = store.normalize_actor_id(data.get("owner_id"), DEFAULT_TEACHER_ID)
    updated = await store.update_event(owner_id, event_id, data)
    if updated is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return JSONResponse(content=updated)


@router.delete("/calendar/events/{event_id}")
async def remove_event(event_id: str, request: Request):
    owner_id = store.normalize_actor_id(request.query_params.get("owner_id"), DEFAULT_TEACHER_ID)
    if not await store.delete_event(owner_id, event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    return JSONResponse(content={"deleted": event_id})
