from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from ci_tools.commands.release.cli import release_app

runner = CliRunner()


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / ".release-manifest.json"
    p.write_text(json.dumps({"version": "1.2.3"}))
    return p


@pytest.fixture()
def changelog(tmp_path: Path) -> Path:
    p = tmp_path / "CHANGELOG.md"
    p.write_text(
        "## v1.2.3\n\n- Fixed a bug\n- Added a feature\n\n## v1.2.2\n\n- Older entry\n"
    )
    return p


@pytest.fixture()
def plugin_json(tmp_path: Path) -> Path:
    p = tmp_path / "plugin.json"
    p.write_text(json.dumps({"name": "agent-skills", "version": "1.2.3"}))
    return p


@pytest.fixture()
def marketplace_json(tmp_path: Path) -> Path:
    p = tmp_path / "marketplace.json"
    p.write_text(json.dumps({"plugins": [{"name": "agent-skills", "version": "1.2.3"}]}))
    return p


@pytest.fixture()
def tags_file(tmp_path: Path) -> Path:
    p = tmp_path / "tags.txt"
    p.write_text("v1.0.0\nv1.1.0\nv1.2.2\n")
    return p


@pytest.fixture()
def empty_tags_file(tmp_path: Path) -> Path:
    p = tmp_path / "tags.txt"
    p.write_text("")
    return p


# ---------------------------------------------------------------------------
# release extract
# ---------------------------------------------------------------------------


class TestReleaseExtract:
    def test_outputs_json(self, manifest: Path, changelog: Path) -> None:
        result = runner.invoke(
            release_app,
            ["extract", "--manifest", str(manifest), "--changelog", str(changelog)],
        )
        assert result.exit_code == 0, result.output
        data = json.loads(result.stdout)
        assert data["version"] == "1.2.3"
        assert data["tag"] == "v1.2.3"
        assert "Fixed a bug" in data["release_notes"]

    def test_missing_manifest_exits_1(self, tmp_path: Path, changelog: Path) -> None:
        result = runner.invoke(
            release_app,
            [
                "extract",
                "--manifest", str(tmp_path / "nope.json"),
                "--changelog", str(changelog),
            ],
        )
        assert result.exit_code == 1

    def test_missing_changelog_exits_1(self, manifest: Path, tmp_path: Path) -> None:
        result = runner.invoke(
            release_app,
            [
                "extract",
                "--manifest", str(manifest),
                "--changelog", str(tmp_path / "nope.md"),
            ],
        )
        assert result.exit_code == 1

    def test_custom_tag_prefix(self, manifest: Path, changelog: Path) -> None:
        result = runner.invoke(
            release_app,
            [
                "extract",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--tag-prefix", "release/",
            ],
        )
        assert result.exit_code == 0, result.output
        assert json.loads(result.stdout)["tag"] == "release/1.2.3"

    def test_empty_tag_prefix(self, manifest: Path, changelog: Path) -> None:
        result = runner.invoke(
            release_app,
            [
                "extract",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--tag-prefix", "",
            ],
        )
        assert result.exit_code == 0, result.output
        assert json.loads(result.stdout)["tag"] == "1.2.3"


# ---------------------------------------------------------------------------
# release validate
# ---------------------------------------------------------------------------


