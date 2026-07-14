"""Weekly Ventis dataset digest -> Discord.

Pushes the review-queue to Diego instead of him pulling it: new runs this week,
runs still needing a quality flag (uncategorized), and thin-coverage conditions
(only one run). Reads runs + annotations straight from the Supabase system-of-record.

Silent no-op if DISCORD_WEBHOOK_URL is unset (inert until wired). Non-fatal: a query
hiccup or missing table prints and exits 0, so a scheduled run never errors.

Usage:
  python digest.py            # compose from Supabase + post (needs SUPABASE_DB_URL + webhook)
  python digest.py --dry-run  # print the composed digest, post nothing
"""
import json
import os
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timedelta

from _env import load_env
load_env()

MAX_LIST = 15      # cap each section's bullets
MAX_CHARS = 1990   # hard cap under Discord's 2000-char message limit


def _date(s):
    """Leading YYYY-MM-DD of a timestamp string -> datetime (date at midnight), or None."""
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _bullets(items):
    shown = items[:MAX_LIST]
    out = "\n".join(f"• {x}" for x in shown)
    if len(items) > MAX_LIST:
        out += f"\n• …and {len(items) - MAX_LIST} more"
    return out


def _counted_bullets(conditions):
    """One bullet per distinct condition, annotated `×N` when it recurs — so the section
    header (which counts runs) and the bullet list (distinct conditions) stay consistent."""
    counts = Counter(conditions)
    rows = [f"{c} ×{n}" if n > 1 else c for c, n in sorted(counts.items())]
    return _bullets(rows)


def compose_digest(runs, now, window_days=7):
    """Pure. runs: [{condition, date, quality_flag}]. -> Discord markdown string.
    A run is 'uncategorized' when it carries no quality flag; 'thin' conditions have
    exactly one run in the whole dataset. Truncated to MAX_CHARS for Discord."""
    cutoff = now - timedelta(days=window_days)
    new_runs, uncategorized, counts = [], [], {}
    for r in runs:
        cond = str(r.get("condition") or "?")
        counts[cond] = counts.get(cond, 0) + 1
        d = _date(r.get("date"))
        if d and d >= cutoff:
            new_runs.append(cond)
        if not str(r.get("quality_flag") or "").strip():
            uncategorized.append(cond)
    thin = sorted(c for c, n in counts.items() if n == 1)

    lines = [f"**📊 Ventis weekly digest** — {len(runs)} runs total"]
    lines.append("")
    lines.append(f"**🆕 New this week ({len(new_runs)})**")
    lines.append(_counted_bullets(new_runs) if new_runs else "• none")
    if uncategorized:
        lines.append("")
        lines.append(f"**🏷️ Needs a quality flag ({len(uncategorized)})**")
        lines.append(_counted_bullets(uncategorized))
    if thin:
        lines.append("")
        lines.append(f"**📉 Thin coverage — single run ({len(thin)})**")
        lines.append(_bullets(thin))
    out = "\n".join(lines)
    return out if len(out) <= MAX_CHARS else out[:MAX_CHARS - 1] + "…"


def _post_discord(url, content):
    data = json.dumps({"content": content}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=5).read()


def send(text, webhook_url=None, poster=_post_discord):
    """Post the digest. SILENT no-op when the webhook is unset. Non-fatal."""
    url = webhook_url if webhook_url is not None else os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return False
    try:
        poster(url, text)
        return True
    except Exception as e:
        print(f"(digest: post skipped, {e})")
        return False


def _fetch(db_url):
    """-> [{condition, date, quality_flag}] joining runs to their annotation quality flag."""
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select r.condition, "
            "to_char(r.start_ts,'YYYY-MM-DD') as date, "
            "coalesce(a.quality_flag,'') as quality_flag "
            "from runs r left join annotations a on a.run_key = r.run_key "
            "order by r.start_ts")
        return cur.fetchall()


def main(argv):
    dry = "--dry-run" in argv
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("(digest: SUPABASE_DB_URL unset — skipped)")
        return 0
    try:
        runs = _fetch(db_url)
    except Exception as e:
        print(f"(digest: fetch skipped, {e})")
        return 0
    text = compose_digest(runs, datetime.now())
    if dry:
        print(text)
        return 0
    print("posted" if send(text) else "(digest: no webhook — not posted)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
