"""Figures for game questions: a resolved figure spec → SVG or HTML.

The figure is the context the kid reads (a grid with points, a number line,
a sentence with a highlighted word, a table). Specs are composed from a few
generic primitives so no subject needs its own renderer; everything is text
we escape, so the output is safe to drop into the game overlay with
``innerHTML``. Elements with a ``target`` become hotspot targets
(``data-target``) for the ``hotspot`` interaction.

``describe`` writes the same figure as prose — the answerability judge
reads that, and it is the ``alt`` of the rendered figure.
"""

from __future__ import annotations

import html
from typing import Any

W, H = 360, 260
PAD = 34
_FONT = "font-family:system-ui,-apple-system,Segoe UI,Rubik,Arial,sans-serif"
_INK = "#16202c"
_MUTED = "#6b7280"
_GRID = "rgba(107,114,128,.28)"
_ACCENT = "#0891b2"
_ACCENT_2 = "#d97706"
_FILL = {"accent": "rgba(8,145,178,.22)", "warm": "rgba(217,119,6,.22)", "none": "none"}
_MAX_ITEMS = 40

_ITEM_KINDS = ("point", "icon", "label", "segment", "arrow", "polygon", "rect", "ellipse", "bar")


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _target_attrs(item: dict[str, Any]) -> str:
    if not item.get("target"):
        return ""
    return f' data-target="{_esc(item["target"])}" class="yv-target" role="button" tabindex="0"'


class _Map:
    """Spec units → pixels for the graphic frames."""

    def __init__(self, frame: dict[str, Any]):
        if "axes" in frame:
            self.kind = "axes"
            self.x0, self.x1 = float(frame["axes"]["x"][0]), float(frame["axes"]["x"][1])
            self.y0, self.y1 = float(frame["axes"]["y"][0]), float(frame["axes"]["y"][1])
        elif "axis" in frame:
            self.kind = "axis"
            self.x0, self.x1 = float(frame["axis"]["x"][0]), float(frame["axis"]["x"][1])
            self.y0, self.y1 = -1.0, 1.0
        else:
            self.kind = "box"
            box = frame.get("box") or [10, 8]
            self.x0, self.y0 = 0.0, 0.0
            self.x1, self.y1 = float(box[0]), float(box[1])
        if self.x1 <= self.x0 or self.y1 <= self.y0:
            raise ValueError("frame range is empty")
        self.height = 90 if self.kind == "axis" else H

    def x(self, value: float) -> float:
        return PAD + (float(value) - self.x0) / (self.x1 - self.x0) * (W - 2 * PAD)

    def y(self, value: float) -> float:
        if self.kind == "axis":
            return self.height / 2
        return self.height - PAD - (float(value) - self.y0) / (self.y1 - self.y0) * (self.height - 2 * PAD)

    def inside(self, point: list[float]) -> bool:
        x, y = float(point[0]), float(point[1])
        if self.kind == "axis":
            return self.x0 <= x <= self.x1
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1


def _ticks(lo: float, hi: float) -> list[float]:
    span = hi - lo
    step = 1.0
    for candidate in (1, 2, 5, 10, 20, 50, 100, 250, 500, 1000):
        if span / candidate <= 12:
            step = float(candidate)
            break
    out, value = [], lo
    while value <= hi + 1e-9:
        out.append(round(value, 6))
        value += step
    return out


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def _frame_svg(frame: dict[str, Any], m: _Map) -> list[str]:
    parts: list[str] = []
    labels = frame.get("labels") or {}
    if m.kind == "axes":
        for tx in _ticks(m.x0, m.x1):
            parts.append(f'<line x1="{m.x(tx):.1f}" y1="{m.y(m.y0):.1f}" x2="{m.x(tx):.1f}" y2="{m.y(m.y1):.1f}" stroke="{_GRID}" stroke-width="1"/>')
            parts.append(f'<text x="{m.x(tx):.1f}" y="{m.y(m.y0) + 14:.1f}" text-anchor="middle" font-size="10" fill="{_MUTED}">{_fmt(tx)}</text>')
        for ty in _ticks(m.y0, m.y1):
            parts.append(f'<line x1="{m.x(m.x0):.1f}" y1="{m.y(ty):.1f}" x2="{m.x(m.x1):.1f}" y2="{m.y(ty):.1f}" stroke="{_GRID}" stroke-width="1"/>')
            parts.append(f'<text x="{m.x(m.x0) - 6:.1f}" y="{m.y(ty) + 3.5:.1f}" text-anchor="end" font-size="10" fill="{_MUTED}">{_fmt(ty)}</text>')
        ox = m.x(0) if m.x0 <= 0 <= m.x1 else m.x(m.x0)
        oy = m.y(0) if m.y0 <= 0 <= m.y1 else m.y(m.y0)
        parts.append(f'<line x1="{m.x(m.x0):.1f}" y1="{oy:.1f}" x2="{m.x(m.x1) + 6:.1f}" y2="{oy:.1f}" stroke="{_INK}" stroke-width="1.6"/>')
        parts.append(f'<line x1="{ox:.1f}" y1="{m.y(m.y0):.1f}" x2="{ox:.1f}" y2="{m.y(m.y1) - 6:.1f}" stroke="{_INK}" stroke-width="1.6"/>')
        parts.append(f'<text x="{m.x(m.x1) + 8:.1f}" y="{oy + 4:.1f}" font-size="11" font-weight="600" fill="{_INK}">{_esc(labels.get("x") or "x")}</text>')
        parts.append(f'<text x="{ox + 6:.1f}" y="{m.y(m.y1) - 8:.1f}" font-size="11" font-weight="600" fill="{_INK}">{_esc(labels.get("y") or "y")}</text>')
    elif m.kind == "axis":
        y = m.y(0)
        parts.append(f'<line x1="{m.x(m.x0) - 4:.1f}" y1="{y:.1f}" x2="{m.x(m.x1) + 8:.1f}" y2="{y:.1f}" stroke="{_INK}" stroke-width="1.6"/>')
        for tx in _ticks(m.x0, m.x1):
            parts.append(f'<line x1="{m.x(tx):.1f}" y1="{y - 5:.1f}" x2="{m.x(tx):.1f}" y2="{y + 5:.1f}" stroke="{_INK}" stroke-width="1.2"/>')
            parts.append(f'<text x="{m.x(tx):.1f}" y="{y + 18:.1f}" text-anchor="middle" font-size="10" fill="{_MUTED}">{_fmt(tx)}</text>')
    return parts


