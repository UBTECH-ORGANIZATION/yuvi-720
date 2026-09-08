from game_gen.code_utils import ensure_module_type_on_imports, validate_and_fix_code


def test_injects_doctype_lang_charset_viewport():
    out = validate_and_fix_code("<html><head><title>t</title></head><body></body></html>")
    assert out.startswith("<!DOCTYPE html>\n")
    assert '<html lang="he">' in out
    assert '<meta charset="UTF-8">' in out
    assert 'name="viewport"' in out


def test_keeps_existing_lang_and_metas():
    src = ('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width"></head><body></body></html>')
    out = validate_and_fix_code(src)
    assert out.count("charset") == 1
    assert out.count("viewport") == 1
    assert 'lang="he"' not in out


def test_arc_radius_guard():
    out = validate_and_fix_code("<html><script>ctx.arc(x, y, r, 0, Math.PI*2);</script></html>")
    assert "ctx.arc(x, y, Math.max(0, r)," in out
    # already guarded stays untouched
    again = validate_and_fix_code(out)
    assert again.count("Math.max(0, r)") == 1


def test_audio_context_fallback():
    out = validate_and_fix_code("<html><script>const a = new AudioContext();</script></html>")
    assert "new (window.AudioContext || window.webkitAudioContext)()" in out


def test_syntax_cleanups():
    out = validate_and_fix_code("<html><script>let a = 1;; if (a) {; b(),; }  ;</script></html>")
    assert ";;" not in out
    assert "{;" not in out
    assert ",;" not in out
    assert "}  ;" not in out


def test_module_type_added_for_imports():
    src = "<html><script>\nimport { x } from 'https://example.com/x.js';\n</script></html>"
    out = ensure_module_type_on_imports(src)
    assert '<script type="module">' in out
    # src scripts are not touched by the inline rule
    src2 = '<html><script src="a.js"></script></html>'
    assert ensure_module_type_on_imports(src2) == src2
    # .module. builds get type=module
    src3 = '<script src="https://x/lib.module.min.js"></script>'
    assert 'type="module"' in ensure_module_type_on_imports(src3)


def test_cdn_normalisation_runs_inside_validate():
    src = '<html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.55.2/dist/phaser.min.js"></script></head></html>'
    out = validate_and_fix_code(src)
    assert "phaser@3.90.0" in out


def test_empty_input_passthrough():
    assert validate_and_fix_code("") == ""
