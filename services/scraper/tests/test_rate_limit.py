from types import SimpleNamespace

import pytest

import scrapers


@pytest.mark.unit
def test_bref_rate_limit_sleeps_when_requests_are_too_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(scrapers, "BREF_REQUEST_DELAY_SECONDS", 5)
    monkeypatch.setattr(scrapers, "_last_bref_request_at", 100.0)
    monkeypatch.setattr(scrapers.time, "monotonic", lambda: 100.1)
    slept: list[float] = []
    monkeypatch.setattr(scrapers.time, "sleep", slept.append)
    scrapers.bref_rate_limit()
    assert slept == [pytest.approx(4.9)]


@pytest.mark.unit
def test_bref_get_passes_headers_and_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scrapers, "BREF_REQUEST_DELAY_SECONDS", 0)
    calls: list[tuple] = []

    def fake_get(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(status_code=200, text="ok")

    assert scrapers.bref_get("https://example.test", get=fake_get) == "ok"
    assert calls[0][0] == ("https://example.test",)
    assert calls[0][1]["headers"] == scrapers.BREF_HEADERS
    assert calls[0][1]["timeout"] == scrapers.BREF_REQUEST_TIMEOUT


@pytest.mark.unit
def test_bref_429_is_not_retried_and_blocks_the_rest_of_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(scrapers, "BREF_REQUEST_DELAY_SECONDS", 0)
    calls: list[str] = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return SimpleNamespace(status_code=429, text="slow down")

    with pytest.raises(
        scrapers.BrefRateLimitedError,
        match=r"rate limit hit \(first 429 for https://example\.test/first\)",
    ):
        scrapers.bref_get("https://example.test/first", get=fake_get)
    with pytest.raises(
        scrapers.BrefRateLimitedError, match="first 429 for https://example.test/first"
    ):
        scrapers.bref_get("https://example.test/second", get=fake_get)
    # One request in total: no retry of the 429, and nothing sent afterwards.
    assert calls == ["https://example.test/first"]


@pytest.mark.unit
def test_bref_server_errors_are_still_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scrapers, "BREF_REQUEST_DELAY_SECONDS", 0)
    monkeypatch.setattr(scrapers.bref_get.retry, "sleep", lambda _seconds: None)
    responses = iter(
        [SimpleNamespace(status_code=503, text=""), SimpleNamespace(status_code=200, text="ok")]
    )
    assert scrapers.bref_get("https://example.test", get=lambda *a, **k: next(responses)) == "ok"
