"""Kit bits added 2026-09-14: in-world labels, ask({givens}), fps.reset() without callbacks."""
import pytest

from game_gen.harness import build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES
from game_gen.validator import chromium_available, validate_html_sync

THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "ברוטו נטו טרה"}, "language": "he"}

GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>bits</title></head><body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.bits = { label: 0, given: 0, downFired: 0, soldiersAfterReset: -1, labelText: '' });
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 3, size: 80 });
W.lighting.apply('nightIndustrial');
const sign = W.label('ברוטו 1400 g\\nטרה 400 g', [3, 0, -6], { glow: '#ffb347' });
const console1 = W.props.make('console', { variant: 'lit', pos: [-3, 0, -6], text: 'קוד: נטו' });
probe.label = (sign.mesh.material.map ? 1 : 0) + (console1.label && console1.label.mesh.material.map ? 1 : 0);
sign.set('ברוטו 1500 g'); probe.labelText = sign.text;
const ctrl = W.player.fps({ pos: [0, 0, 6] });
const rig = W.fps.arms(ctrl, { weapons: ['blaster'] });
const hero = W.fps.player(ctrl, { hp: 100 });
let resetting = false;
const squad = W.fps.squad(3, { arch: 'grunt', area: [0, -10, 6], seed: 5, onDown: () => { if (resetting) probe.downFired++; } });
YuviKit.init({ title: 'bits', hud: [{ id: 'hp', label: 'חיים', value: 100 }, { id: 'ammo', label: 'תחמושת', value: '' }],
  onStart: async () => {
    resetting = true; W.fps.reset(); resetting = false;
    probe.soldiersAfterReset = W.fps.soldiers.length;
    const p = YuviUI.ask({ parts: ['מה הנטו?'], kind: 'number', correct: 1000, givens: [['ברוטו ', { ltr: '1400 g' }], ['טרה ', { ltr: '400 g' }]], hint: 'נטו = ברוטו − טרה' });
    probe.given = document.querySelectorAll('#yu-root .yu-given').length;
    const inp = document.querySelector('#yu-root input'); inp.value = '1000'; document.querySelector('#yu-root .yu-btn').click();
    await p; YuviKit.hud.set({ hp: 100 });
  } });
W.run();
</script></body></html>""" % {"three": THREE_URL}


def _harness(nonce: str) -> str:
    return build_harness(LEARN, nonce=nonce, modules=["world3d", "ui", "fps"])


@pytest.mark.slow
def test_labels_givens_and_reset_work_together():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(GAME, preinject_html=_harness("bits1"), settle_ms=1500, interaction_settle_ms=2500, screenshot=False)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    bits = (res.yuvi_state or {}).get("bits") or {}
    assert bits.get("label") == 2, bits            # W.label and make({text}) both drew a texture
    assert bits.get("labelText") == "ברוטו 1500 g"
    assert bits.get("given") == 2, bits            # the givens rows are in the panel
    assert bits.get("downFired") == 0, bits        # reset() never fires onDown
    assert bits.get("soldiersAfterReset") == 0, bits
