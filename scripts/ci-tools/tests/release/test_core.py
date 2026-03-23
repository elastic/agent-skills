from __future__ import annotations

import json
from pathlib import Path

import pytest

from ci_tools.commands.release.core import (
    FileTagsProvider,
    check_tags,
    check_version_files,
    extract_changelog_entry,
    read_manifest,
    read_marketplace_manifest,
    read_plugin_manifest,
    update_marketplace_version,
    update_plugin_version,
)
from ci_tools.commands.release.models import (
    MarketplaceManifest,
    PluginManifest,
    ReleaseManifest,
    TagCheckResult,
    VersionFileError,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def manifest_path(tmp_path: Path) -> Path:
    p = tmp_path / ".release-manifest.json"
    p.write_text(json.dumps({"version": "1.2.3"}))
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
def changelog(tmp_path: Path) -> Path:
    p = tmp_path / "CHANGELOG.md"
    p.write_text(
        "## v1.2.3\n\n- Fixed a bug\n- Added a feature\n\n## v1.2.2\n\n- Older entry\n"
    )
    return p


# ---------------------------------------------------------------------------
# read_manifest
# ---------------------------------------------------------------------------


class TestReadManifest:
    def test_returns_model(self, manifest_path: Path) -> None:
        m = read_manifest(manifest_path)
        assert isinstance(m, ReleaseManifest)
        assert m.version == "1.2.3"

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            read_manifest(tmp_path / "nope.json")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.json"
        p.write_text("{not json}")
        with pytest.raises(ValueError, match="invalid JSON"):
            read_manifest(p)

    def test_invalid_semver_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "manifest.json"
        p.write_text(json.dumps({"version": "1.2.3-beta"}))
        with pytest.raises(ValueError, match="version"):
            read_manifest(p)

    def test_missing_version_field_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "manifest.json"
        p.write_text(json.dumps({"name": "test"}))
        with pytest.raises(ValueError, match="version"):
            read_manifest(p)


# ---------------------------------------------------------------------------
# read_plugin_manifest
# ---------------------------------------------------------------------------


class TestReadPluginManifest:
    def test_returns_model(self, plugin_json: Path) -> None:
        m = read_plugin_manifest(plugin_json)
        assert isinstance(m, PluginManifest)
        assert m.version == "1.2.3"

    def test_extra_fields_preserved(self, plugin_json: Path) -> None:
        m = read_plugin_manifest(plugin_json)
        assert m.model_dump()["name"] == "agent-skills"

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            read_plugin_manifest(tmp_path / "nope.json")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.json"
        p.write_text("{not json}")
        with pytest.raises(ValueError, match="invalid JSON"):
            read_plugin_manifest(p)


# ---------------------------------------------------------------------------
# read_marketplace_manifest
# ---------------------------------------------------------------------------


class TestReadMarketplaceManifest:
    def test_returns_model(self, marketplace_json: Path) -> None:
        m = read_marketplace_manifest(marketplace_json)
        assert isinstance(m, MarketplaceManifest)
        assert m.plugins[0].version == "1.2.3"

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            read_marketplace_manifest(tmp_path / "nope.json")

    def test_empty_plugins_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": []}))
        with pytest.raises(ValueError):
            read_marketplace_manifest(p)


# ---------------------------------------------------------------------------
# extract_changelog_entry
# ---------------------------------------------------------------------------


class TestExtractChangelogEntry:
    def test_extracts_body(self, changelog: Path) -> None:
        body = extract_changelog_entry(changelog, "1.2.3")
        assert "Fixed a bug" in body
        assert "Older entry" not in body

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            extract_changelog_entry(tmp_path / "CHANGELOG.md", "1.0.0")

    def test_missing_entry_raises(self, changelog: Path) -> None:
        with pytest.raises(ValueError, match="no entry for version 9.9.9"):
            extract_changelog_entry(changelog, "9.9.9")

    def test_empty_entry_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "CHANGELOG.md"
        p.write_text("## v2.0.0\n\n## v1.0.0\n\n- stuff\n")
        with pytest.raises(ValueError, match="empty"):
            extract_changelog_entry(p, "2.0.0")

    def test_entry_without_v_prefix(self, tmp_path: Path) -> None:
        p = tmp_path / "CHANGELOG.md"
        p.write_text("## 3.0.0\n\n- stuff\n")
        assert "stuff" in extract_changelog_entry(p, "3.0.0")

    def test_last_entry_no_following_heading(self, tmp_path: Path) -> None:
        p = tmp_path / "CHANGELOG.md"
        p.write_text("## v1.0.0\n\n- only entry\n")
        assert "only entry" in extract_changelog_entry(p, "1.0.0")


# ---------------------------------------------------------------------------
# update_plugin_version
# ---------------------------------------------------------------------------


class TestUpdatePluginVersion:
    def test_updates_and_returns_true(self, plugin_json: Path) -> None:
        changed = update_plugin_version(plugin_json, "2.0.0")
        assert changed is True
        data = json.loads(plugin_json.read_text())
        assert data["version"] == "2.0.0"

    def test_noop_returns_false(self, plugin_json: Path) -> None:
        assert update_plugin_version(plugin_json, "1.2.3") is False

    def test_preserves_extra_fields(self, plugin_json: Path) -> None:
        update_plugin_version(plugin_json, "2.0.0")
        assert json.loads(plugin_json.read_text())["name"] == "agent-skills"

    def test_preserves_unicode(self, tmp_path: Path) -> None:
        p = tmp_path / "plugin.json"
        p.write_text(json.dumps({"name": "skills \u2014 pro", "version": "1.0.0"}, ensure_ascii=False))
        update_plugin_version(p, "2.0.0")
        raw = p.read_text()
        assert "\u2014" in raw
        assert "\\u2014" not in raw

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            update_plugin_version(tmp_path / "nope.json", "1.0.0")


# ---------------------------------------------------------------------------
# update_marketplace_version
# ---------------------------------------------------------------------------


class TestUpdateMarketplaceVersion:
    def test_updates_and_returns_true(self, marketplace_json: Path) -> None:
        changed = update_marketplace_version(marketplace_json, "2.0.0")
        assert changed is True
        data = json.loads(marketplace_json.read_text())
        assert data["plugins"][0]["version"] == "2.0.0"

    def test_updates_all_plugin_entries(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": [
            {"name": "plugin-a", "version": "1.0.0"},
            {"name": "plugin-b", "version": "1.0.0"},
            {"name": "plugin-c", "version": "0.9.0"},
        ]}))
        changed = update_marketplace_version(p, "2.0.0")
        assert changed is True
        data = json.loads(p.read_text())
        assert all(entry["version"] == "2.0.0" for entry in data["plugins"])

    def test_noop_returns_false(self, marketplace_json: Path) -> None:
        assert update_marketplace_version(marketplace_json, "1.2.3") is False

    def test_noop_all_entries_already_match(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": [
            {"name": "a", "version": "1.0.0"},
            {"name": "b", "version": "1.0.0"},
        ]}))
        assert update_marketplace_version(p, "1.0.0") is False

    def test_preserves_extra_fields(self, marketplace_json: Path) -> None:
        update_marketplace_version(marketplace_json, "2.0.0")
        data = json.loads(marketplace_json.read_text())
        assert data["plugins"][0]["name"] == "agent-skills"

    def test_preserves_unicode(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": [
            {"name": "ES|QL queries \u2014 pro", "version": "1.0.0"},
        ]}, ensure_ascii=False))
        update_marketplace_version(p, "2.0.0")
        raw = p.read_text()
        assert "\u2014" in raw
        assert "\\u2014" not in raw

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            update_marketplace_version(tmp_path / "nope.json", "1.0.0")


