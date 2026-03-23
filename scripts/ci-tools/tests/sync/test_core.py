from __future__ import annotations

import json
from pathlib import Path

import pytest

from ci_tools.commands.sync.core import (
    apply_copies,
    apply_sync,
    apply_versions,
    copy_tree,
    load_sync_config,
    navigate_field,
    resolve_field,
    resolve_target,
    resolve_template,
    update_json_field,
)
from ci_tools.commands.sync.models import (
    CopyMapping,
    SyncConfig,
    SyncDefaults,
    SyncTarget,
    VersionUpdate,
)


def _write_toml(path: Path, content: str) -> Path:
    path.write_text(content)
    return path


def _minimal_toml() -> str:
    return """\
[[sync.target]]
name = "cursor"
repo = "elastic/cursor-rules"

[[sync.target.copies]]
source = "skills"
dest = "skills"
"""


def _make_config() -> SyncConfig:
    return SyncConfig(
        target=[
            SyncTarget(
                name="cursor",
                repo="elastic/cursor-rules",
                copies=[CopyMapping(source="skills", dest="skills")],
                versions=[VersionUpdate(file="package.json", field="version")],
            )
        ]
    )


# ---------------------------------------------------------------------------
# load_sync_config
# ---------------------------------------------------------------------------


class TestLoadSyncConfig:
    def test_valid_toml(self, tmp_path: Path) -> None:
        cfg_path = _write_toml(tmp_path / "ci-tools.toml", _minimal_toml())
        cfg = load_sync_config(cfg_path)
        assert len(cfg.target) == 1
        assert cfg.target[0].name == "cursor"

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="not found"):
            load_sync_config(tmp_path / "nope.toml")

    def test_invalid_schema(self, tmp_path: Path) -> None:
        _write_toml(tmp_path / "bad.toml", "[sync.defaults]\nbranch = 42\n")
        with pytest.raises(Exception):
            load_sync_config(tmp_path / "bad.toml")

    def test_missing_required_fields(self, tmp_path: Path) -> None:
        _write_toml(tmp_path / "bad.toml", "[sync]\n")
        with pytest.raises(Exception):
            load_sync_config(tmp_path / "bad.toml")

    def test_missing_sync_section(self, tmp_path: Path) -> None:
        _write_toml(tmp_path / "bad.toml", "[other]\nfoo = 1\n")
        with pytest.raises(ValueError, match="Missing \\[sync\\]"):
            load_sync_config(tmp_path / "bad.toml")

    def test_with_defaults_override(self, tmp_path: Path) -> None:
        toml = """\
[sync.defaults]
branch = "custom-branch"

[[sync.target]]
name = "t"
repo = "org/repo"

[[sync.target.copies]]
source = "a"
dest = "b"
"""
        cfg = load_sync_config(_write_toml(tmp_path / "c.toml", toml))
        assert cfg.defaults.branch == "custom-branch"


# ---------------------------------------------------------------------------
# resolve_target
# ---------------------------------------------------------------------------


class TestResolveTarget:
    def test_found(self) -> None:
        cfg = _make_config()
        t = resolve_target(cfg, "cursor")
        assert t.repo == "elastic/cursor-rules"

    def test_not_found(self) -> None:
        cfg = _make_config()
        with pytest.raises(ValueError, match="not found"):
            resolve_target(cfg, "nonexistent")


# ---------------------------------------------------------------------------
# resolve_template
# ---------------------------------------------------------------------------


class TestResolveTemplate:
    def test_all_variables(self) -> None:
        result = resolve_template(
            "{version} {source_repo} {target_name}",
            version="1.0.0",
            source_repo="org/repo",
            target_name="cursor",
        )
        assert result == "1.0.0 org/repo cursor"

    def test_no_variables(self) -> None:
        result = resolve_template(
            "static text",
            version="1.0.0",
            source_repo="org/repo",
            target_name="cursor",
        )
        assert result == "static text"

    def test_missing_variable_raises(self) -> None:
        with pytest.raises(KeyError):
            resolve_template("{unknown}", version="1.0.0", source_repo="", target_name="")


