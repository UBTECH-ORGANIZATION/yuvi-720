"""Visual generation for the Learning Coach.

`shapes` is the renderer-neutral layer: props and freehand drawings are built
once as canvas-space dicts, then drawn by Manim, by the server SVG renderer, or
by anything added later. Everything else still lives in `agents.manim_visual`
and moves here in the next phase.
"""
