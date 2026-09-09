"""The question blueprint DSL: data the model writes, code we evaluate.

A blueprint is a generator for one Kata question. It is JSON only — params
with domains, arithmetic on them, format strings with `{slots}`, an optional
figure spec — and this module turns it into concrete *instances* with a
seeded random source, so the same seed always yields the same question and
different seeds yield different numbers, words or variants.

Nothing here knows a subject. Expressions go through an AST allow-list (no
names beyond the params, no attribute access, no calls beyond a handful of
numeric helpers), which is what makes model-authored blueprints safe to run
on the server on every ``next()``.

See docs/design/game-question-blueprints.md.
"""

from __future__ import annotations

import ast
import operator
import random
import re
from typing import Any, Optional

from app.services.games import figures

DSL_VERSION = 1
INTERACTIONS = ("choice", "text", "hotspot")
MIN_DISTRACTORS = 3
MAX_OPTIONS = 5
MAX_STEM_CHARS = 200
MAX_EXPR_CHARS = 200
MAX_ABS_VALUE = 1e9
_TRIES = 60

#: Icon per theme slot role when the game brings no vocabulary of its own.
DEFAULT_ICONS = {
    "object": "⭐", "place": "🏁", "actor": "🙂", "collectible": "💎",
    "obstacle": "🪨", "container": "📦", "unit_label": "🔢", "vehicle": "🚀",
}


class DslError(ValueError):
    """A blueprint that cannot be evaluated. The message says where."""


# ── expressions ──────────────────────────────────────────────────────────────

_BIN = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
}
_CMP = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
    ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge,
}
_FUNCS: dict[str, Any] = {
    "min": min, "max": max, "abs": abs, "round": round, "len": len,
    "int": int, "float": float, "str": str,
}


def _check_number(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if value != value or abs(value) > MAX_ABS_VALUE:  # NaN or huge
            raise DslError("value out of range")
    return value


def _eval_node(node: ast.AST, env: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, env)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, str, bool)) or node.value is None:
            return node.value
        raise DslError("unsupported constant")
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        raise DslError(f"unknown name '{node.id}'")
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        left, right = _eval_node(node.left, env), _eval_node(node.right, env)
        if isinstance(left, str) or isinstance(right, str):
            if isinstance(node.op, ast.Add) and isinstance(left, str) and isinstance(right, str):
                return left + right
            raise DslError("arithmetic on text")
        try:
            return _check_number(_BIN[type(node.op)](left, right))
        except ZeroDivisionError:
            raise DslError("division by zero") from None
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
        base, exp = _eval_node(node.left, env), _eval_node(node.right, env)
        if not isinstance(exp, (int, float)) or abs(exp) > 6:
            raise DslError("exponent too large")
        return _check_number(base ** exp)
    if isinstance(node, ast.UnaryOp):
        value = _eval_node(node.operand, env)
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.UAdd):
            return +value
        if isinstance(node.op, ast.Not):
            return not value
        raise DslError("unsupported unary operator")
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, env)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval_node(comparator, env)
            if type(op) not in _CMP:
                raise DslError("unsupported comparison")
            if not _CMP[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BoolOp):
        values = [_eval_node(v, env) for v in node.values]
        return all(values) if isinstance(node.op, ast.And) else any(values)
    if isinstance(node, ast.IfExp):
        return _eval_node(node.body, env) if _eval_node(node.test, env) else _eval_node(node.orelse, env)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        args = [_eval_node(a, env) for a in node.args]
        try:
            return _check_number(_FUNCS[node.func.id](*args))
        except (TypeError, ValueError) as exc:
            raise DslError(f"bad call {node.func.id}: {exc}") from None
    raise DslError(f"unsupported expression node {type(node).__name__}")


def safe_eval(expr: Any, env: dict[str, Any]) -> Any:
    """Evaluate one expression against the params. Numbers, text, booleans."""
    if isinstance(expr, (int, float)) and not isinstance(expr, bool):
        return expr
    text = str(expr or "").strip()
    if not text:
        raise DslError("empty expression")
    if len(text) > MAX_EXPR_CHARS:
        raise DslError("expression too long")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError:
        raise DslError(f"cannot parse '{text[:40]}'") from None
    return _eval_node(tree, env)


