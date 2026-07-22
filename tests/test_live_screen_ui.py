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


def test_rear_screen_uses_physical_control_housing():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    for class_name in (
        "busybar-rear-preview",
        "rear-mode-selector",
        "rear-start-control",
        "rear-back-button",
        "rear-scroll-dial",
        "rear-black-panel",
    ):
        assert class_name in html
        assert f".{class_name}" in css

    assert '<canvas id="screen-back" width="160" height="80"></canvas>' in html
    assert ".busybar-rear-preview #screen-back" in css
    assert '<button class="rear-scroll-dial" id="rear-dial"' in html
    assert '<button class="rear-back-button" id="rear-back"' in html
    assert '<button class="rear-start-control" id="rear-start"' in html
    assert '<button class="rear-mode-selector" id="rear-mode"' in html
    assert 'sendRearInput("ok")' in js
    assert 'sendRearInput(event.deltaY < 0 ? "up" : "down")' in js
    assert 'const rearModes = ["busy", "custom", "off", "apps", "settings"]' in js
    assert '/static/style.css?v=20260722-rear-controls' in html
    assert '/static/app.js?v=20260722-rear-controls' in html
