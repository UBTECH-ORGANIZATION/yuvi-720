from game_gen.libraries import (
    AVAILABLE_LIBRARIES,
    get_library_cdn,
    library_prompt_block,
    normalize_cdn_urls,
)


def test_three_is_the_only_3d_library():
    assert AVAILABLE_LIBRARIES["three"]["cdn"].endswith("three.module.min.js")
    assert "babylon" not in AVAILABLE_LIBRARIES


def test_three_classic_script_is_merged_into_a_module():
    src = ('<html><head><script src="https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js"></script></head>'
           "<body><script>const scene = new THREE.Scene();</script></body></html>")
    out = normalize_cdn_urls(src)
    assert 'src="https://cdn.jsdelivr.net/npm/three' not in out
    assert "<script type=\"module\">" in out
    assert "import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.183.2/build/three.module.min.js'" in out
    assert "new THREE.Scene()" in out


def test_three_classic_script_without_inline_usage_gets_a_global():
    src = '<html><head><script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script></head><body></body></html>'
    out = normalize_cdn_urls(src)
    assert "window.THREE = THREE;" in out


def test_phaser_versions_present():
    assert get_library_cdn("phaser") == "https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"
    assert get_library_cdn("phaser4") == "https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js"
    assert "kaplay@3001.0.19" in get_library_cdn("kaplay")


def test_normalize_hallucinated_phaser3():
    src = '<script src="https://unpkg.com/phaser@3.60.0/dist/phaser.js"></script>'
    assert "phaser@3.90.0/dist/phaser.min.js" in normalize_cdn_urls(src)


def test_normalize_hallucinated_phaser4_keeps_major():
    src = '<script src="https://cdn.jsdelivr.net/npm/phaser@4.0.0-rc.1/dist/phaser.min.js"></script>'
    out = normalize_cdn_urls(src)
    assert "phaser@4.2.1" in out
    assert "3.90.0" not in out


def test_normalize_cdnjs_and_scoped_import():
    src = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/howler/2.1.0/howler.min.js"></script>'
           "<script type=\"module\">import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@7.0.0/dist/pixi.min.mjs';</script>")
    out = normalize_cdn_urls(src)
    assert "howler/2.2.4/howler.min.js" in out
    assert "pixi.js@8.17.1/dist/pixi.min.js" in out


def test_normalize_leaves_unknown_and_verified_alone():
    src = ('<script src="https://cdn.jsdelivr.net/npm/some-lib@1.2.3/dist/x.js"></script>'
           '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>')
    assert normalize_cdn_urls(src) == src
    assert normalize_cdn_urls("") == ""


def test_prompt_block_lists_every_cdn():
    block = library_prompt_block()
    for info in AVAILABLE_LIBRARIES.values():
        if info["cdn"]:
            assert info["cdn"] in block
    assert "three.module.min.js" in block
