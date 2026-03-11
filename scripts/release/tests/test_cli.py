from __future__ import annotations

import json
from pathlib import Path

import pytest

from release.cli import main, run_extract, run_validate


# ---------------------------------------------------------------------------
# run_extract
# ---------------------------------------------------------------------------

class TestRunExtract:
    def test_outputs_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = run_extract("1.2.3", "v1.2.3", "- Fixed a bug")
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["version"] == "1.2.3"
        assert out["tag"] == "v1.2.3"
        assert out["release_notes"] == "- Fixed a bug"


# ---------------------------------------------------------------------------
# run_validate
# ---------------------------------------------------------------------------

class TestRunValidate:
    def test_all_pass(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = run_validate("1.2.3", "v1.2.3", "- note", None, None)
        assert rc == 0
        out = capsys.readouterr().out
        assert "passed" in out
        assert "FAIL" not in out

    def test_tag_error(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = run_validate("1.2.3", "v1.2.3", "- note", "tag v1.2.3 already exists", None)
        assert rc == 1
        out = capsys.readouterr().out
        assert "FAILED" in out
        assert "already exists" in out

    def test_initial_version_error(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = run_validate("2.0.0", "v2.0.0", "- note", None, "expected v1.0.0")
        assert rc == 1
        out = capsys.readouterr().out
        assert "FAILED" in out

    def test_release_notes_preview(self, capsys: pytest.CaptureFixture[str]) -> None:
        run_validate("1.0.0", "v1.0.0", "- line one\n- line two", None, None)
        out = capsys.readouterr().out
        assert "> - line one" in out
        assert "> - line two" in out


# ---------------------------------------------------------------------------
# main (end-to-end CLI)
# ---------------------------------------------------------------------------

class TestMain:
    def test_extract_mode(
        self,
        plugin_json: Path,
        changelog: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--plugin-json", str(plugin_json),
                "--changelog", str(changelog),
            ])
        assert exc_info.value.code == 0
        out = json.loads(capsys.readouterr().out)
        assert out["version"] == "1.2.3"
        assert out["tag"] == "v1.2.3"

    def test_validate_mode_passes(
        self,
        plugin_json: Path,
        changelog: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--plugin-json", str(plugin_json),
                "--changelog", str(changelog),
                "--validate",
            ])
        assert exc_info.value.code == 0
        out = capsys.readouterr().out
        assert "passed" in out

    def test_validate_mode_with_duplicate_tag(
        self,
        plugin_json: Path,
        changelog: Path,
        tags_file: Path,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        tags_file.write_text("v1.2.3\n")
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--plugin-json", str(plugin_json),
                "--changelog", str(changelog),
                "--validate",
                "--existing-tags-file", str(tags_file),
            ])
        assert exc_info.value.code == 1
        out = capsys.readouterr().out
        assert "already exists" in out

    def test_missing_plugin_json(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="does not exist"):
            main(["--plugin-json", str(tmp_path / "nope.json")])