def _item_svg(item: dict[str, Any], m: _Map) -> str:
    kind = item.get("kind")
    label = item.get("label")
    attrs = _target_attrs(item)
    dashed = ' stroke-dasharray="6 4"' if item.get("style") == "dashed" else ""
    fill = _FILL.get(str(item.get("fill") or "accent"), _FILL["accent"])
    parts: list[str] = []

    def text_at(x: float, y: float, text: Any, anchor: str = "middle", size: int = 12, weight: int = 600, color: str = _INK) -> str:
        return (f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" font-size="{size}" '
                f'font-weight="{weight}" fill="{color}" paint-order="stroke" stroke="#fff" stroke-width="3">{_esc(text)}</text>')

    if kind in ("point", "icon") and item.get("at"):
        x, y = m.x(item["at"][0]), m.y(item["at"][1])
        if kind == "point":
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{5 if not attrs else 9}" fill="{_ACCENT}" stroke="#fff" stroke-width="1.5"{attrs}/>')
        else:
            parts.append(f'<text x="{x:.1f}" y="{y + 7:.1f}" text-anchor="middle" font-size="20"{attrs}>{_esc(item.get("icon") or "⭐")}</text>')
        if label:
            parts.append(text_at(x + 8, y - 8, label, anchor="start"))
    elif kind == "label" and item.get("at"):
        parts.append(text_at(m.x(item["at"][0]), m.y(item["at"][1]) + 4, item.get("text") or label or ""))
    elif kind in ("segment", "arrow") and item.get("from") and item.get("to"):
        x1, y1 = m.x(item["from"][0]), m.y(item["from"][1])
        x2, y2 = m.x(item["to"][0]), m.y(item["to"][1])
        marker = ' marker-end="url(#yv-arrow)"' if kind == "arrow" else ""
        parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{_ACCENT_2}" stroke-width="2.5"{dashed}{marker}{attrs}/>')
        if label:
            parts.append(text_at((x1 + x2) / 2, (y1 + y2) / 2 - 8, label))
    elif kind == "polygon" and item.get("points"):
        pts = " ".join(f"{m.x(p[0]):.1f},{m.y(p[1]):.1f}" for p in item["points"])
        parts.append(f'<polygon points="{pts}" fill="{fill}" stroke="{_ACCENT}" stroke-width="2"{dashed}{attrs}/>')
        if label:
            cx = sum(m.x(p[0]) for p in item["points"]) / len(item["points"])
            cy = sum(m.y(p[1]) for p in item["points"]) / len(item["points"])
            parts.append(text_at(cx, cy + 4, label))
    elif kind == "rect" and item.get("at"):
        w, h = float(item.get("w") or 1), float(item.get("h") or 1)
        x, y = m.x(item["at"][0]), m.y(item["at"][1] + h)
        pw, ph = m.x(item["at"][0] + w) - x, m.y(item["at"][1]) - y
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{pw:.1f}" height="{ph:.1f}" rx="3" fill="{fill}" stroke="{_ACCENT}" stroke-width="2"{attrs}/>')
        if label:
            parts.append(text_at(x + pw / 2, y + ph / 2 + 4, label))
    elif kind == "ellipse" and item.get("at"):
        rx, ry = float(item.get("rx") or item.get("r") or 1), float(item.get("ry") or item.get("r") or 1)
        x, y = m.x(item["at"][0]), m.y(item["at"][1])
        prx, pry = m.x(item["at"][0] + rx) - x, y - m.y(item["at"][1] + ry)
        parts.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{prx:.1f}" ry="{pry:.1f}" fill="{fill}" stroke="{_ACCENT}" stroke-width="2"{attrs}/>')
        if label:
            parts.append(text_at(x, y + 4, label))
    elif kind == "bar" and item.get("at"):
        # A bar from the baseline (y of `at`) up to `value`; width `w` (default 1).
        w = float(item.get("w") or 1)
        value = float(item.get("value") or 0)
        x = m.x(item["at"][0] - w / 2)
        top = m.y(item["at"][1] + value)
        base = m.y(item["at"][1])
        pw = m.x(item["at"][0] + w / 2) - x
        parts.append(f'<rect x="{x:.1f}" y="{min(top, base):.1f}" width="{pw:.1f}" height="{abs(base - top):.1f}" fill="{_FILL["accent"]}" stroke="{_ACCENT}" stroke-width="2"{attrs}/>')
        parts.append(text_at(x + pw / 2, min(top, base) - 6, _fmt(value), size=11))
        if label:
            parts.append(text_at(x + pw / 2, base + 14, label, size=11))
    return "".join(parts)


