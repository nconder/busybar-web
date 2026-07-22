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
