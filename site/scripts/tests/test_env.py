import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _env import load_env


def test_load_env_sets_var(tmp_path, monkeypatch):
    monkeypatch.delenv("FOO_TEST_VAR", raising=False)
    monkeypatch.delenv("BAR_TEST_VAR", raising=False)
    p = tmp_path / ".env"
    p.write_text('FOO_TEST_VAR=hello\n# a comment\nBAR_TEST_VAR="quoted val"\n\n', encoding="utf-8")
    load_env([str(p)])
    assert os.environ["FOO_TEST_VAR"] == "hello"
    assert os.environ["BAR_TEST_VAR"] == "quoted val"   # quotes stripped


def test_load_env_does_not_override_existing(tmp_path, monkeypatch):
    monkeypatch.setenv("ALREADY_SET", "keepme")          # mimics CI's real secret
    p = tmp_path / ".env"
    p.write_text("ALREADY_SET=changed\n", encoding="utf-8")
    load_env([str(p)])
    assert os.environ["ALREADY_SET"] == "keepme"


def test_load_env_missing_file_is_noop(tmp_path):
    # no .env present -> returns empty, raises nothing
    assert load_env([str(tmp_path / "nope.env")]) == {}
