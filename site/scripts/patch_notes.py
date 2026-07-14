"""Email plain-English "patch notes" to the team when main changes — a vercel[bot]-style
deploy note, but rewritten into simple, non-technical language.

Runs from a GitHub Action on push to main. Collects the push's commits, rewrites them
into friendly notes (via claude-opus-4-8 when ANTHROPIC_API_KEY is set; a grouped
template otherwise), and emails the recipients over SMTP.

INERT until wired: no recipients / SMTP creds -> composes but does not send (prints and
exits 0). No ANTHROPIC_API_KEY -> uses the template. Every failure is non-fatal so a
push is never blocked by the notifier.

Env (all optional; unset => that layer no-ops):
  GITHUB_EVENT_BEFORE, GITHUB_SHA   commit range (falls back to the last commit)
  GITHUB_SERVER_URL, GITHUB_REPOSITORY   for the compare link
  ANTHROPIC_API_KEY                 enables the plain-English rewrite
  PATCH_NOTES_TO                    comma-separated recipient emails
  PATCH_NOTES_SMTP_HOST (=smtp.gmail.com), _PORT (=465), _USER, _PASS, _FROM (=_USER)

Usage:
  python patch_notes.py            # collect -> summarize -> email
  python patch_notes.py --dry-run  # print the composed email, send nothing
"""
import os
import subprocess
import sys

MODEL = "claude-opus-4-8"

# path prefix -> friendly area name (first match wins; order matters)
AREA_MAP = [
    ("firmware/", "The device (firmware)"),
    ("site/scripts/", "Data pipeline (behind the scenes)"),
    (".github/", "Automation (behind the scenes)"),
    ("app/", "Website / dashboard"),
    ("library/", "Data library site"),
    ("site/", "Public website"),
]


def _git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()


def commit_range():
    """(before, sha) -> a git range string, or a single-commit fallback."""
    before = os.environ.get("GITHUB_EVENT_BEFORE", "")
    sha = os.environ.get("GITHUB_SHA", "") or "HEAD"
    zero = not before or set(before) == {"0"}
    # verify `before` is a real ancestor commit we can diff from
    if not zero and _git("cat-file", "-t", before) == "commit":
        return f"{before}..{sha}"
    return f"{sha}~1..{sha}"


def collect(rng):
    """-> (subjects[list[str]], files[list[str]]) for the push."""
    log = _git("log", "--no-merges", "--format=%s", rng)
    subjects = [s for s in log.splitlines() if s.strip()]
    files = [f for f in _git("diff", "--name-only", rng).splitlines() if f.strip()]
    return subjects, files


def areas_touched(files):
    """Ordered, de-duplicated friendly area names for the changed files."""
    seen = []
    for f in files:
        for prefix, name in AREA_MAP:
            if f.startswith(prefix):
                if name not in seen:
                    seen.append(name)
                break
    return seen


def template_summary(subjects, areas):
    """Plain fallback when the LLM isn't available: friendly, grouped-by-area header
    plus the raw change list. Never fails."""
    lines = []
    if areas:
        lines.append("Areas updated: " + ", ".join(areas) + ".")
        lines.append("")
    lines.append("Changes in this update:")
    for s in subjects:
        lines.append(f"  - {s}")
    return "\n".join(lines)


def llm_summary(subjects, areas):
    """Rewrite the commits into simple, non-technical notes with claude-opus-4-8.
    Returns None on any problem (missing key, SDK, or API error) so the caller falls
    back to the template — the notifier must never hard-fail on the summary step."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    prompt = (
        "You write release notes for a non-technical co-founder of a hardware startup. "
        "Rewrite these engineering commit messages into a short, friendly summary they can "
        "actually understand. Group related items under simple headers. Avoid ALL jargon "
        "(don't say refactor, endpoint, CI, commit, schema, catalog — say 'behind the "
        "scenes', 'the website', 'the device', 'automatic checks', 'our data'). Use short "
        "bullet points, at most ~8. Skip purely internal housekeeping. No preamble.\n\n"
        f"Areas touched: {', '.join(areas) or 'general'}\n"
        "Commit messages:\n" + "\n".join(f"- {s}" for s in subjects)
    )
    try:
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        text = next((b.text for b in resp.content if b.type == "text"), "").strip()
        return text or None
    except Exception as e:
        print(f"(patch_notes: LLM summary skipped, {e})")
        return None


def summarize(subjects, areas):
    return llm_summary(subjects, areas) or template_summary(subjects, areas)


def compose_subject(subjects, areas):
    head = areas[0] if areas else "Ventis"
    n = len(subjects)
    return f"Ventis update — {head} ({n} change{'s' if n != 1 else ''})"


def _compare_url(rng):
    server = os.environ.get("GITHUB_SERVER_URL", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if server and repo and ".." in rng:
        return f"{server}/{repo}/compare/{rng.replace('..', '...')}"
    return ""


def build_html(summary, rng):
    body = summary.replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br>")
    link = _compare_url(rng)
    footer = (f'<p style="color:#888;font-size:12px">See the exact changes: '
              f'<a href="{link}">{link}</a></p>') if link else ""
    return (
        '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:640px">'
        '<h2 style="margin:0 0 12px">What changed in Ventis</h2>'
        f'<div style="line-height:1.6">{body}</div>{footer}'
        '<p style="color:#aaa;font-size:11px;margin-top:20px">Automatic update note. '
        'Reply to this email if anything is unclear.</p></div>'
    )


def dispatch(subject, html, recipients=None):
    """Send via SMTP. SILENT no-op (returns False) if recipients or SMTP creds are
    unset — inert until wired. Non-fatal on any send error."""
    to = recipients if recipients is not None else os.environ.get("PATCH_NOTES_TO", "")
    tos = [a.strip() for a in to.split(",") if a.strip()]
    user = os.environ.get("PATCH_NOTES_SMTP_USER", "")
    pw = os.environ.get("PATCH_NOTES_SMTP_PASS", "")
    if not (tos and user and pw):
        print("(patch_notes: recipients/SMTP creds unset — not sent)")
        return False
    # `or` not a default arg: an unset GitHub secret is an EMPTY STRING, not absent,
    # so os.environ.get(k, default) returns "" and int("") would raise before the try.
    host = os.environ.get("PATCH_NOTES_SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("PATCH_NOTES_SMTP_PORT") or "465")
    sender = os.environ.get("PATCH_NOTES_SMTP_FROM", "") or user
    try:
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, sender, ", ".join(tos)
        msg.set_content("This update note is best viewed as HTML.")
        msg.add_alternative(html, subtype="html")
        with smtplib.SMTP_SSL(host, port, timeout=20) as s:
            s.login(user, pw)
            s.send_message(msg)
        print(f"patch_notes: emailed {len(tos)} recipient(s)")
        return True
    except Exception as e:
        print(f"(patch_notes: send skipped, {e})")
        return False


def main(argv):
    rng = commit_range()
    subjects, files = collect(rng)
    if not subjects:
        print("(patch_notes: no commits in range — nothing to send)")
        return 0
    areas = areas_touched(files)
    subject = compose_subject(subjects, areas)
    html = build_html(summarize(subjects, areas), rng)
    if "--dry-run" in argv:
        print(subject)
        print(html)
        return 0
    dispatch(subject, html)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