def format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{round(value, 4):g}"
    return str(value)


_SLOT = re.compile(r"\{([^{}]+)\}")


def fill(template: Any, env: dict[str, Any]) -> str:
    """``"({x},{y})"`` → ``"(4,3)"``. Every slot is an expression."""
    return _SLOT.sub(lambda m: format_value(safe_eval(m.group(1), env)), str(template if template is not None else ""))


# ── params ───────────────────────────────────────────────────────────────────

def _draw_param(name: str, spec: Any, rng: random.Random, vocab: dict[str, Any], icons: dict[str, str]) -> Any:
    if not isinstance(spec, dict):
        raise DslError(f"param '{name}' must be an object")
    if "int" in spec:
        lo, hi = spec["int"]
        lo, hi = int(lo), int(hi)
        if hi < lo:
            raise DslError(f"param '{name}': empty range")
        return rng.randint(lo, hi)
    if "float" in spec:
        parts = list(spec["float"])
        lo, hi = float(parts[0]), float(parts[1])
        step = float(parts[2]) if len(parts) > 2 and parts[2] else 0.5
        if hi < lo or step <= 0:
            raise DslError(f"param '{name}': bad float range")
        steps = int((hi - lo) / step)
        return round(lo + step * rng.randint(0, steps), 6)
    if "pick" in spec:
        values = list(spec["pick"] or [])
        if not values:
            raise DslError(f"param '{name}': empty pick list")
        return rng.choice(values)
    if "theme" in spec:
        role = str(spec["theme"] or "object")
        entry = vocab.get(role) if isinstance(vocab.get(role), dict) else None
        noun = (entry or {}).get("noun") or spec.get("default") or role
        icons[name] = str((entry or {}).get("icon") or spec.get("icon") or DEFAULT_ICONS.get(role, "⭐"))
        return str(noun)
    raise DslError(f"param '{name}': unknown domain")


def _resolve_figure(spec: Any, env: dict[str, Any], icons: dict[str, str]) -> Optional[dict[str, Any]]:
    """Evaluate every expression inside a figure spec."""
    if not spec or not isinstance(spec, dict):
        return None

    def num(value: Any) -> float:
        out = safe_eval(value, env)
        if isinstance(out, bool) or not isinstance(out, (int, float)):
            raise DslError("figure coordinate is not a number")
        return out

    def point(value: Any) -> list[float]:
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise DslError("figure position must be [x, y]")
        return [num(value[0]), num(value[1])]

    out: dict[str, Any] = {}
    if "text" in spec:
        out["text"] = fill(spec.get("text"), env)
        out["spans"] = [{
            "text": fill(s.get("text"), env), "mark": str(s.get("mark") or "highlight"),
            **({"target": str(s["target"])} if s.get("target") else {}),
        } for s in (spec.get("spans") or []) if isinstance(s, dict)]
        return out
    if "table" in spec:
        table = spec["table"] if isinstance(spec["table"], dict) else {"rows": spec["table"]}
        out["table"] = {
            "rows": [[fill(cell, env) for cell in row] for row in (table.get("rows") or []) if isinstance(row, list)],
            "header": bool(table.get("header")),
        }
        return out
    frame = spec.get("frame") if isinstance(spec.get("frame"), dict) else {}
    resolved_frame: dict[str, Any] = {}
    if "axes" in frame:
        axes = frame["axes"] or {}
        resolved_frame["axes"] = {
            "x": [num(v) for v in (axes.get("x") or [0, 10])],
            "y": [num(v) for v in (axes.get("y") or [0, 10])],
        }
    elif "axis" in frame:
        resolved_frame["axis"] = {"x": [num(v) for v in ((frame["axis"] or {}).get("x") or [0, 10])]}
    elif "box" in frame:
        resolved_frame["box"] = [num(v) for v in frame["box"]]
    else:
        resolved_frame["box"] = [10, 8]
    if frame.get("labels"):
        resolved_frame["labels"] = {k: fill(v, env) for k, v in frame["labels"].items() if k in ("x", "y")}
    out["frame"] = resolved_frame
    items = []
    for raw in spec.get("items") or []:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind") or "")
        item: dict[str, Any] = {"kind": kind}
        for key in ("at", "from", "to"):
            if key in raw:
                item[key] = point(raw[key])
        if "points" in raw:
            item["points"] = [point(p) for p in raw["points"]]
        for key in ("w", "h", "rx", "ry", "r"):
            if key in raw:
                item[key] = num(raw[key])
        for key in ("label", "text"):
            if raw.get(key) is not None:
                item[key] = fill(raw[key], env)
        if "icon" in raw:
            icon = str(raw["icon"] or "")
            item["icon"] = icons.get(icon) or (fill(icon, env) if "{" in icon else icon)
        for key in ("target", "style", "fill"):
            if raw.get(key):
                item[key] = str(raw[key])
        if "value" in raw:
            item["value"] = num(raw["value"])
        items.append(item)
    out["items"] = items
    return out


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value if value is not None else "")).strip().casefold()