# ---------------------------------------------------------------------------
# resolve_field
# ---------------------------------------------------------------------------


class TestResolveField:
    def test_uses_target_override(self) -> None:
        cfg = _make_config()
        target = SyncTarget(
            name="t", repo="r", branch="override", copies=[CopyMapping(source="a", dest="b")]
        )
        assert resolve_field(cfg, target, "branch") == "override"

    def test_falls_back_to_defaults(self) -> None:
        cfg = _make_config()
        target = SyncTarget(
            name="t", repo="r", copies=[CopyMapping(source="a", dest="b")]
        )
        assert resolve_field(cfg, target, "branch") == cfg.defaults.branch


# ---------------------------------------------------------------------------
# copy_tree
# ---------------------------------------------------------------------------


class TestCopyTree:
    def test_copies_files(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        (src / "a.txt").write_text("hello")
        (src / "sub").mkdir()
        (src / "sub" / "b.txt").write_text("world")

        copied, deleted = copy_tree(src, dst)
        assert copied == 2
        assert deleted == 0
        assert (dst / "a.txt").read_text() == "hello"
        assert (dst / "sub" / "b.txt").read_text() == "world"

    def test_deletes_stale_files(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        dst.mkdir()
        (src / "a.txt").write_text("hello")
        (dst / "stale.txt").write_text("old")

        copied, deleted = copy_tree(src, dst)
        assert copied == 1
        assert deleted == 1
        assert not (dst / "stale.txt").exists()

    def test_preserves_target_files(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        dst.mkdir()
        (src / "a.txt").write_text("hello")
        (dst / "README.md").write_text("keep me")
        (dst / "stale.txt").write_text("delete me")

        copied, deleted = copy_tree(src, dst, preserve=["README.md"])
        assert copied == 1
        assert deleted == 1
        assert (dst / "README.md").read_text() == "keep me"
        assert not (dst / "stale.txt").exists()

    def test_empty_source(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        dst.mkdir()
        (dst / "old.txt").write_text("old")

        copied, deleted = copy_tree(src, dst)
        assert copied == 0
        assert deleted == 1

    def test_nonexistent_dest_created(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        (src / "a.txt").write_text("hello")

        copied, deleted = copy_tree(src, dst)
        assert copied == 1
        assert deleted == 0
        assert (dst / "a.txt").exists()

    def test_skips_excluded_source_files(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        (src / "a.txt").write_text("hello")
        (src / "sub").mkdir()
        (src / "sub" / "plugin.json").write_text("{}")

        copied, deleted = copy_tree(src, dst, exclude=["**/plugin.json"])
        assert copied == 1
        assert (dst / "a.txt").exists()
        assert not (dst / "sub" / "plugin.json").exists()

    def test_skips_excluded_source_directory_glob(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        (src / "a.txt").write_text("hello")
        (src / ".claude-plugin").mkdir()
        (src / ".claude-plugin" / "plugin.json").write_text("{}")

        copied, deleted = copy_tree(src, dst, exclude=["**/.claude-plugin/**"])
        assert copied == 1
        assert (dst / "a.txt").exists()
        assert not (dst / ".claude-plugin").exists()

    def test_glob_preserve_pattern(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        dst.mkdir()
        (src / "a.txt").write_text("new")
        (dst / "keep.md").write_text("keep")
        (dst / "also_keep.md").write_text("keep too")

        copied, deleted = copy_tree(src, dst, preserve=["*.md"])
        assert copied == 1
        assert deleted == 0
        assert (dst / "keep.md").exists()
        assert (dst / "also_keep.md").exists()


# ---------------------------------------------------------------------------
# apply_copies
# ---------------------------------------------------------------------------


class TestApplyCopies:
    def test_aggregates_counts(self, tmp_path: Path) -> None:
        src_root = tmp_path / "source"
        tgt_root = tmp_path / "target"
        (src_root / "a").mkdir(parents=True)
        (src_root / "a" / "f1.txt").write_text("1")
        (src_root / "b").mkdir(parents=True)
        (src_root / "b" / "f2.txt").write_text("2")

        copies = [
            CopyMapping(source="a", dest="x"),
            CopyMapping(source="b", dest="y"),
        ]
        copied, deleted = apply_copies(src_root, tgt_root, copies)
        assert copied == 2
        assert (tgt_root / "x" / "f1.txt").exists()
        assert (tgt_root / "y" / "f2.txt").exists()


# ---------------------------------------------------------------------------
# navigate_field
# ---------------------------------------------------------------------------


class TestNavigateField:
    def test_simple_key(self) -> None:
        data = {"version": "1.0.0"}
        result = navigate_field(data, "version")
        assert result == [(data, "version")]

    def test_nested_path(self) -> None:
        data = {"a": {"b": {"c": "val"}}}
        result = navigate_field(data, "a.b.c")
        assert result == [(data["a"]["b"], "c")]

    def test_array_index(self) -> None:
        data = {"items": [{"v": "1"}, {"v": "2"}]}
        result = navigate_field(data, "items.0.v")
        assert result == [(data["items"][0], "v")]

    def test_wildcard(self) -> None:
        data = {"plugins": [{"version": "1"}, {"version": "2"}]}
        result = navigate_field(data, "plugins.*.version")
        assert len(result) == 2
        assert result[0] == (data["plugins"][0], "version")
        assert result[1] == (data["plugins"][1], "version")

    def test_invalid_key(self) -> None:
        with pytest.raises(ValueError, match="not found"):
            navigate_field({"a": 1}, "b")

    def test_wildcard_on_non_list(self) -> None:
        with pytest.raises(ValueError, match="non-list"):
            navigate_field({"a": {"b": 1}}, "a.*.b")

    def test_string_key_on_list(self) -> None:
        with pytest.raises(ValueError, match="Expected integer"):
            navigate_field({"items": [1, 2]}, "items.foo")

    def test_index_out_of_range(self) -> None:
        with pytest.raises(ValueError, match="out of range"):
            navigate_field({"items": [1]}, "items.5")


# ---------------------------------------------------------------------------
# update_json_field
# ---------------------------------------------------------------------------


class TestUpdateJsonField:
    def test_updates_value(self, tmp_path: Path) -> None:
        p = tmp_path / "test.json"
        p.write_text(json.dumps({"version": "1.0.0"}))
        assert update_json_field(p, "version", "2.0.0") is True
        assert json.loads(p.read_text())["version"] == "2.0.0"

    def test_noop_when_same(self, tmp_path: Path) -> None:
        p = tmp_path / "test.json"
        p.write_text(json.dumps({"version": "1.0.0"}))
        assert update_json_field(p, "version", "1.0.0") is False

    def test_nested_path(self, tmp_path: Path) -> None:
        p = tmp_path / "test.json"
        p.write_text(json.dumps({"a": {"b": "old"}}))
        assert update_json_field(p, "a.b", "new") is True
        assert json.loads(p.read_text())["a"]["b"] == "new"

    def test_wildcard(self, tmp_path: Path) -> None:
        p = tmp_path / "test.json"
        p.write_text(json.dumps({"plugins": [{"version": "1"}, {"version": "1"}]}))
        assert update_json_field(p, "plugins.*.version", "2") is True
        data = json.loads(p.read_text())
        assert all(pl["version"] == "2" for pl in data["plugins"])


# ---------------------------------------------------------------------------
# apply_versions
# ---------------------------------------------------------------------------


class TestApplyVersions:
    def test_updates_files(self, tmp_path: Path) -> None:
        (tmp_path / "package.json").write_text(json.dumps({"version": "0.0.1"}))
        versions = [VersionUpdate(file="package.json", field="version")]
        updated = apply_versions(tmp_path, versions, "1.0.0")
        assert updated == ["package.json:version"]

    def test_skips_missing_files(self, tmp_path: Path) -> None:
        versions = [VersionUpdate(file="nope.json", field="version")]
        updated = apply_versions(tmp_path, versions, "1.0.0")
        assert updated == []

    def test_glob_file_pattern(self, tmp_path: Path) -> None:
        (tmp_path / "skills" / "a").mkdir(parents=True)
        (tmp_path / "skills" / "b").mkdir(parents=True)
        (tmp_path / "skills" / "a" / "plugin.json").write_text(json.dumps({"version": "0.1"}))
        (tmp_path / "skills" / "b" / "plugin.json").write_text(json.dumps({"version": "0.1"}))
        versions = [VersionUpdate(file="**/plugin.json", field="version")]
        updated = apply_versions(tmp_path, versions, "1.0.0")
        assert len(updated) == 2
        assert all(entry.endswith(":version") for entry in updated)
        for p in tmp_path.rglob("plugin.json"):
            assert json.loads(p.read_text())["version"] == "1.0.0"

    def test_glob_no_matches(self, tmp_path: Path) -> None:
        versions = [VersionUpdate(file="**/plugin.json", field="version")]
        updated = apply_versions(tmp_path, versions, "1.0.0")
        assert updated == []

    def test_skips_unchanged(self, tmp_path: Path) -> None:
        (tmp_path / "package.json").write_text(json.dumps({"version": "1.0.0"}))
        versions = [VersionUpdate(file="package.json", field="version")]
        updated = apply_versions(tmp_path, versions, "1.0.0")
        assert updated == []


# ---------------------------------------------------------------------------
# apply_sync (end-to-end)
# ---------------------------------------------------------------------------


class TestApplySync:
    def test_end_to_end(self, tmp_path: Path) -> None:
        src = tmp_path / "source"
        tgt = tmp_path / "target"
        (src / "skills").mkdir(parents=True)
        (src / "skills" / "s1.md").write_text("# Skill 1")
        tgt.mkdir()
        (tgt / "package.json").write_text(json.dumps({"version": "0.0.1"}))

        cfg = SyncConfig(
            target=[
                SyncTarget(
                    name="cursor",
                    repo="elastic/cursor-rules",
                    copies=[CopyMapping(source="skills", dest="skills")],
                    versions=[VersionUpdate(file="package.json", field="version")],
                )
            ]
        )

        output = apply_sync(
            source_root=src,
            target_root=tgt,
            config=cfg,
            target_name="cursor",
            version="1.0.0",
            source_repo="elastic/agent-skills",
        )

        assert output.target_name == "cursor"
        assert output.repo == "elastic/cursor-rules"
        assert output.files_copied == 1
        assert output.versions_updated == ["package.json:version"]
        assert output.changes_made is True
        assert "1.0.0" in output.commit_message
        assert (tgt / "skills" / "s1.md").read_text() == "# Skill 1"
        assert json.loads((tgt / "package.json").read_text())["version"] == "1.0.0"

    def test_no_changes(self, tmp_path: Path) -> None:
        src = tmp_path / "source"
        tgt = tmp_path / "target"
        (src / "skills").mkdir(parents=True)
        tgt.mkdir()

        cfg = SyncConfig(
            target=[
                SyncTarget(
                    name="cursor",
                    repo="elastic/cursor-rules",
                    copies=[CopyMapping(source="skills", dest="skills")],
                )
            ]
        )

        output = apply_sync(
            source_root=src, target_root=tgt, config=cfg,
            target_name="cursor", version="1.0.0", source_repo="",
        )
        assert output.changes_made is False
