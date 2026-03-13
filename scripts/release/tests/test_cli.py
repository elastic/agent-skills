from __future__ import annotations

import json
from pathlib import Path

import pytest

from release.cli import main, run_extract, run_sync, run_validate


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

    def test_version_file_errors(self, capsys: pytest.CaptureFixture[str]) -> None:
        errors = [("plugin.json", "expected 1.2.3, got 1.0.0")]
        rc = run_validate("1.2.3", "v1.2.3", "- note", None, None, errors)
        assert rc == 1
        out = capsys.readouterr().out
        assert "FAILED" in out
        assert "Version sync" in out
        assert "expected 1.2.3, got 1.0.0" in out


# ---------------------------------------------------------------------------
# run_sync
# ---------------------------------------------------------------------------

class TestRunSync:
    def test_updates_plugin_json(
        self,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        pj = tmp_path / "plugin.json"
        pj.write_text(json.dumps({"version": "1.0.0"}))
        rc = run_sync("2.0.0", pj, None)
        assert rc == 0
        assert json.loads(pj.read_text())["version"] == "2.0.0"
        out = json.loads(capsys.readouterr().out)
        assert str(pj) in out["updated"]

    def test_updates_marketplace_json(
        self,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        mj = tmp_path / "marketplace.json"
        mj.write_text(json.dumps({"plugins": [{"version": "1.0.0"}]}))
        rc = run_sync("2.0.0", None, mj)
        assert rc == 0
        data = json.loads(mj.read_text())
        assert data["plugins"][0]["version"] == "2.0.0"
        out = json.loads(capsys.readouterr().out)
        assert str(mj) in out["updated"]

    def test_noop_when_in_sync(
        self,
        plugin_json: Path,
        marketplace_json: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = run_sync("1.2.3", plugin_json, marketplace_json)
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["updated"] == []

    def test_no_targets(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = run_sync("1.0.0", None, None)
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["updated"] == []

    def test_missing_plugin_json_skipped(
        self,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = run_sync("2.0.0", tmp_path / "missing.json", None)
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["updated"] == []

    def test_missing_marketplace_json_skipped(
        self,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = run_sync("2.0.0", None, tmp_path / "missing.json")
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["updated"] == []


# ---------------------------------------------------------------------------
# main (end-to-end CLI)
# ---------------------------------------------------------------------------

class TestMain:
    def test_extract_mode(
        self,
        manifest: Path,
        changelog: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--manifest", str(manifest),
                "--changelog", str(changelog),
            ])
        assert exc_info.value.code == 0
        out = json.loads(capsys.readouterr().out)
        assert out["version"] == "1.2.3"
        assert out["tag"] == "v1.2.3"

    def test_validate_mode_passes(
        self,
        manifest: Path,
        changelog: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--validate",
            ])
        assert exc_info.value.code == 0
        out = capsys.readouterr().out
        assert "passed" in out

    def test_validate_mode_with_duplicate_tag(
        self,
        manifest: Path,
        changelog: Path,
        tags_file: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        tags_file.write_text("v1.2.3\n")
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--validate",
                "--existing-tags-file", str(tags_file),
            ])
        assert exc_info.value.code == 1
        out = capsys.readouterr().out
        assert "already exists" in out

    def test_validate_detects_version_drift(
        self,
        manifest: Path,
        changelog: Path,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        pj = tmp_path / "plugin.json"
        pj.write_text(json.dumps({"version": "1.0.0"}))
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--validate",
                "--plugin-json", str(pj),
            ])
        assert exc_info.value.code == 1
        out = capsys.readouterr().out
        assert "expected 1.2.3, got 1.0.0" in out

    def test_validate_passes_when_files_in_sync(
        self,
        manifest: Path,
        changelog: Path,
        plugin_json: Path,
        marketplace_json: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--validate",
                "--plugin-json", str(plugin_json),
                "--marketplace-json", str(marketplace_json),
            ])
        assert exc_info.value.code == 0
        out = capsys.readouterr().out
        assert "passed" in out

    def test_sync_mode(
        self,
        manifest: Path,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        pj = tmp_path / "plugin.json"
        pj.write_text(json.dumps({"version": "1.0.0"}))
        with pytest.raises(SystemExit) as exc_info:
            main([
                "--manifest", str(manifest),
                "--sync",
                "--plugin-json", str(pj),
            ])
        assert exc_info.value.code == 0
        assert json.loads(pj.read_text())["version"] == "1.2.3"

    def test_missing_manifest(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="does not exist"):
            main(["--manifest", str(tmp_path / "nope.json")])
