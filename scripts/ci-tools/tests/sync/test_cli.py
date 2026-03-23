from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from ci_tools.commands.sync.cli import sync_app

runner = CliRunner()

_TOML_TEMPLATE = """\
[[sync.target]]
name = "cursor"
repo = "elastic/cursor-rules"

[[sync.target.copies]]
source = "skills"
dest = "skills"

[[sync.target.versions]]
file = "package.json"
field = "version"
"""


@pytest.fixture()
def config_file(tmp_path: Path) -> Path:
    p = tmp_path / "ci-tools.toml"
    p.write_text(_TOML_TEMPLATE)
    return p


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / ".release-manifest.json"
    p.write_text(json.dumps({"version": "3.0.0"}))
    return p


@pytest.fixture()
def source_root(tmp_path: Path) -> Path:
    src = tmp_path / "source"
    (src / "skills").mkdir(parents=True)
    (src / "skills" / "s1.md").write_text("# Skill")
    return src


@pytest.fixture()
def target_root(tmp_path: Path) -> Path:
    tgt = tmp_path / "target"
    tgt.mkdir()
    (tgt / "package.json").write_text(json.dumps({"version": "0.0.1"}))
    return tgt


# ---------------------------------------------------------------------------
# sync list
# ---------------------------------------------------------------------------


class TestSyncList:
    def test_lists_targets(self, config_file: Path) -> None:
        result = runner.invoke(sync_app, ["list", "--config", str(config_file)])
        assert result.exit_code == 0, result.output
        data = json.loads(result.stdout)
        assert data["targets"] == ["cursor"]

    def test_missing_config_exits_1(self, tmp_path: Path) -> None:
        result = runner.invoke(sync_app, ["list", "--config", str(tmp_path / "nope.toml")])
        assert result.exit_code == 1


# ---------------------------------------------------------------------------
# sync apply
# ---------------------------------------------------------------------------


class TestSyncApply:
    def test_apply_outputs_json(
        self, config_file: Path, source_root: Path, target_root: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--version", "1.0.0",
            ],
        )
        assert result.exit_code == 0, result.output
        data = json.loads(result.stdout)
        assert data["target_name"] == "cursor"
        assert data["files_copied"] == 1
        assert data["changes_made"] is True

    def test_apply_unknown_target_exits_1(
        self, config_file: Path, source_root: Path, target_root: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "nonexistent",
                "--version", "1.0.0",
            ],
        )
        assert result.exit_code == 1

    def test_apply_missing_config_exits_1(
        self, tmp_path: Path, source_root: Path, target_root: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(tmp_path / "nope.toml"),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--version", "1.0.0",
            ],
        )
        assert result.exit_code == 1

    def test_apply_stamps_version(
        self, config_file: Path, source_root: Path, target_root: Path
    ) -> None:
        runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--version", "2.0.0",
            ],
        )
        data = json.loads((target_root / "package.json").read_text())
        assert data["version"] == "2.0.0"

    def test_apply_with_source_repo(
        self, config_file: Path, source_root: Path, target_root: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--version", "1.0.0",
                "--source-repo", "elastic/agent-skills",
            ],
        )
        assert result.exit_code == 0, result.output
        data = json.loads(result.stdout)
        assert "elastic/agent-skills" in data["pr_body"]

    def test_apply_version_from_manifest(
        self, config_file: Path, source_root: Path, target_root: Path, manifest: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--manifest", str(manifest),
            ],
        )
        assert result.exit_code == 0, result.output
        data = json.loads(result.stdout)
        assert "3.0.0" in data["commit_message"]
        assert json.loads((target_root / "package.json").read_text())["version"] == "3.0.0"

    def test_apply_explicit_version_overrides_manifest(
        self, config_file: Path, source_root: Path, target_root: Path, manifest: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--version", "5.0.0",
                "--manifest", str(manifest),
            ],
        )
        assert result.exit_code == 0, result.output
        data = json.loads(result.stdout)
        assert "5.0.0" in data["commit_message"]

    def test_apply_no_version_no_manifest_exits_1(
        self, config_file: Path, source_root: Path, target_root: Path, tmp_path: Path
    ) -> None:
        result = runner.invoke(
            sync_app,
            [
                "apply",
                "--config", str(config_file),
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--target", "cursor",
                "--manifest", str(tmp_path / "nope.json"),
            ],
        )
        assert result.exit_code == 1
