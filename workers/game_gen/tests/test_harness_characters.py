"""YuviWorld3D characters — the upgraded character system through the real validator.

The fixture builds twelve characters (new roles, robot styles, new animals),
ten villagers with different seeds, drives every animation entry point for a
few frames and probes ``window.__yuvi.chars``: sockets exist and sit at
distinct world positions, limbs bend at the knee, the head slews to a target,
``die()`` falls, the same seed rebuilds the same person, ten seeds give ten
different people, and the merged-mesh budget holds. Skips without Chromium or
the CDN. A static test keeps the skill doc in step with the role / animal /
gear vocabulary in the harness.
"""
import re

import pytest

from game_gen.harness import HARNESS_DIR, build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES, _head
from game_gen.validator import chromium_available, validate_html_sync

W3D_PATH = HARNESS_DIR / "yuvi_world3d.js"
SKILL_PATH = HARNESS_DIR.parent / "skills" / "world3d.md"
THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}
SOCKETS = ("handR", "handL", "head", "back", "chest", "hip")

CHAR_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>characters</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.chars = { built: false, stubOk: false, roles: 0, animals: 0, frames: 0, chars: [], distinct: 0, deterministic: false, meshMax: 0, meshMean: 0,
  drawCalls: 0, expr: null, handMoved: false, kneeBent: false, lookTurned: false, deadFell: false, nan: false, started: false });
const stub = YuviWorld3D.world(undefined), sc = stub.props.character({ role: 'soldier' }); sc.anim.aim(true); sc.anim.lookAt([1, 1, 1]); sc.face.set('happy');
probe.stubOk = !!sc.sockets && typeof sc.anim.celebrate === 'function';
const W = YuviWorld3D.world(THREE, { preset: 'forest', seed: 5, size: 80, terrain: { hills: 0 } });
probe.built = !!(W.scene && W.renderer); probe.roles = W.props.roles.length; probe.animals = W.props.animals.length;
const specs = [{ role: 'soldier', seed: 1 }, { role: 'engineer', seed: 2 }, { role: 'medic', seed: 3 }, { role: 'wizard', seed: 4 }, { role: 'royalty', seed: 5 }, { role: 'alien', seed: 6 },
  { role: 'ninja', seed: 7 }, { kind: 'robot', style: 'drone', seed: 8 }, { kind: 'robot', style: 'humanoid', seed: 9 }, { animal: 'dragon', seed: 10 }, { animal: 'rabbit', seed: 11 }, { animal: 'turtle', seed: 12 }];
const chars = specs.map((s, i) => W.props.character(Object.assign({ pos: [(i %% 6) * 2.4 - 6, 0, Math.floor(i / 6) * 3 - 2] }, s)));
const countMeshes = g => { let n = 0; g.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; };
const v = new THREE.Vector3(), KEYS = %(sockets)s;
W.scene.updateMatrixWorld(true);
chars.forEach(c => probe.chars.push({ name: c.name, meshes: countMeshes(c), height: +c.userData.height.toFixed(2), hasFace: !!c.parts.face, hasKnee: !!c.parts.shinL, parts: Object.keys(c.parts).length,
  sockets: KEYS.map(k => c.sockets[k] ? c.sockets[k].getWorldPosition(v).toArray().map(x => +x.toFixed(2)) : null) }));
