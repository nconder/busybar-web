import requests

import app as busy_app


CLOUDFLARE_504 = b"""<!DOCTYPE html>
<html><head><title>busy.app | 504: Gateway time-out</title></head>
<body>Cloudflare Ray ID: <strong>a1f318898efff0c0</strong></body></html>"""


def make_response(status=504, body=CLOUDFLARE_504, content_type="text/html; charset=UTF-8",
                  url="https://api.busy.app/busybar/version"):
    response = requests.Response()
    response.status_code = status
    response._content = body
    response.url = url
    response.headers["Content-Type"] = content_type
    response.headers["CF-Ray"] = "a1f318898efff0c0-DFW"
    return response


def test_cloudflare_504_becomes_compact_json(monkeypatch):
    monkeypatch.setattr(busy_app, "upstream", lambda *args, **kwargs: make_response())

    response = busy_app.app.test_client().get("/api/version")

    assert response.status_code == 504
    assert response.content_type == "application/json"
    payload = response.get_json()
    assert payload == {
        "result": "ERROR",
        "error": "BUSY API gateway time-out",
        "upstream_status": 504,
        "upstream_path": "/version",
        "retryable": True,
        "cloudflare_ray_id": "a1f318898efff0c0-DFW",
    }
    assert b"<!DOCTYPE html>" not in response.data


def test_timer_start_does_not_parse_cloudflare_html_as_json(monkeypatch):
    calls = []

    def fake_upstream(method, path, **kwargs):
        calls.append((method, path))
        return make_response(url=f"https://api.busy.app/busybar{path}")

    monkeypatch.setattr(busy_app, "upstream", fake_upstream)
    response = busy_app.app.test_client().post(
        "/api/busy/start",
        json={
            "slot": "custom",
            "timer_settings": {"type": "INFINITE"},
            "busy_bar_settings": {
                "theme": "on_air",
                "show_work_phase_only": False,
                "trigger_smart_home": False,
            },
        },
    )

    assert response.status_code == 504
    assert response.content_type == "application/json"
    assert response.get_json()["upstream_path"] == "/busy/profiles/custom"
    assert calls == [("GET", "/busy/profiles/custom")]
    assert b"<!DOCTYPE html>" not in response.data


def test_timer_pause_does_not_parse_cloudflare_html_as_json(monkeypatch):
    monkeypatch.setattr(
        busy_app,
        "upstream",
        lambda *args, **kwargs: make_response(
            url="https://api.busy.app/busybar/busy/snapshot"
        ),
    )

    response = busy_app.app.test_client().post("/api/busy/pause")

    assert response.status_code == 504
    assert response.content_type == "application/json"
    assert response.get_json()["upstream_path"] == "/busy/snapshot"
    assert b"<!DOCTYPE html>" not in response.data


def test_local_base_can_run_without_cloud_token(monkeypatch):
    seen = {}

    def fake_request(method, url, **kwargs):
        seen.update(method=method, url=url, headers=kwargs["headers"])
        return make_response(status=200, body=b'{"api_semver":"24.3.0"}',
                             content_type="application/json", url=url)

    monkeypatch.setattr(busy_app, "BASE", "http://busybar.local/api")
    monkeypatch.setattr(busy_app.requests, "request", fake_request)
    monkeypatch.delenv("BUSY_API_TOKEN", raising=False)
    busy_app.app.config.pop("BUSY_TOKEN", None)

    with busy_app.app.test_request_context("/"):
        busy_app.upstream("GET", "/version")

    assert seen["url"] == "http://busybar.local/api/version"
    assert "Authorization" not in seen["headers"]
