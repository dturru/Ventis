import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import patch_notes as pn


def test_areas_touched_maps_and_dedupes_in_order():
    files = ["firmware/src/main.cpp", "site/scripts/build_catalog.py",
             "firmware/sheets/Code.gs", "library/src/app.tsx"]
    areas = pn.areas_touched(files)
    assert areas == ["The device (firmware)", "Data pipeline (behind the scenes)",
                     "Data library site"]


def test_areas_touched_scripts_before_generic_site():
    # site/scripts/ must win over the generic site/ mapping (order matters).
    assert pn.areas_touched(["site/scripts/digest.py"]) == ["Data pipeline (behind the scenes)"]
    assert pn.areas_touched(["site/src/index.astro"]) == ["Public website"]


def test_template_summary_lists_subjects_and_areas():
    out = pn.template_summary(["fix device reboot", "faster charts"],
                              ["The device (firmware)"])
    assert "Areas updated: The device (firmware)." in out
    assert "- fix device reboot" in out and "- faster charts" in out


def test_compose_subject_counts_and_pluralizes():
    assert pn.compose_subject(["a"], ["The device (firmware)"]) == \
        "Ventis update — The device (firmware) (1 change)"
    assert "(2 changes)" in pn.compose_subject(["a", "b"], [])


def test_summarize_falls_back_to_template_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    out = pn.summarize(["did a thing"], ["Public website"])
    assert "- did a thing" in out            # template path, not LLM


def test_build_html_escapes_and_links(monkeypatch):
    monkeypatch.setenv("GITHUB_SERVER_URL", "https://github.com")
    monkeypatch.setenv("GITHUB_REPOSITORY", "dturru/Ventis")
    html = pn.build_html("a < b & c", "aaa..bbb")
    assert "a &lt; b &amp; c" in html                       # escaped
    assert "https://github.com/dturru/Ventis/compare/aaa...bbb" in html  # compare link


def test_dispatch_noop_without_config(monkeypatch):
    for k in ("PATCH_NOTES_TO", "PATCH_NOTES_SMTP_USER", "PATCH_NOTES_SMTP_PASS"):
        monkeypatch.delenv(k, raising=False)
    assert pn.dispatch("subj", "<p>hi</p>") is False


def test_dispatch_noop_with_recipients_but_no_creds(monkeypatch):
    monkeypatch.delenv("PATCH_NOTES_SMTP_USER", raising=False)
    monkeypatch.delenv("PATCH_NOTES_SMTP_PASS", raising=False)
    assert pn.dispatch("subj", "<p>hi</p>", recipients="a@b.com") is False