const sig = c => { const cols = []; c.traverse(o => { if (o.isMesh && o.material && o.material.color) cols.push(o.material.color.getHexString()); }); return [c.userData.height.toFixed(2), countMeshes(c), cols.join(',')].join('|'); };
const crowd = []; for (let i = 0; i < 10; i++) crowd.push(W.props.character({ role: 'villager', seed: 100 + i, pos: [i * 1.6 - 7, 0, 6] }));
probe.distinct = new Set(crowd.map(sig)).size;
probe.deterministic = sig(W.props.character({ role: 'hero', seed: 77, add: false })) === sig(W.props.character({ role: 'hero', seed: 77, add: false }));
const all = chars.concat(crowd); probe.meshMax = Math.max.apply(null, all.map(countMeshes)); probe.meshMean = +(all.reduce((n, c) => n + countMeshes(c), 0) / all.length).toFixed(1);
const hero = chars[0]; hero.face.set('angry'); probe.expr = hero.face.expression; hero.face.set('surprised');
const hand0 = hero.sockets.handR.getWorldPosition(new THREE.Vector3()), knee0 = hero.parts.shinL.rotation.x, head0 = hero.parts.head.rotation.y;
YuviKit.init({
  title: 'דמויות', subtitle: 'מגוון', palette: ['#1e1e2e', '#a6e3a1'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => { probe.started = true; hero.anim.aim(true); chars[1].anim.celebrate(); chars[2].anim.crouch(true); chars[3].anim.sit(); chars[4].anim.carry(true); chars[5].anim.point([0, 1, 10]);
    chars[6].anim.wave(); chars[7].anim.talk(true); chars[9].anim.hit(); chars[10].anim.jump(); chars[11].anim.die(); }
});
W.run();
let f = 0;
YuviKit.loop(dt => {
  probe.frames++; f++; const d = Math.min(dt || .016, .05);
  chars.forEach((c, i) => { if (i === 11) c.anim.update(d); else if (i %% 3 === 0) c.anim.walk(d, 1); else if (i %% 3 === 1) c.anim.run(d); else c.anim.idle(d); });
  crowd.forEach((c, i) => i %% 2 ? c.anim.walk(d, 1) : c.anim.idle(d));
  hero.anim.lookAt([8, 1.5, 0]);
  if (f > 20) {
    W.scene.updateMatrixWorld(true);
    probe.handMoved = probe.handMoved || hero.sockets.handR.getWorldPosition(v).distanceTo(hand0) > .15;
    probe.kneeBent = probe.kneeBent || Math.abs(chars[3].parts.shinL.rotation.x) > .5;
    probe.lookTurned = probe.lookTurned || Math.abs(hero.parts.head.rotation.y - head0) > .2;
    probe.deadFell = probe.deadFell || chars[11].parts.body.rotation.x < -1;
  }
  probe.nan = probe.nan || all.some(c => !isFinite(c.position.y) || !isFinite(c.parts.body.position.y) || (c.parts.armR && !isFinite(c.parts.armR.rotation.x)));
  probe.drawCalls = W.stats.drawCalls;
});
</script>
</body></html>""" % {"three": THREE_URL, "sockets": list(SOCKETS)}


def _cdn_reachable() -> bool:
    try:
        return _head(THREE_URL, 5.0) == 200
    except Exception:  # noqa: BLE001
        return False


def _harness_with_world3d(nonce: str) -> str:
    src = W3D_PATH.read_text(encoding="utf-8")
    return build_harness(LEARN_DATA, nonce=nonce) + "\n<script>\n" + src.replace("</script", "<\\/script") + "\n</script>"


def _keys_of(src: str, const: str) -> list[str]:
    """Top-level keys of `const NAME = { key: {…}, key: {…} };` in the harness data block."""
    body = src.split(f"const {const} = {{", 1)[1]
    depth, keys, key = 1, [], ""
    for i, ch in enumerate(body):
        if ch == "{":
            if depth == 1:
                key = body[:i].rstrip().rstrip(":").split()[-1].lstrip("{,")
                keys.append(key)
            depth += 1
        elif ch == "}":
            depth -= 1
            if not depth:
                break
    return keys


def test_skill_doc_lists_every_role_animal_and_gear_name():
    src = W3D_PATH.read_text(encoding="utf-8")
    doc = SKILL_PATH.read_text(encoding="utf-8")
    row = next(line for line in doc.splitlines() if line.startswith("| `W.props.character(o)`"))
    roles, animals = _keys_of(src, "ROLES"), _keys_of(src, "ANIMALS")
    assert len(roles) >= 22 and "soldier" in roles and "ghostFriendly" in roles and "zombieCartoon" not in roles
    assert len(animals) == 15 and {"wolf", "bear", "rabbit", "deer", "fox", "duck", "turtle", "dragon"} <= set(animals)
    for name in roles + animals:
        assert f"'{name}'" in row, f"{name} missing from the props.character row"
    for lst in ("HAIRS", "TOPS", "BOTTOMS", "GEAR", "HATS", "BOTS"):
        names = re.findall(r"'(\w+)'", re.split(rf"\b{lst} = \[", src, maxsplit=1)[1].split("]", 1)[0])
        for name in names:
            assert f"'{name}'" in row, f"{lst}: {name} missing from the props.character row"
    for name in SOCKETS + ("aim(on)", "crouch(on)", "sit(on)", "point(v)", "carry(on)", "celebrate()", "lookAt(v)", "face.set("):
        assert name in row, f"{name} missing from the props.character row"
    assert "ten seeds" in doc or "10 seeds" in doc, "the WRONG → RIGHT table needs the variety row"


@pytest.mark.slow
def test_characters_sockets_animation_and_variety():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(CHAR_GAME, preinject_html=_harness_with_world3d("chars"), settle_ms=1200, interaction_settle_ms=1200)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok and res.clicked_start and res.heartbeat > 0
    assert res.canvas_blank is False
    probe = res.yuvi_state["chars"]
    assert probe["stubOk"] is True and probe["built"] is True and probe["started"] is True
    assert probe["roles"] >= 22 and probe["animals"] == 15
    assert probe["frames"] > 20
    chars = probe["chars"]
    assert len(chars) == 12
    hands = []
    for c in chars:
        assert c["hasFace"], c["name"]
        assert all(s is not None for s in c["sockets"]), (c["name"], c["sockets"])
        assert len({tuple(s) for s in c["sockets"]}) == len(SOCKETS), f"{c['name']}: sockets must sit at distinct joints"
        assert c["meshes"] <= 34, (c["name"], c["meshes"])
        hands.append(tuple(c["sockets"][0]))
    assert len(set(hands)) == 12, "handR must land at a different world position per character"
    assert all(c["hasKnee"] for i, c in enumerate(chars[:9]) if i != 7), "humans and humanoid robots have shin joints (the drone has none)"
    assert probe["nan"] is False
    assert probe["expr"] == "angry"
    assert probe["deterministic"] is True, "the same seed must rebuild the same person"
    assert probe["distinct"] >= 8, f"ten villager seeds gave only {probe['distinct']} different people"
    assert probe["meshMean"] <= 28, probe["meshMean"]
    assert probe["handMoved"] is True, "aim(on) must move the right hand socket"
    assert probe["kneeBent"] is True, "sit() must bend the knee joint"
    assert probe["lookTurned"] is True, "lookAt(v) must slew the head"
    assert probe["deadFell"] is True, "die() must lay the body down"
    assert 0 < probe["drawCalls"] <= 22 * 26 + 60, probe["drawCalls"]