def _graphic_svg(spec: dict[str, Any]) -> str:
    frame = spec.get("frame") or {"box": [10, 8]}
    m = _Map(frame)
    body = ['<defs><marker id="yv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{_ACCENT_2}"/></marker></defs>',
            f'<rect x="0" y="0" width="{W}" height="{m.height}" rx="12" fill="#ffffff" fill-opacity=".94"/>']
    body.extend(_frame_svg(frame, m))
    for item in (spec.get("items") or [])[:_MAX_ITEMS]:
        body.append(_item_svg(item, m))
    return (f'<svg data-yuvi-figure="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {m.height}" '
            f'role="img" aria-label="{_esc(describe(spec))}" style="width:100%;max-width:{W * 1.4:.0f}px;height:auto;display:block;{_FONT}">'
            + "".join(body) + "</svg>")


def _text_html(spec: dict[str, Any]) -> str:
    text = str(spec.get("text") or "")
    spans = [s for s in (spec.get("spans") or []) if s.get("text")]
    out = _esc(text)
    for span in spans:
        mark = str(span.get("mark") or "highlight")
        style = {
            "highlight": "background:rgba(8,145,178,.25);border-radius:4px;padding:0 3px",
            "underline": "text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:#d97706",
            "blank": "display:inline-block;min-width:3em;border-bottom:2px solid #16202c",
        }.get(mark, "background:rgba(8,145,178,.25)")
        attrs = f' data-target="{_esc(span["target"])}" class="yv-target" role="button" tabindex="0"' if span.get("target") else ""
        needle = _esc(span["text"])
        replacement = f'<mark style="{style};color:inherit"{attrs}>{"" if mark == "blank" else needle}</mark>'
        out = out.replace(needle, replacement, 1) if needle in out else out + " " + replacement
    return (f'<div data-yuvi-figure="1" role="img" aria-label="{_esc(describe(spec))}" '
            f'style="background:#fff;color:{_INK};border-radius:12px;padding:16px 20px;font-size:1.25rem;line-height:1.7;{_FONT}">{out}</div>')


def _table_html(spec: dict[str, Any]) -> str:
    table = spec.get("table") or {}
    rows = [r for r in (table.get("rows") or []) if isinstance(r, list)][:12]
    header = bool(table.get("header")) and rows
    cells = []
    for i, row in enumerate(rows):
        tag = "th" if header and i == 0 else "td"
        cells.append("<tr>" + "".join(
            f'<{tag} style="padding:6px 12px;border:1px solid rgba(107,114,128,.4);text-align:center">{_esc(c)}</{tag}>'
            for c in row[:8]) + "</tr>")
    return (f'<div data-yuvi-figure="1" role="img" aria-label="{_esc(describe(spec))}" '
            f'style="background:#fff;color:{_INK};border-radius:12px;padding:12px 16px;{_FONT};overflow:auto">'
            f'<table style="border-collapse:collapse;margin:0 auto;font-size:1.05rem">{"".join(cells)}</table></div>')


