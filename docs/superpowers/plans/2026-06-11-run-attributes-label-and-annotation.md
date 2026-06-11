# Run Attributes: Label Scenario + Annotation Overrides — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Populate each catalog run's ventilation attributes from its label (with sensible defaults), and let an annotation override any attribute when reality differs from the label. So `little_window_1_person` shows "window open · fan off, 1 occupant" from the label, and its annotation override bumps occupancy to 2 (roommate moved in).

**Architecture:** `build_catalog` derives `window` / `fan` / `scenario` from the condition label (occupancy already parsed — see "Done already"). The `annotations` table gains nullable override columns (`occupancy`, `window`, `fan`); `build_catalog` resolves **annotation override > label default** and recomposes the scenario. The catalog UI shows the resolved attributes and marks which were set by annotation.

**Tech Stack:** Python (build_catalog, annotate, pytest), Supabase Postgres (annotations table), React/TS/Vite (the `library/` catalog), vitest.

---

## Context for a fresh session (read first)

- Repo: `C:\Users\turru\Projects\ventis`. Catalog app: `library/`. Pipeline/scripts: `site/scripts/`.
- **Supabase from the cloud uses port 6543** (transaction pooler), not 5432 — see `docs/cloud-connection-and-deploy.md`. The live `SUPABASE_DB_URL` (6543) is in the gitignored `library/.dev.vars` on this machine; read it from there for any local DB op (don't echo it).
- **DDL / one-off DB ops:** Diego runs them in the **Supabase SQL editor** (browser) — provide him the SQL. Annotation values are set via SQL / `annotate.py` CLI / Supabase Table Editor (the `/curate` web page exists but is plan-gated by Cloudflare's free-tier subrequest limit — out of scope here).
- **Design/voice (`site/DESIGN.md`):** the catalog shares the site's system. Use the middot `·` as a separator, **no em-dashes** in any copy. Run `npm run build` + vitest before shipping.
- **build_catalog merge point:** `site/scripts/build_catalog.py` ~line 178 does `from annotate import load_annotations, merge_annotations; merge_annotations(records, load_annotations())`. `merge_annotations` (in `annotate.py`) currently copies note/quality_flag/tags onto each record.
- **`annotate.py`:** `COLS = ["run_key","note","quality_flag","tags","updated_by"]`; PG load = `select run_key, note, quality_flag, tags, updated_by from annotations`; `_upsert_pg` inserts those; CSV `STORE` = `archive/annotations.csv` (local fallback). CLI: `--set <run_key> --note --flag --tags --by`.
- **`Run` interface:** `library/src/lib/catalog.ts` (has `occupancy: number|null`, `window_state: string`, `note?`, `quality_flag?`, `tags?`, …).
- **UI:** `RunDetail.tsx` renders a rows array (e.g. `["Occupancy", run.occupancy ?? "·"]`, `["Window", run.window_state || "·"]`). `RunTable.tsx` has `COLS` (Building / Occ / Condition) + cell rendering.

### Done already (do NOT redo)
Occupancy label parsing is fixed and shipped (commit `94346e7`): `_occupancy` in `build_catalog.py` now handles `1_person`, `1p`, word-numbers, and single/double/triple room types. 45 pytest green. This plan builds on it.

### Decisions locked
- Window default is **blank** when the label is silent (do NOT assert closed). Fan default is **off** unless the label names a fan.
- Annotation overrides are **structured columns**, not free-text note parsing.
- `window_state` (logged sensor field) stays as-is; the new label-derived field is named **`window`**. Keep them distinct.

---

## Phase 1 — Label-derived scenario (Python)

### Task 1: window / fan / scenario parsers in build_catalog (TDD)

**Files:** Modify `site/scripts/build_catalog.py`; Test `site/scripts/tests/test_build_catalog.py`

- [ ] **Step 1: Write failing tests**

Add to `site/scripts/tests/test_build_catalog.py`:

```python
from build_catalog import window_from_label, fan_from_label, compose_scenario


def _toks(s):
    import re
    return [t for t in re.split(r"[^a-z0-9]+", str(s).lower()) if t]


def test_window_from_label():
    assert window_from_label(_toks("little_window_1_person")) == "open"
    assert window_from_label(_toks("midmass_windowfan_3person")) == "open"
    assert window_from_label(_toks("eastwheelock_fanclosed_2person")) == "closed"
    assert window_from_label(_toks("little_baseline_1person")) == "closed"
    assert window_from_label(_toks("1RSingle - Fahey")) == ""        # silent -> blank
    assert window_from_label(_toks("Judge_3RDouble")) == ""          # silent -> blank


def test_fan_from_label():
    assert fan_from_label(_toks("eastwheelock_fanclosed_2person")) == "on"
    assert fan_from_label(_toks("midmass_windowfan_3person")) == "on"
    assert fan_from_label(_toks("little_window_1_person")) == "off"  # default off
    assert fan_from_label(_toks("1RSingle - Fahey")) == "off"


def test_compose_scenario():
    assert compose_scenario("open", "off") == "window open · fan off"
    assert compose_scenario("closed", "on") == "window closed · fan on"
    assert compose_scenario("", "off") == "fan off"                  # window unknown -> omit
    assert compose_scenario("open→closed→open", "off") == "window open→closed→open · fan off"
```

- [ ] **Step 2: Run, expect failure**

`cd site/scripts && python -m pytest tests/test_build_catalog.py -q` → FAIL (ImportError: cannot import `window_from_label`).

- [ ] **Step 3: Implement the parsers**

In `site/scripts/build_catalog.py`, just below `_occupancy` (after the `ROOM_TYPE`/`PERSON_TOK` block), add:

```python
_WINDOW_OPEN = {"window", "windowopen", "windowfan", "open"}
_WINDOW_CLOSED = {"closed", "fanclosed", "baseline"}


def window_from_label(toks):
    """'open' / 'closed' / '' — never assert when the label is silent (blank)."""
    if any(t in _WINDOW_OPEN for t in toks):
        return "open"
    if any(t in _WINDOW_CLOSED for t in toks):
        return "closed"
    return ""


def fan_from_label(toks):
    """A fan is OFF unless the label names one (any token containing 'fan')."""
    return "on" if any("fan" in t for t in toks) else "off"


def compose_scenario(window, fan):
    """Readable ventilation descriptor. Window omitted when unknown; fan always shown."""
    parts = []
    if window:
        parts.append(f"window {window}")
    parts.append(f"fan {fan}")
    return " · ".join(parts)
```

- [ ] **Step 4: Run, expect pass**

`python -m pytest tests/test_build_catalog.py -q` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(ventis): parse window/fan/scenario from run label (fan off default, window blank when silent)"
```

### Task 2: emit window / fan / scenario in run_record (TDD)

**Files:** Modify `site/scripts/build_catalog.py`; Test same file.

- [ ] **Step 1: Failing test** — add:

```python
def test_run_record_emits_label_scenario():
    rec = run_record({"run_key": "k", "condition": "little_window_1_person",
                      "start": "2026-06-10 17:48:00", "end": "2026-06-11 00:00:00"})
    assert rec["window"] == "open"
    assert rec["fan"] == "off"
    assert rec["scenario"] == "window open · fan off"
    assert rec["occupancy"] == 1
    assert rec["window_state"] == ""   # logged field untouched
```

- [ ] **Step 2: Run → FAIL** (KeyError 'window').

- [ ] **Step 3: Implement** — in `run_record` (after `lab = parse_label(...)`), compute and add to the returned dict. Replace the occupancy/window_state lines:

```python
    lab = parse_label(run.get("condition", ""))
    toks = [t for t in re.split(r"[^a-z0-9]+", str(run.get("condition", "")).lower()) if t]
    window = window_from_label(toks)
    fan = fan_from_label(toks)
```

and in the returned dict add these keys alongside `occupancy`:

```python
        "occupancy": lab["occupancy"],
        "window": window,
        "fan": fan,
        "scenario": compose_scenario(window, fan),
        "window_state": run.get("window_state", ""),
```

- [ ] **Step 4: Run → PASS** (and full suite: `python -m pytest tests/ -q`).

- [ ] **Step 5: Commit**

```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(ventis): emit label-derived window/fan/scenario on each run record"
```

---

## Phase 2 — Annotation override columns

### Task 3: schema — add override columns (Diego runs DDL)

**Files:** Modify `site/scripts/supabase_schema.sql` (documentation); produce SQL for Diego.

- [ ] **Step 1: Update the schema doc** — in `supabase_schema.sql`, extend the `annotations` table definition:

```sql
create table if not exists annotations (
  run_key      text primary key,
  note         text,
  quality_flag text,                 -- good | caution | exclude (else: no flag)
  tags         text,                  -- optional, comma-separated
  occupancy    int,                   -- override: actual occupancy when label is wrong
  window       text,                  -- override: open | closed | free text (e.g. open→closed→open)
  fan          text,                  -- override: on | off
  updated_by   text,                  -- founder pseudonym, never an occupant
  updated_at   timestamptz default now()
);
```

- [ ] **Step 2: Hand Diego the live ALTER** (he runs it in the Supabase SQL editor — `create table` won't alter an existing table):

```sql
alter table annotations
  add column if not exists occupancy int,
  add column if not exists window text,
  add column if not exists fan text;
```

- [ ] **Step 3: Commit** the schema doc:

```bash
git add site/scripts/supabase_schema.sql
git commit -m "docs(ventis): annotations override columns (occupancy/window/fan)"
```

### Task 4: annotate.py — carry + write the override fields (TDD)

**Files:** Modify `site/scripts/annotate.py`; Test `site/scripts/tests/test_annotate.py` (create if absent, else extend).

- [ ] **Step 1: Failing test** — exercise the CSV (no-DB) path:

```python
def test_upsert_carries_override_fields(tmp_path):
    import annotate
    store = tmp_path / "annotations.csv"
    annotate.upsert_annotation(
        {"run_key": "k1", "note": "roommate moved in", "quality_flag": "caution",
         "tags": "occupancy-change", "occupancy": "2", "window": "open", "fan": "off",
         "updated_by": "diego"},
        path=str(store), db_url="")
    annos = annotate.load_annotations(path=str(store), db_url="")
    assert annos["k1"]["occupancy"] == "2"
    assert annos["k1"]["window"] == "open"
    assert annos["k1"]["fan"] == "off"
```

- [ ] **Step 2: Run → FAIL** (override keys dropped — not in `COLS`).

- [ ] **Step 3: Implement** in `annotate.py`:
  - Extend `COLS`: `["run_key","note","quality_flag","tags","occupancy","window","fan","updated_by"]`.
  - `_load_annotations_pg`: change the select to `select run_key, note, quality_flag, tags, occupancy, window, fan, updated_by from annotations`. (Quote `window` if needed: `"window"` — it's a reserved-ish word; use `select … , occupancy, "window", fan, …`.)
  - `_upsert_pg`: update the insert column list + `on conflict` set to include `occupancy, "window", fan`. Map params for all `COLS`.
  - CLI `main`: add `--occupancy`, `--window`, `--fan` flags to the `rec` built under `--set`, mirroring `--note`.

- [ ] **Step 4: Run → PASS**. Also run the PG-independent suite: `python -m pytest tests/ -q`.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/annotate.py site/scripts/tests/test_annotate.py
git commit -m "feat(ventis): annotate.py carries occupancy/window/fan override fields"
```

---

## Phase 3 — Resolution (override > label) in build_catalog

### Task 5: resolve overrides + recompose scenario (TDD)

**Files:** Modify `site/scripts/build_catalog.py`; Test same.

- [ ] **Step 1: Failing test** — a small pure resolver:

```python
from build_catalog import apply_attr_overrides


def test_apply_attr_overrides():
    rec = {"run_key": "k", "occupancy": 1, "window": "open", "fan": "off",
           "scenario": "window open · fan off"}
    anno = {"occupancy": "2", "window": "", "fan": ""}   # only occupancy overridden
    out = apply_attr_overrides(rec, anno)
    assert out["occupancy"] == 2            # coerced to int, from annotation
    assert out["window"] == "open"          # blank override = keep label value
    assert out["scenario"] == "window open · fan off"
    assert out["attr_overrides"] == ["occupancy"]
```

- [ ] **Step 2: Run → FAIL** (ImportError).

- [ ] **Step 3: Implement** `apply_attr_overrides` in `build_catalog.py`:

```python
def apply_attr_overrides(rec, anno):
    """Annotation override wins over the label-derived value, per field. A blank/None
    override means 'no override' (keep the label value). Records which fields were
    overridden in rec['attr_overrides'] so the UI can mark them. Recomposes scenario."""
    overridden = []
    occ = anno.get("occupancy")
    if occ not in (None, "", "None"):
        rec["occupancy"] = int(occ); overridden.append("occupancy")
    for f in ("window", "fan"):
        v = anno.get(f)
        if v not in (None, "", "None"):
            rec[f] = v; overridden.append(f)
    rec["scenario"] = compose_scenario(rec.get("window", ""), rec.get("fan", "off"))
    rec["attr_overrides"] = overridden
    return rec
```

- [ ] **Step 4: Wire it into the merge** — at the build_catalog annotation merge site (~line 178), after `merge_annotations(records, annos)`:

```python
        annos = load_annotations()
        merge_annotations(records, annos)              # note/quality_flag/tags
        for r in records:
            apply_attr_overrides(r, annos.get(r["run_key"], {}))
```

(Adjust to the existing variable names; `load_annotations()` is already called once — reuse that result instead of calling twice.)

- [ ] **Step 5: Run → PASS** + full suite green.

- [ ] **Step 6: Commit**

```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(ventis): resolve annotation overrides over label defaults + recompose scenario"
```

---

## Phase 4 — Catalog UI

### Task 6: Run interface fields

**Files:** Modify `library/src/lib/catalog.ts`

- [ ] Add to the `Run` interface:

```ts
  window?: string;       // label-derived (or annotation-overridden) window: open | closed | ""
  fan?: string;          // on | off
  scenario?: string;     // "window open · fan off"
  attr_overrides?: string[];  // which attrs came from the annotation
```

- [ ] Commit: `git add library/src/lib/catalog.ts && git commit -m "feat(ventis): Run interface gains window/fan/scenario/attr_overrides"`

### Task 7: RunDetail — show scenario + mark overrides

**Files:** Modify `library/src/components/RunDetail.tsx`

- [ ] In the rows array, replace the `["Occupancy", …]` / `["Window", …]` rows with resolved + label-derived values, and add Scenario + Fan. Mark annotation-sourced fields with a small "(noted)" suffix when `run.attr_overrides?.includes(field)`:

```tsx
    const noted = (f: string) => (run.attr_overrides?.includes(f) ? " (noted)" : "");
    // ...
    ["Scenario", run.scenario || "·"],
    ["Occupancy", (run.occupancy ?? "·") + noted("occupancy")],
    ["Window", (run.window || "·") + noted("window")],
    ["Fan", (run.fan || "·") + noted("fan")],
    ["Window (logged)", run.window_state || "·"],
```

- [ ] Type-check (`cd library && npx tsc -b --noEmit`) + commit.

### Task 8: RunTable — surface the scenario

**Files:** Modify `library/src/components/RunTable.tsx`

- [ ] Add a compact `scenario` under the condition cell (mirror the `cell-sub` treatment), or add a "Scenario" column to `COLS`. Keep it subtle (muted text), matching the existing run-table density. Type-check + commit.

---

## Phase 5 — Backfill + verify

### Task 9: backfill known overrides + verify the pipeline

- [ ] **Hand Diego SQL** to set the real overrides (Supabase SQL editor), or run via `annotate.py --set` locally:

```sql
-- Little run: roommate moved in mid-run -> 2 occupants (1-room double)
update annotations set occupancy = 2
  where run_key = 'legacy_little_window_1_person_20260610T174830';

-- Fahey: within-run window experiment (open -> closed -> open)
insert into annotations (run_key, "window", updated_by)
  values ('legacy_1RSingle_-_Fahey_20260601T213527', 'open→closed→open', 'diego')
  on conflict (run_key) do update set "window" = excluded."window";
```

- [ ] **Run the pipeline locally** (reads `SUPABASE_DB_URL` from `library/.dev.vars`):

```bash
cd site/scripts && SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' ../../library/.dev.vars | cut -d= -f2-)" python build_catalog.py
grep -o '"scenario":[^,]*' ../../library/public/data/catalog.json | head
```

Expected: `little_window_1_person` shows `occupancy 2` + `scenario "window open · fan off"`; Fahey shows the window sequence.

- [ ] **Build the catalog app** + eyeball: `cd library && npm run build && npm run test`. Optionally `npx wrangler pages dev dist` and check a run's detail page renders Scenario/Window/Fan with the "(noted)" marker on overridden fields.

- [ ] **Final commit / PR.** The hourly cron (`:17`) deploys `main`; or trigger the `data-library` workflow.

---

## Self-review checklist
- Occupancy parsing already done (`94346e7`) — Phase 1 only adds window/fan/scenario.
- `window` (label-derived) is kept distinct from `window_state` (logged sensor) — both surface in RunDetail.
- Overrides are blank-safe: an empty override never wipes a label value.
- Reserved word: `window` is a column name — quote it (`"window"`) in SQL.
- No em-dashes in any added copy; scenario uses the middot `·` (DESIGN.md §2).
- Annotation values are set via SQL / CLI / Table Editor (the `/curate` web write is plan-gated and out of scope).
