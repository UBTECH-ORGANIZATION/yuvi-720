"""Draw the picture plates for the class book (#450).

SIX variants per moment kind — the book assigns each same-kind moment a
DIFFERENT plate (bookModel.platePlan), so a picture repeats only when one
kind fills more than six pages. The scenes are realistic school scenes: a
student, sometimes a teacher, progress charts — not symbolic nature plates
(v1 was symbolic; the teacher asked for people and improvement). The special
"cover" kind is drawn portrait: it is the artwork on the book's front cover.

Output: frontend/public/moments/<kind>-<n>.png (n = 1..6, cover 1..3). The
book falls back <kind>-1 → SVG scene, so a failed draw degrades quietly.

The Azure filter rejects ~1 in 10 prompts arbitrarily (see the english-unit
pipeline's scars) — a failure is retried once with a softening suffix, and
what still fails is listed for a reworded `--only kind:variant` rerun.

Run:  .venv/bin/python scripts/generate_moment_images.py [--only kind:1 ...]
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

OUT_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "moments"

# One voice for the whole book: warm, real, adult in tone — these plates sit
# on a teacher's dashboard. Faces stay generic; nobody is a real child.
STYLE = (
    "Warm semi-realistic editorial illustration, soft natural light, a "
    "contemporary middle-school setting, gentle painterly texture, muted "
    "warm palette of cream, dusty teal, terracotta and ink navy. "
    "No text, no letters, no numbers anywhere in the image."
)

VARIANTS: dict[str, list[str]] = {
    "breakthrough": [
        "A student at a classroom desk looks up from a laptop with sudden "
        "delight, morning light streaming through the window.",
        "A student stands at a whiteboard just finishing a long worked "
        "solution, marker still raised, quietly triumphant.",
        "A teacher and a student share a high-five beside a desk with an "
        "open notebook full of finished work.",
        "A student in a school library snaps their head up from a thick "
        "workbook, eyes bright with a sudden idea, shelves softly blurred "
        "behind.",
        "A small study group at a round table erupts in quiet celebration "
        "as one student's worked page finally comes out right.",
        "A student by a classroom window leans back with a relieved smile, "
        "pencil resting on a finished exercise.",
    ],
    "first_mastery": [
        "A student proudly holds up a notebook page with a large correct "
        "check mark drawn on it.",
        "A teacher pins a student's finished work onto a classroom wall "
        "display while the student watches, pleased.",
        "A student places a gold star sticker onto a wall progress chart, "
        "standing on tiptoe.",
        "A student rings a small desk bell at the front of the classroom "
        "while classmates clap softly.",
        "A close view of a student's hand drawing the final line of a "
        "first perfectly solved exercise in a fresh notebook.",
        "A student turns a laptop to show a friend at the next desk the "
        "green completion screen of a finished lesson.",
    ],
    "hard_question_cracked": [
        "A student leans over a difficult puzzle worksheet, pencil raised in "
        "triumph, scattered draft pages around.",
        "Three students at a table look amazed as one of them explains the "
        "solution on a sheet of paper between them.",
        "A close view of a student's hands completing the final piece of a "
        "complex geometry construction on paper.",
        "A student stands back from a whiteboard covered in a long solved "
        "problem, arms crossed, quietly proud.",
        "Two students bump fists over a worksheet whose hardest exercise "
        "is finally solved between them.",
        "A student in a science lab lifts their safety goggles with a grin "
        "after a tricky experiment finally worked.",
    ],
    "recovery": [
        "A student smiles again at a desk: crumpled drafts pushed aside, a "
        "clean fresh page just begun.",
        "A line chart on a classroom screen dips and then rises steeply; a "
        "student points at the rising part, smiling.",
        "A teacher crouches beside a desk, encouraging a student whose open "
        "page shows fresh, correct work.",
        "A student wipes an old attempt off a small whiteboard and starts "
        "a fresh line of work, shoulders relaxed.",
        "Morning classroom: a student opens a brand-new page, calm and "
        "ready, sunlight falling across the desk.",
        "A teacher hands back a corrected page with an encouraging nod; "
        "the student receives it with a hopeful smile.",
    ],
    "comeback": [
        "A student returns to a sunlit classroom desk with quiet "
        "determination, school bag still over one shoulder.",
        "A wall progress chart with a long flat gap and then a strong rise; "
        "a student adds the newest climbing point.",
        "A student settles back in front of a laptop after days away, "
        "rolling up sleeves, ready to begin.",
        "A student hangs their coat by the classroom door after a long "
        "absence, greeted by a warm wave from the teacher.",
        "A student reopens a long-closed notebook with playful "
        "determination, dust motes in the window light.",
        "An empty desk filled again: a student unpacks a pencil case while "
        "friends lean over from nearby desks to welcome them.",
    ],
    "sustained_effort": [
        "A student in deep, calm focus at a desk, a neat stack of finished "
        "exercise pages growing beside the notebook.",
        "A student adds one more mark to a wall calendar showing a long "
        "unbroken row of completed days.",
        "Late golden afternoon light; a student still practicing patiently "
        "at a quiet classroom desk.",
        "A student practices at a library table, headphones on, a steady "
        "pile of completed pages beside the laptop.",
        "An almost-empty classroom in soft evening light; one student "
        "still working calmly, neat notes and a water bottle beside them.",
        "A student runs a finger down a well-used notebook margin filled "
        "with a long unbroken column of small ticks.",
    ],
    "personal_best": [
        "A student looks at a progress chart on a tablet that has just "
        "reached its highest point ever, eyes wide.",
        "A teacher shows a student their improvement graph on a screen, "
        "both of them smiling at the climb.",
        "A student raises both arms at a desk in quiet victory, the laptop "
        "screen showing a personal record day.",
        "A student half-leaps out of their chair, fist raised, as a tablet "
        "shows their best result yet.",
        "A teacher draws a steeply rising curve on the board while the "
        "student it belongs to beams from the front row.",
        "A student reaches up to move their marker past its highest "
        "previous point on a tall wall progress chart.",
    ],
    "goal_done": [
        "A student checks the last box on a handwritten goal list pinned "
        "above a tidy desk.",
        "A teacher and a student review a completed learning plan together "
        "and tick its final line.",
        "A student closes a workbook with deep satisfaction, a finished "
        "goal card lying on top of it.",
        "A student draws a bold final tick on a whiteboard checklist and "
        "steps back to admire it.",
        "A student and a teacher shake hands over a completed project "
        "folder on a tidy desk.",
        "A student hangs the last paper flag of a garland across the "
        "classroom wall, marking a finished class goal.",
    ],
    "wellbeing_shared": [
        "A teacher and a student sit in a quiet, warm corner of a "
        "classroom, having a caring conversation.",
        "Two students talk on a bench in a school corridor; one listens "
        "warmly, leaning in.",
        "A student and a school counselor sit at a small table with two "
        "cups of tea, mid-conversation, soft light.",
        "A teacher kneels to a student's eye level in a quiet corridor, "
        "listening with full attention.",
        "Two students share a snack on the school steps, one clearly "
        "comforting the other, soft afternoon light.",
        "A student and a teacher walk slowly across the schoolyard in "
        "conversation, trees in gentle light behind them.",
    ],
    "misconception_resolved": [
        "A teacher untangles an idea on a whiteboard with a clear simple "
        "diagram while a student nods in understanding.",
        "A student compares a crossed-out early attempt with the corrected, "
        "clean solution beside it, finally seeing why.",
        "Two diagrams on a classroom board — one muddled, one clear — and a "
        "student pointing confidently at the clear one.",
        "A student rearranges paper cards on a desk into the right order "
        "while a teacher points encouragingly.",
        "A student's face mid-change from a puzzled frown to wide-eyed "
        "understanding in front of a laptop.",
        "A teacher folds a sheet of paper to demonstrate an idea; the "
        "student leans in, finally seeing it.",
    ],
    "feelings_journey": [
        "A student walks into school under a clearing sky, closed umbrella "
        "in hand, the rain just ended.",
        "A student at a desk: the morning's heaviness giving way to a small "
        "genuine smile as the work begins.",
        "A teacher greets a student warmly at the classroom door at the "
        "start of the day.",
        "A student gazes out of a bright classroom window, the last rain "
        "clouds drifting away outside.",
        "A student takes a deep, steadying breath before starting their "
        "work, a kind teacher standing nearby.",
        "A student walks down a school corridor from shadow into warm "
        "window light, posture lifting with each step.",
    ],
    # The book's front-cover artwork — PORTRAIT, no people: a cover is an
    # object, not a moment, so it stays a warm classroom still life.
    "cover": [
        "A warm still life on a wooden school desk: a stack of well-loved "
        "notebooks, a small potted plant, a jar of pencils and a folded "
        "paper airplane, golden afternoon light from a tall window.",
        "A sunlit empty classroom seen from the back: rows of wooden "
        "desks, a green chalkboard, drifting dust motes in warm light.",
        "A shelf of colorful well-worn notebooks and books beside a small "
        "trophy and a paper star garland, soft window light.",
    ],
}

# portrait for the cover (it dresses the book's front), landscape for plates
SIZE_BY_KIND = {"cover": "1024x1536"}

SOFTEN = " Gentle, wholesome, calm everyday school scene."


def draw(kind: str, index: int, prompt: str) -> None:
    base = os.environ["APIM_IMAGE_ENDPOINT"].rstrip("/")
    model = os.environ["APIM_IMAGE_MODEL"]
    url = (f"{base}/openai/deployments/{model}/images/generations"
           f"?api-version={os.environ['APIM_IMAGE_API_VERSION']}")
    request = urllib.request.Request(
        url,
        method="POST",
        headers={
            "api-key": os.environ["APIM_IMAGE_API_KEY"],
            "Content-Type": "application/json",
        },
        data=json.dumps({
            "model": model,
            "prompt": f"{prompt} {STYLE}",
            # Landscape: the plate sits above the caption on a book page.
            # (The cover is the one portrait: it dresses the book's front.)
            "size": SIZE_BY_KIND.get(kind, "1536x1024"),
            "quality": "medium",
            "n": 1,
        }).encode(),
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        payload = json.load(response)
    data = base64.b64decode(payload["data"][0]["b64_json"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{kind}-{index}.png").write_bytes(data)
    print(f"  ✔ {kind}-{index} ({len(data) // 1024} KB)", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*",
                        help="draw just these, as kind or kind:variant")
    args = parser.parse_args()
    todo: list[tuple[str, int]] = []
    for spec in (args.only or list(VARIANTS)):
        kind, _, variant = spec.partition(":")
        indices = ([int(variant)] if variant
                   else list(range(1, len(VARIANTS[kind]) + 1)))
        todo.extend((kind, index) for index in indices)

    failed: list[str] = []
    for kind, index in todo:
        prompt = VARIANTS[kind][index - 1]
        try:
            draw(kind, index, prompt)
        except Exception:
            try:  # one retry with a softening suffix — never verbatim
                draw(kind, index, prompt + SOFTEN)
            except Exception as error:
                failed.append(f"{kind}:{index}")
                print(f"  ✘ {kind}-{index}: {error}", flush=True)
    if failed:
        print(f"\nfailed: {' '.join(failed)} — reword their VARIANTS entries "
              f"and rerun with --only")
        sys.exit(1)
    print("\nall plates drawn")


if __name__ == "__main__":
    main()