def render(spec: dict[str, Any]) -> dict[str, str]:
    """``{"html", "kind", "alt"}`` for a resolved spec."""
    if "text" in spec:
        return {"html": _text_html(spec), "kind": "html", "alt": describe(spec)}
    if "table" in spec:
        return {"html": _table_html(spec), "kind": "html", "alt": describe(spec)}
    return {"html": _graphic_svg(spec), "kind": "svg", "alt": describe(spec)}


def targets(spec: dict[str, Any]) -> list[str]:
    ids = [str(i["target"]) for i in (spec.get("items") or []) if i.get("target")]
    ids += [str(s["target"]) for s in (spec.get("spans") or []) if s.get("target")]
    return list(dict.fromkeys(ids))


def _pt(point: list[float]) -> str:
    return f"({_fmt(float(point[0]))},{_fmt(float(point[1]))})"


def describe(spec: dict[str, Any]) -> str:
    """The figure in words: what the judge reads and what a screen reader hears."""
    if not spec:
        return ""
    if "text" in spec:
        marks = [f"{s.get('mark') or 'highlight'} on “{s.get('text')}”" for s in (spec.get("spans") or []) if s.get("text")]
        return f"Text: “{spec.get('text')}”" + (f" — {'; '.join(marks)}" if marks else "")
    if "table" in spec:
        rows = (spec.get("table") or {}).get("rows") or []
        return "Table: " + " / ".join(", ".join(str(c) for c in row) for row in rows)
    frame = spec.get("frame") or {}
    if "axes" in frame:
        head = (f"Coordinate grid, x from {_fmt(frame['axes']['x'][0])} to {_fmt(frame['axes']['x'][1])}, "
                f"y from {_fmt(frame['axes']['y'][0])} to {_fmt(frame['axes']['y'][1])}")
    elif "axis" in frame:
        head = f"Number line from {_fmt(frame['axis']['x'][0])} to {_fmt(frame['axis']['x'][1])}"
    else:
        head = "Diagram"
    parts = []
    for item in spec.get("items") or []:
        kind = item.get("kind")
        name = item.get("label") or item.get("text") or ""
        tgt = f" [target {item['target']}]" if item.get("target") else ""
        if kind == "point":
            parts.append(f"point {name or ''} at {_pt(item['at'])}{tgt}".replace("  ", " "))
        elif kind == "icon":
            parts.append(f"{item.get('icon') or 'icon'} {name} at {_pt(item['at'])}{tgt}".strip())
        elif kind == "label":
            parts.append(f"label “{name}” at {_pt(item['at'])}")
        elif kind in ("segment", "arrow"):
            parts.append(f"{kind} {name} from {_pt(item['from'])} to {_pt(item['to'])}{tgt}".replace("  ", " "))
        elif kind == "polygon":
            parts.append(f"polygon {name} with vertices {' '.join(_pt(p) for p in item['points'])}{tgt}".replace("  ", " "))
        elif kind == "rect":
            parts.append(f"rectangle {name} at {_pt(item['at'])} width {_fmt(item.get('w') or 1)} height {_fmt(item.get('h') or 1)}{tgt}".replace("  ", " "))
        elif kind == "ellipse":
            parts.append(f"ellipse {name} centred at {_pt(item['at'])}{tgt}".replace("  ", " "))
        elif kind == "bar":
            parts.append(f"bar {name} = {_fmt(item.get('value') or 0)}{tgt}".replace("  ", " "))
    return head + (". " + "; ".join(parts) if parts else "") + "."


def validate_spec(spec: dict[str, Any]) -> list[str]:
    """Problems a renderer would hide: empty frames, positions off the frame,
    unknown item kinds, unlabeled hotspot targets."""
    errors: list[str] = []
    if "text" in spec:
        if not str(spec.get("text") or "").strip():
            errors.append("text figure is empty")
        return errors
    if "table" in spec:
        if not (spec.get("table") or {}).get("rows"):
            errors.append("table has no rows")
        return errors
    try:
        m = _Map(spec.get("frame") or {"box": [10, 8]})
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        return [f"bad frame: {exc}"]
    items = spec.get("items") or []
    if not items:
        errors.append("figure has no items")
    if len(items) > _MAX_ITEMS:
        errors.append(f"too many items ({len(items)})")
    for item in items:
        kind = item.get("kind")
        if kind not in _ITEM_KINDS:
            errors.append(f"unknown item kind '{kind}'")
            continue
        points = [item[k] for k in ("at", "from", "to") if item.get(k)] + list(item.get("points") or [])
        if not points:
            errors.append(f"{kind} has no position")
            continue
        for p in points:
            if not m.inside(p):
                errors.append(f"{kind} at {_pt(p)} is outside the frame")
                break
    seen: set[str] = set()
    for t in targets(spec):
        if t in seen:
            errors.append(f"duplicate target '{t}'")
        seen.add(t)
    return errors
