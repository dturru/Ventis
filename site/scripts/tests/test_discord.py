import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _discord


def test_post_sends_json_content_with_timeout(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        seen["timeout"] = timeout
        seen["body"] = json.loads(req.data.decode("utf-8"))
        seen["ctype"] = req.headers.get("Content-type")

        class R:
            def read(self_inner): return b""
        return R()

    monkeypatch.setattr(_discord.urllib.request, "urlopen", fake_urlopen)
    _discord.post("https://hook", "hello")
    assert seen["url"] == "https://hook"
    assert seen["body"] == {"content": "hello"}
    assert seen["timeout"] == 5
    assert seen["ctype"] == "application/json"
