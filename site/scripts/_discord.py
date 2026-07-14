"""Shared Discord webhook POST — one home for the timeout + payload shape so the
notifiers (digest.py, reconcile_run_ends.py) can't drift out of sync.
"""
import json
import urllib.request


def post(url, content):
    """POST a single Discord webhook message. Best-effort, short timeout. Raises on
    failure — callers wrap in try/except and treat notifications as non-fatal."""
    data = json.dumps({"content": content}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=5).read()
