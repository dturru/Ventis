import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sheet_source
from gspread.exceptions import APIError


class _FakeResp:
    """Minimal stand-in for a requests Response that gspread.APIError wraps."""
    def __init__(self, status):
        self.status_code = status
        self.text = "err"

    def json(self):
        return {"error": {"code": self.status_code, "message": "boom", "status": "X"}}


def _api_error(status):
    return APIError(_FakeResp(status))


def test_retry_recovers_after_transient_503():
    # the exact failure from CI run 27085208176: a 503 blip that clears on retry
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise _api_error(503)
        return "ok"

    assert sheet_source._with_retry(flaky, tries=4, base_delay=0) == "ok"
    assert calls["n"] == 3


def test_retry_gives_up_after_max_tries():
    def always_503():
        raise _api_error(503)

    try:
        sheet_source._with_retry(always_503, tries=3, base_delay=0)
        assert False, "should have re-raised after exhausting retries"
    except APIError as e:
        assert e.response.status_code == 503


def test_retry_does_not_retry_real_4xx():
    # a 404/permission error is a config bug, not a blip — fail fast, no retries
    calls = {"n": 0}

    def not_found():
        calls["n"] += 1
        raise _api_error(404)

    try:
        sheet_source._with_retry(not_found, tries=4, base_delay=0)
        assert False, "should not have retried a non-transient error"
    except APIError:
        pass
    assert calls["n"] == 1
