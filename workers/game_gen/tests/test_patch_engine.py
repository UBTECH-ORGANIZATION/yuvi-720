from game_gen.patch_engine import (
    FULL_REWRITE_LINE_THRESHOLD,
    PatchResult,
    _check_js_structural_integrity,
    apply_patches,
    is_large_file,
    number_lines,
)

HTML = """<!DOCTYPE html>
<html>
<head><title>g</title></head>
<body>
<script>
function start() {
  score = 0;
}
function draw() {
  ctx.fillRect(0, 0, 10, 10);
}
</script>
</body>
</html>"""


def test_number_lines_format():
    out = number_lines("a\nb\nc")
    assert out.split("\n") == ["1| a", "2| b", "3| c"]
    wide = number_lines("\n".join(str(i) for i in range(12)))
    assert wide.split("\n")[0] == " 1| 0"


def test_large_file_threshold():
    assert FULL_REWRITE_LINE_THRESHOLD == 5000
    assert not is_large_file(HTML)
    assert is_large_file("\n" * FULL_REWRITE_LINE_THRESHOLD)


def test_line_patches_replace_insert_delete_success():
    response = """Fixing the score.
REPLACE_LINES 7-7
  score = 10;
END_REPLACE

INSERT_AFTER 10
  ctx.fillStyle = 'red';
END_INSERT

DELETE_LINES 3-3
"""
    res = apply_patches(HTML, response)
    assert isinstance(res, PatchResult)
    assert res.ok and res.error is None
    assert res.applied == 3
    assert "score = 10;" in res.html
    assert "ctx.fillStyle = 'red';" in res.html
    assert "<title>g</title>" not in res.html
    assert res.html.index("fillRect") < res.html.index("fillStyle")


def test_line_patch_out_of_range_rejects_all():
    response = """REPLACE_LINES 7-7
  score = 10;
END_REPLACE

DELETE_LINES 40-41
"""
    res = apply_patches(HTML, response)
    assert res.html is None and res.applied == 0
    assert "total lines" in res.error


def test_line_patch_unbalanced_braces_rejected_by_aggregate_guard():
    response = """REPLACE_LINES 6-6
function start() { if (x) {
END_REPLACE
"""
    res = apply_patches(HTML, response)
    assert res.html is None
    assert "brace" in res.error


def test_legacy_search_replace_success_and_fuzzy():
    response = """<<<<<<< SEARCH
  score = 0;
=======
  score = 5;
>>>>>>> REPLACE

<<<<<<< SEARCH
ctx.fillRect(0, 0, 10, 10);
=======
  ctx.fillRect(0, 0, 20, 20);
>>>>>>> REPLACE
"""
    res = apply_patches(HTML, response)
    assert res.ok and res.applied == 2
    assert "score = 5;" in res.html
    assert "20, 20" in res.html


def test_legacy_failed_hunk_rejects_all():
    response = """<<<<<<< SEARCH
  score = 0;
=======
  score = 5;
>>>>>>> REPLACE

<<<<<<< SEARCH
this text does not exist anywhere
=======
nope
>>>>>>> REPLACE
"""
    res = apply_patches(HTML, response)
    assert res.html is None and res.applied == 0
    assert "unmatched" in res.error


def test_structural_guard_rejects_lost_function():
    # braces stay balanced, but a function declaration disappears
    response = """<<<<<<< SEARCH
function draw() {
  ctx.fillRect(0, 0, 10, 10);
}
=======
const draw = () => {
  ctx.fillRect(0, 0, 10, 10);
};
>>>>>>> REPLACE
"""
    res = apply_patches(HTML, response)
    assert res.html is None
    assert "Lost function declarations: draw" in res.error


def test_check_js_structural_integrity_direct():
    broken = HTML.replace("  score = 0;\n}", "  score = 0;").replace("</script>", "", 1)
    issues = _check_js_structural_integrity(HTML, broken)
    assert any("Script tag mismatch" in i for i in issues)
    ok = _check_js_structural_integrity(HTML, HTML)
    assert ok == []
    # braces inside strings are ignored
    quoted = HTML.replace("score = 0;", "score = '{';")
    assert _check_js_structural_integrity(HTML, quoted) == []


def test_no_patches_in_response():
    res = apply_patches(HTML, "I would change line 7 but here is no patch.")
    assert res.html is None and res.error == "no patches found in response"


def test_brace_guard_forgives_a_pre_existing_imbalance():
    """An apostrophe in a comment makes the naive counter see +1 in the
    original; a correct patch must not be blamed for it."""
    from game_gen.patch_engine import _check_js_structural_integrity
    original = "<html><script>// the kid's ship\nfunction a(){ return 1 }\n</script></html>"
    patched = "<html><script>// the kid's ship\nfunction a(){ return 2 }\n</script></html>"
    assert _check_js_structural_integrity(original, patched) == []
    broken = "<html><script>// the kid's ship\nfunction a(){ return 2 \n</script></html>"
    assert any("Brace mismatch" in issue for issue in _check_js_structural_integrity(original, broken))