class TestReleaseValidate:
    def test_passes_with_valid_artifacts(
        self,
        manifest: Path,
        changelog: Path,
        plugin_json: Path,
        marketplace_json: Path,
        tags_file: Path,
    ) -> None:
        result = runner.invoke(
            release_app,
            [
                "validate",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--plugin-json", str(plugin_json),
                "--marketplace-json", str(marketplace_json),
                "--tags-file", str(tags_file),
            ],
        )
        assert result.exit_code == 0, result.output
        assert "passed" in result.stdout
        assert "FAIL" not in result.stdout

    def test_fails_when_tag_exists(
        self, manifest: Path, changelog: Path, tmp_path: Path
    ) -> None:
        tags = tmp_path / "tags.txt"
        tags.write_text("v1.2.3\n")  # tag already exists
        result = runner.invoke(
            release_app,
            [
                "validate",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--tags-file", str(tags),
            ],
        )
        assert result.exit_code == 1
        assert "FAIL" in result.stdout

    def test_fails_when_version_file_drifted(
        self, manifest: Path, changelog: Path, tmp_path: Path
    ) -> None:
        old_plugin = tmp_path / "plugin.json"
        old_plugin.write_text(json.dumps({"version": "1.0.0"}))
        result = runner.invoke(
            release_app,
            [
                "validate",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--plugin-json", str(old_plugin),
            ],
        )
        assert result.exit_code == 1

    def test_initial_version_mismatch_fails(
        self, manifest: Path, changelog: Path, empty_tags_file: Path
    ) -> None:
        result = runner.invoke(
            release_app,
            [
                "validate",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--tags-file", str(empty_tags_file),
                "--initial-version", "2.0.0",  # mismatch — manifest is 1.2.3
            ],
        )
        assert result.exit_code == 1

    def test_works_without_optional_args(
        self, manifest: Path, changelog: Path
    ) -> None:
        result = runner.invoke(
            release_app,
            ["validate", "--manifest", str(manifest), "--changelog", str(changelog)],
        )
        assert result.exit_code == 0

    def test_markdown_table_in_output(
        self, manifest: Path, changelog: Path
    ) -> None:
        result = runner.invoke(
            release_app,
            ["validate", "--manifest", str(manifest), "--changelog", str(changelog)],
        )
        assert "| Check" in result.stdout
        assert "Release Notes Preview" in result.stdout

    def test_release_notes_preview_in_output(
        self, manifest: Path, changelog: Path
    ) -> None:
        result = runner.invoke(
            release_app,
            ["validate", "--manifest", str(manifest), "--changelog", str(changelog)],
        )
        assert "> - Fixed a bug" in result.stdout

    def test_custom_tag_prefix_in_summary(
        self, manifest: Path, changelog: Path
    ) -> None:
        result = runner.invoke(
            release_app,
            [
                "validate",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--tag-prefix", "release/",
            ],
        )
        assert result.exit_code == 0, result.output
        assert "release/1.2.3" in result.stdout

    def test_custom_tag_prefix_checked_against_tags_file(
        self, manifest: Path, changelog: Path, tmp_path: Path
    ) -> None:
        tags = tmp_path / "tags.txt"
        tags.write_text("release/1.2.3\n")  # tag exists with custom prefix
        result = runner.invoke(
            release_app,
            [
                "validate",
                "--manifest", str(manifest),
                "--changelog", str(changelog),
                "--tags-file", str(tags),
                "--tag-prefix", "release/",
            ],
        )
        assert result.exit_code == 1
        assert "FAIL" in result.stdout


# ---------------------------------------------------------------------------
# release sync
# ---------------------------------------------------------------------------


class TestReleaseSync:
    def test_syncs_plugin_json(self, tmp_path: Path, manifest: Path) -> None:
        pj = tmp_path / "plugin.json"
        pj.write_text(json.dumps({"version": "1.0.0", "name": "x"}))
        result = runner.invoke(
            release_app,
            ["sync", "--manifest", str(manifest), "--plugin-json", str(pj)],
        )
        assert result.exit_code == 0, result.output
        out = json.loads(result.stdout)
        assert out["version"] == "1.2.3"
        assert str(pj) in out["updated"]

    def test_syncs_marketplace_json(self, tmp_path: Path, manifest: Path) -> None:
        mj = tmp_path / "marketplace.json"
        mj.write_text(json.dumps({"plugins": [{"version": "1.0.0"}]}))
        result = runner.invoke(
            release_app,
            ["sync", "--manifest", str(manifest), "--marketplace-json", str(mj)],
        )
        assert result.exit_code == 0, result.output
        out = json.loads(result.stdout)
        assert str(mj) in out["updated"]

    def test_noop_when_in_sync(
        self, manifest: Path, plugin_json: Path, marketplace_json: Path
    ) -> None:
        result = runner.invoke(
            release_app,
            [
                "sync",
                "--manifest", str(manifest),
                "--plugin-json", str(plugin_json),
                "--marketplace-json", str(marketplace_json),
            ],
        )
        assert result.exit_code == 0, result.output
        out = json.loads(result.stdout)
        assert out["updated"] == []

    def test_no_targets_is_ok(self, manifest: Path) -> None:
        result = runner.invoke(
            release_app,
            ["sync", "--manifest", str(manifest)],
        )
        assert result.exit_code == 0, result.output
        out = json.loads(result.stdout)
        assert out["updated"] == []

    def test_missing_manifest_exits_1(self, tmp_path: Path) -> None:
        result = runner.invoke(
            release_app,
            ["sync", "--manifest", str(tmp_path / "nope.json")],
        )
        assert result.exit_code == 1
