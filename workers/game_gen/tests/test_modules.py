"""Opt-in runtime modules: named by the pitch, inferred from the brief, sniffed from HTML."""
from game_gen import harness, modules, prompts


def test_needs_line_is_parsed_in_registry_order():
    assert modules.parse_needs("HOOK — x\nNEEDS: ui, world3d") == ["world3d", "ui"]
    assert modules.parse_needs("NEEDS: none") == []
    assert modules.parse_needs("no line here") == []
    assert modules.parse_needs("needs: World3D / arcade2d, bogus") == ["world3d", "arcade2d"]


def test_inference_from_chips_and_words():
    assert modules.infer(["3d"], "") == ["world3d"]
    assert modules.infer([], "משחק תלת־ממדי עם שאלות") == ["world3d", "ui"]
    assert modules.infer(["platformer"], "") == ["arcade2d"]
    assert modules.infer([], "plain canvas") == []


def test_sniff_finds_the_globals_a_game_uses():
    assert modules.sniff("<script>const W = YuviWorld3D.world(THREE, {})</script>") == ["world3d"]
    assert modules.sniff("YuviUI.ask({}); YuviWorld3D.world()") == ["world3d", "ui"]
    assert modules.sniff("") == []


def test_resolve_keeps_only_shipped_modules(monkeypatch):
    monkeypatch.setattr(modules, "available", lambda name: name in ("world3d", "ui"))
    assert modules.resolve(["ui"], ["arcade2d"], html="YuviWorld3D") == ["world3d", "ui"]
    assert modules.resolve(None) == []


def test_harness_injects_modules_after_the_kit(monkeypatch):
    monkeypatch.setattr(modules, "available", lambda name: True)
    monkeypatch.setattr(modules, "js_text", lambda name: f"window.__mod_{name} = 1;")
    learn = {"component": {"id": "c", "title": "t"}, "objective": {"id": "o", "title": "t"}, "language": "he"}
    fragment = harness.build_harness(learn, modules=["ui", "world3d"])
    kit_at = fragment.index("YuviKit")
    assert fragment.index("__mod_world3d") > kit_at and fragment.index("__mod_ui") > fragment.index("__mod_world3d")
    assert "__mod_" not in harness.build_harness(learn)
    assert harness.modules_for(None, "YuviUI.ask") == ["ui"]


def test_skill_docs_enter_the_system_message_only_when_needed(monkeypatch):
    monkeypatch.setattr(modules, "available", lambda name: True)
    monkeypatch.setattr(modules, "skill_text", lambda name: f"SKILL-{name.upper()}")
    plain = prompts.builder_system_message("he")
    with_3d = prompts.builder_system_message("he", needs=["world3d"])
    assert "SKILL-WORLD3D" not in plain and "SKILL-WORLD3D" in with_3d
    # the skill sits after the core kit and before the ambition block — a stable prefix
    assert with_3d.index("YuviKit.init") < with_3d.index("SKILL-WORLD3D") < with_3d.index("WHAT YOU SHIP")
    assert "SKILL-WORLD3D" in prompts.editor_system_message("he", needs=["world3d"])
    assert "NEEDS" in prompts.PLAN_SYSTEM