# ---------------------------------------------------------------------------
# FileTagsProvider
# ---------------------------------------------------------------------------


class TestFileTagsProvider:
    def test_reads_tags_from_file(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("v1.0.0\nv1.1.0\nv1.2.2\n")
        provider = FileTagsProvider(p)
        assert provider.get_tags() == {"v1.0.0", "v1.1.0", "v1.2.2"}

    def test_returns_empty_set_for_missing_file(self, tmp_path: Path) -> None:
        provider = FileTagsProvider(tmp_path / "nope.txt")
        assert provider.get_tags() == set()

    def test_ignores_blank_lines(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("v1.0.0\n\n  \nv1.1.0\n")
        assert FileTagsProvider(p).get_tags() == {"v1.0.0", "v1.1.0"}


# ---------------------------------------------------------------------------
# check_tags
# ---------------------------------------------------------------------------


class TestCheckTags:
    def test_tag_does_not_exist(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("v1.0.0\nv1.1.0\n")
        result = check_tags(FileTagsProvider(p), "v1.2.3", None)
        assert result.tag_error is None
        assert result.initial_version_error is None

    def test_tag_already_exists(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("v1.0.0\nv1.2.2\n")
        result = check_tags(FileTagsProvider(p), "v1.2.2", None)
        assert result.tag_error is not None
        assert "already exists" in result.tag_error

    def test_no_tags_file_ok(self, tmp_path: Path) -> None:
        result = check_tags(FileTagsProvider(tmp_path / "nope.txt"), "v1.0.0", "1.0.0")
        assert result.tag_error is None
        assert result.initial_version_error is None

    def test_initial_version_matches(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("")
        result = check_tags(FileTagsProvider(p), "v1.0.0", "1.0.0")
        assert result.initial_version_error is None

    def test_initial_version_mismatch(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("")
        result = check_tags(FileTagsProvider(p), "v2.0.0", "1.0.0")
        assert result.initial_version_error is not None
        assert "v1.0.0" in result.initial_version_error

    def test_initial_version_ignored_when_tags_exist(self, tmp_path: Path) -> None:
        p = tmp_path / "tags.txt"
        p.write_text("v1.0.0\n")
        result = check_tags(FileTagsProvider(p), "v5.0.0", "1.0.0")
        assert result.initial_version_error is None

    def test_mockable_provider(self) -> None:
        """Verify that any object with get_tags() satisfies the protocol."""

        class StubProvider:
            def get_tags(self) -> set[str]:
                return {"v9.9.9"}

        result = check_tags(StubProvider(), "v9.9.9", None)
        assert result.tag_error is not None


# ---------------------------------------------------------------------------
# check_version_files
# ---------------------------------------------------------------------------


class TestCheckVersionFiles:
    def test_no_errors_when_in_sync(
        self, plugin_json: Path, marketplace_json: Path
    ) -> None:
        errors = check_version_files("1.2.3", [plugin_json, marketplace_json])
        assert errors == []

    def test_detects_plugin_drift(self, tmp_path: Path) -> None:
        p = tmp_path / "plugin.json"
        p.write_text(json.dumps({"version": "1.0.0"}))
        errors = check_version_files("1.2.3", [p])
        assert len(errors) == 1
        assert "plugin.json" in errors[0].filename
        assert "1.0.0" in errors[0].message

    def test_detects_marketplace_drift(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": [{"version": "1.0.0"}]}))
        errors = check_version_files("1.2.3", [p])
        assert len(errors) == 1

    def test_detects_marketplace_drift_multiple_entries(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": [
            {"name": "a", "version": "1.2.3"},
            {"name": "b", "version": "1.0.0"},
            {"name": "c", "version": "0.9.0"},
        ]}))
        errors = check_version_files("1.2.3", [p])
        assert len(errors) == 2
        assert any("b" in e.message for e in errors)
        assert any("c" in e.message for e in errors)

    def test_marketplace_entries_without_version(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": [{"name": "a"}]}))
        errors = check_version_files("1.2.3", [p])
        assert len(errors) == 1

    def test_skips_missing_files(self, tmp_path: Path) -> None:
        errors = check_version_files("1.2.3", [tmp_path / "nope.json"])
        assert errors == []

    def test_multiple_files_partial_drift(
        self, plugin_json: Path, tmp_path: Path
    ) -> None:
        mj = tmp_path / "marketplace.json"
        mj.write_text(json.dumps({"plugins": [{"version": "0.9.0"}]}))
        errors = check_version_files("1.2.3", [plugin_json, mj])
        # plugin_json is at 1.2.3 (in sync), marketplace is not
        assert len(errors) == 1
        assert "marketplace.json" in errors[0].filename
