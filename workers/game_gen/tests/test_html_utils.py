from game_gen.html_utils import extract_html, is_only_meta_block, strip_meta_block

DOC = "<!DOCTYPE html>\n<html><head></head><body><p>hi</p></body></html>"


def test_strategy1_prefers_longest_complete_fenced_block():
    small = "<!DOCTYPE html><html><body>a</body></html>"
    big = "<!DOCTYPE html><html><body>" + "b" * 200 + "</body></html>"
    text = f"Here:\n```html\n{small}\n```\nand again:\n```html\n{big}\n```\n"
    assert extract_html(text) == big


def test_strategy1_large_unclosed_block_beats_small_complete_and_is_closed():
    partial = "<!DOCTYPE html><html><body>" + "x" * 500  # cut off by token limit
    stub = "<!DOCTYPE html><html><body>s</body></html>"
    text = f"```html\n{partial}\n```html\n{stub}\n```"
    out = extract_html(text)
    assert out is not None
    assert out.startswith(partial)
    assert out.endswith("</html>")


def test_strategy1_unclosed_only_returns_longest_partial():
    partial = "<!DOCTYPE html><html><body>" + "y" * 50
    assert extract_html(f"```html\n{partial}") == partial


def test_strategy2_raw_documents_without_fences():
    short = DOC
    long = DOC.replace("hi", "hello " * 30)
    text = f"prose {short}\nmore prose {long} trailing"
    assert extract_html(text) == long


def test_strategy3_generic_fence():
    text = f"```\n{DOC}\n```"
    assert extract_html(text) == DOC


def test_strategy4_doctype_to_last_html_close():
    text = f"Sure! {DOC.replace('<!DOCTYPE html>', '<!DOCTYPE>')}bye"
    out = extract_html(text)
    assert out is not None
    assert out.startswith("<!DOCTYPE") and out.endswith("</html>")


def test_no_html_returns_none():
    assert extract_html("just prose, no html here") is None
    assert extract_html("") is None


def test_strip_meta_block_parses_json_and_removes_it():
    text = f'{DOC}\n\n```meta\n{{"added": ["a"], "suggestions": ["b", "c"]}}\n```'
    clean, meta = strip_meta_block(text)
    assert clean == DOC
    assert meta == {"added": ["a"], "suggestions": ["b", "c"]}


def test_strip_meta_block_unparsable_gives_none():
    clean, meta = strip_meta_block("hello ```meta\nnot json\n``` world")
    assert clean == "hello  world"
    assert meta is None


def test_is_only_meta_block():
    assert is_only_meta_block('```meta\n{"added": []}\n```')
    assert not is_only_meta_block(DOC)
