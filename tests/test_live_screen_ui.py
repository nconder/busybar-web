import struct
from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_front_screen_uses_busybar_device_shell():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert 'class="busybar-device-preview"' in html
    assert 'src="/static/assets/busybar-device.png"' in html
    assert '<canvas id="screen-front" width="720" height="160"></canvas>' in html


def test_device_shell_asset_has_expected_dimensions():
    png = (ROOT / "static" / "assets" / "busybar-device.png").read_bytes()

    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", png[16:24])
    assert (width, height) == (768, 248)


def test_front_canvas_matches_builtin_device_geometry():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    assert ".busybar-device-preview" in css
    assert ".busybar-device-preview #screen-front" in css
    assert "width: 360px" in css
    assert "height: 80px" in css
    assert "left: 12px" in css
    assert "top: 31px" in css


def test_front_renderer_uses_native_ten_pixel_led_cells():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "function drawFrontLedMatrix" in js
    assert "const ledSize = 10" in js
    assert "drawFrontLedMatrix(canvas, buf, w, h)" in js


def test_rear_screen_is_clean_readable_and_separate_from_controls():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "busybar-rear-preview" not in html
    assert "rear-black-panel" not in html
    assert "rear-busy-logo" not in html
    assert '<div class="rear-display-clean">' in html
    assert '<canvas id="screen-back" width="160" height="80"></canvas>' in html
    assert "Rear display · 160 × 80 monochrome" in html
    assert ".rear-display-clean #screen-back" in css
    assert "width: 300px; height: 150px; border: 0" in css
    assert "image-rendering: auto" in css

    for control_id in ("rear-up", "rear-dial", "rear-down", "rear-back", "rear-start", "rear-mode"):
        assert f'id="{control_id}"' in html

    assert 'sendRearInput("up")' in js
    assert 'sendRearInput("ok")' in js
    assert 'sendRearInput("down")' in js
    assert 'const rearModes = ["busy", "custom", "off", "apps", "settings"]' in js
    assert "const bytesPerRow = Math.ceil(w / 2)" in js
    assert "const v = lo * 17, o = (row * w + x0) * 4" in js
    assert "const v = hi * 17, o = (row * w + x1) * 4" in js
    assert '/static/style.css?v=20260722-rear-300-docs' in html
    assert '/static/app.js?v=20260722-rear-300-docs' in html
    assert "!document.hidden" in js
    assert 'document.addEventListener("visibilitychange"' in js


def test_project_and_in_app_docs_match_reviewed_screen_format():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    help_html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    for docs in (readme, help_html):
        assert "low nibble" in docs.lower()
        assert "300×150" in docs or "300 × 150" in docs
        assert "high nibble = even" not in docs.lower()

    assert "BUSY → CUSTOM → OFF → APPS → SETTINGS" in readme
    assert "BUSY → CUSTOM → OFF → APPS → SETTINGS" in help_html
    assert '$env:BUSY_API_BASE = "http://&lt;device-ip&gt;/api"' in help_html
    assert "Authorization: Bearer &lt;token&gt;" in help_html