def instantiate(blueprint: dict[str, Any], seed: Any, theme_vocab: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """One concrete question from a blueprint. Deterministic in ``seed``.

    Returns ``{text, interaction, options, answer, accept, figure, alt, params,
    variant}`` — the figure is the *resolved spec* (render it with
    ``figures.render``); ``answer``/``accept`` are server-only."""
    rng = random.Random(str(seed))
    interaction = str(blueprint.get("interaction") or "choice")
    if interaction not in INTERACTIONS:
        raise DslError(f"unknown interaction '{interaction}'")
    vocab = theme_vocab or {}
    variants = [v for v in (blueprint.get("variants") or []) if isinstance(v, dict)]
    last_error: Optional[DslError] = None
    for _ in range(_TRIES):
        env: dict[str, Any] = {}
        icons: dict[str, str] = {}
        variant_index = rng.randrange(len(variants)) if variants else -1
        merged = dict(blueprint)
        if variant_index >= 0:
            merged.update({k: v for k, v in variants[variant_index].items() if k != "params"})
        try:
            for name, spec in (merged.get("params") or {}).items():
                env[str(name)] = _draw_param(str(name), spec, rng, vocab, icons)
            for name, expr in (merged.get("derived") or {}).items():
                env[str(name)] = safe_eval(expr, env)
            if not all(bool(safe_eval(c, env)) for c in (merged.get("constraints") or [])):
                continue
            stem = fill(merged.get("stem"), env).strip()
            answer = fill(merged.get("answer"), env).strip()
            accept = [answer] + [fill(a, env).strip() for a in (merged.get("accept") or [])]
            accept = list(dict.fromkeys(a for a in accept if a))
            figure = _resolve_figure(merged.get("figure"), env, icons)
            options: list[str] = []
            if interaction == "choice":
                seen = {_norm(answer)}
                distractors = []
                for d in merged.get("distractors") or []:
                    text = fill(d, env).strip()
                    if text and _norm(text) not in seen:
                        seen.add(_norm(text))
                        distractors.append(text)
                if len(distractors) < MIN_DISTRACTORS:
                    last_error = DslError(f"only {len(distractors)} distinct distractors")
                    continue
                options = [answer] + distractors[:MAX_OPTIONS - 1]
                rng.shuffle(options)
        except DslError as exc:
            last_error = exc
            continue
        if not stem or not answer:
            last_error = DslError("empty stem or answer")
            continue
        return {
            "text": stem, "interaction": interaction, "options": options,
            "answer": answer, "accept": accept, "figure": figure,
            "alt": figures.describe(figure) if figure else "",
            "params": {k: v for k, v in env.items()}, "variant": variant_index,
        }
    raise DslError(str(last_error) if last_error else "constraints never satisfied")


# ── phrasing ─────────────────────────────────────────────────────────────────

_MULTI_ASK = re.compile(r"(שני|שתי|שלוש|two|three|both|כל ה)\s*\S*\s*(פריטים|תשובות|items|answers)", re.IGNORECASE)
_LIST_ASK = re.compile(r"(סמנו|בחרו|mark|select|choose)\s+(את\s+)?(שני|שתי|כל|two|all|both)", re.IGNORECASE)


def stem_problems(stem: str, *, has_figure: bool) -> list[str]:
    """What makes a stem hard to read or impossible to answer as ONE
    question with ONE answer. Plain rules, no model."""
    text = str(stem or "")
    problems: list[str] = []
    if text.count("?") > 1:
        problems.append("stem asks more than one question (several '?')")
    if re.search(r"=\s*\?|\?\s*=|_{2,}|\.{3,}\s*=", text):
        problems.append("stem is a fill-in template ('x=?', '___'); ask one plain question instead")
    if text.count(":") >= 2 or text.count(",") >= 4:
        problems.append("stem lists several items to complete; ask about ONE value")
    if _MULTI_ASK.search(text) or _LIST_ASK.search(text):
        problems.append("stem asks for several answers; a question has exactly one")
    if not has_figure and re.search(r"בתמונה|באיור|בציור|בתרשים|בגרף|in the (picture|figure|diagram|graph)|shown", text, re.IGNORECASE):
        problems.append("stem refers to a picture but the blueprint has no figure")
    if len(text) > MAX_STEM_CHARS:
        problems.append(f"stem too long ({len(text)} chars)")
    return problems


def _needs_numbers(answer: str) -> bool:
    return bool(re.fullmatch(r"[\s\d.,()\-+×x*/=%]+", answer or "")) and any(ch.isdigit() for ch in answer or "")


# ── validation ───────────────────────────────────────────────────────────────

def validate_blueprint(blueprint: dict[str, Any], *, seeds: int = 50) -> list[str]:
    """Everything code can check. Empty list means the blueprint is usable."""
    errors: list[str] = []
    if not isinstance(blueprint, dict):
        return ["blueprint is not an object"]
    interaction = str(blueprint.get("interaction") or "")
    if interaction not in INTERACTIONS:
        errors.append(f"interaction must be one of {', '.join(INTERACTIONS)}")
    if not str(blueprint.get("stem") or "").strip() and not blueprint.get("variants"):
        errors.append("stem is empty")
    if not str(blueprint.get("answer") or "").strip() and not blueprint.get("variants"):
        errors.append("answer is empty")
    params = blueprint.get("params") or {}
    if not isinstance(params, dict):
        errors.append("params must be an object")
        params = {}
    for name in params:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(name)):
            errors.append(f"param name '{name}' is not an identifier")
    if errors:
        return errors

    instances: list[dict[str, Any]] = []
    failures: dict[str, int] = {}
    for seed in range(seeds):
        try:
            instances.append(instantiate(blueprint, f"validate-{seed}"))
        except DslError as exc:
            failures[str(exc)] = failures.get(str(exc), 0) + 1
    if failures:
        worst = max(failures.items(), key=lambda kv: kv[1])
        errors.append(f"{sum(failures.values())}/{seeds} seeds failed: {worst[0]}")
    if not instances:
        return errors

    for inst in instances[:seeds]:
        problems = stem_problems(inst["text"], has_figure=bool(inst["figure"]))
        if problems:
            errors.extend(problems)
            break
        # A numeric answer must be computable from what is shown: digits in
        # the stem or in the figure, or the question is a guess.
        if inst["interaction"] == "text" and _needs_numbers(inst["answer"]) \
                and not any(ch.isdigit() for ch in inst["text"] + (inst["alt"] or "")):
            errors.append("numeric answer but no numbers in the stem or the figure")
            break
    if interaction == "hotspot":
        for inst in instances:
            targets = figures.targets(inst["figure"]) if inst["figure"] else []
            if len(targets) < 2:
                errors.append("hotspot needs a figure with at least 2 targets")
                break
            if inst["answer"] not in targets:
                errors.append(f"hotspot answer '{inst['answer']}' is not a target id")
                break
    for inst in instances:
        if inst["figure"]:
            problems = figures.validate_spec(inst["figure"])
            if problems:
                errors.append("figure: " + problems[0])
                break
    has_random = bool(params) or len(blueprint.get("variants") or []) > 1
    if has_random and len({(i["text"], i["answer"], i["alt"]) for i in instances}) == 1 and seeds >= 10:
        errors.append("params never change the question (no variation across seeds)")
    return list(dict.fromkeys(errors))
