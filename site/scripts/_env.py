"""Load a gitignored .env into os.environ so the CLI scripts pick up SUPABASE_DB_URL
(and any other secrets) WITHOUT re-exporting them in every shell session.

Stdlib only, zero dependencies. Existing environment variables always win
(os.environ.setdefault), so CI — which injects the real SUPABASE_DB_URL secret —
is never overridden by a stray local .env. Looks for site/scripts/.env first,
then a repo-root .env.

Each CLI calls load_env() once at import. To use it, drop a .env next to the
scripts (or at the repo root):

    SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-...pooler.supabase.com:5432/postgres

The .env is gitignored — it never reaches the repo.
"""
import os


def load_env(paths=None):
    """Populate os.environ from the first existing .env in `paths` (without
    overriding vars already set). Returns the dict of values that were applied."""
    if paths is None:
        here = os.path.dirname(os.path.abspath(__file__))
        paths = [os.path.join(here, ".env"), os.path.join(here, "..", "..", ".env")]
    applied = {}
    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key:
                    os.environ.setdefault(key, val)
                    applied[key] = val
        break   # first .env found wins
    return applied
