from __future__ import annotations

import json
from pathlib import Path

import pytest

from release.core import (
    check_tag,
    extract_changelog_entry,
    read_version,
    update_json_version,
    update_marketplace_version,
)


# ---------------------------------------------------------------------------
# read_version
# ---------------------------------------------------------------------------

class TestReadVersion:
    def test_valid_version(self, manifest: Path) -> None:
        assert read_version(manifest) == "1.2.3"

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="does not exist"):
            read_version(tmp_path / "missing.json")

    def test_invalid_json(self, tmp_path: Path) -> None:
        bad = tmp_path / "manifest.json"
        bad.write_text("{not json}")
        with pytest.raises(SystemExit, match="not valid JSON"):
            read_version(bad)

    def test_missing_version_field(self, tmp_path: Path) -> None:
        no_ver = tmp_path / "manifest.json"
        no_ver.write_text(json.dumps({"name": "test"}))
        with pytest.raises(SystemExit, match="no 'version' field"):
            read_version(no_ver)

    def test_invalid_semver(self, tmp_path: Path) -> None:
        bad_ver = tmp_path / "manifest.json"
        bad_ver.write_text(json.dumps({"version": "1.2.3-beta"}))
        with pytest.raises(SystemExit, match="not valid semver"):
            read_version(bad_ver)

    @pytest.mark.parametrize("version", ["0.0.1", "10.20.30", "1.0.0"])
    def test_valid_semver_variants(self, tmp_path: Path, version: str) -> None:
        p = tmp_path / "manifest.json"
        p.write_text(json.dumps({"version": version}))
        assert read_version(p) == version

    @pytest.mark.parametrize("version", ["01.2.3", "1.02.3", "1.2.03", "v1.2.3", "1.2"])
    def test_rejected_semver_variants(self, tmp_path: Path, version: str) -> None:
        p = tmp_path / "manifest.json"
        p.write_text(json.dumps({"version": version}))
        with pytest.raises(SystemExit, match="not valid semver"):
            read_version(p)


# ---------------------------------------------------------------------------
# update_json_version
# ---------------------------------------------------------------------------

class TestUpdateJsonVersion:
    def test_updates_version(self, plugin_json: Path) -> None:
        assert update_json_version(plugin_json, "2.0.0") is True
        data = json.loads(plugin_json.read_text())
        assert data["version"] == "2.0.0"

    def test_noop_when_already_matching(self, plugin_json: Path) -> None:
        assert update_json_version(plugin_json, "1.2.3") is False

    def test_preserves_other_fields(self, plugin_json: Path) -> None:
        update_json_version(plugin_json, "2.0.0")
        data = json.loads(plugin_json.read_text())
        assert data["name"] == "agent-skills"

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="does not exist"):
            update_json_version(tmp_path / "nope.json", "1.0.0")

    def test_invalid_json(self, tmp_path: Path) -> None:
        bad = tmp_path / "bad.json"
        bad.write_text("{not json}")
        with pytest.raises(SystemExit, match="not valid JSON"):
            update_json_version(bad, "1.0.0")


# ---------------------------------------------------------------------------
# update_marketplace_version
# ---------------------------------------------------------------------------

class TestUpdateMarketplaceVersion:
    def test_updates_version(self, marketplace_json: Path) -> None:
        assert update_marketplace_version(marketplace_json, "2.0.0") is True
        data = json.loads(marketplace_json.read_text())
        assert data["plugins"][0]["version"] == "2.0.0"

    def test_noop_when_already_matching(self, marketplace_json: Path) -> None:
        assert update_marketplace_version(marketplace_json, "1.2.3") is False

    def test_preserves_other_fields(self, marketplace_json: Path) -> None:
        update_marketplace_version(marketplace_json, "2.0.0")
        data = json.loads(marketplace_json.read_text())
        assert data["plugins"][0]["name"] == "agent-skills"

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="does not exist"):
            update_marketplace_version(tmp_path / "nope.json", "1.0.0")

    def test_empty_plugins_array(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"plugins": []}))
        with pytest.raises(SystemExit, match="no 'plugins' array or it is empty"):
            update_marketplace_version(p, "1.0.0")

    def test_missing_plugins_key(self, tmp_path: Path) -> None:
        p = tmp_path / "marketplace.json"
        p.write_text(json.dumps({"name": "test"}))
        with pytest.raises(SystemExit, match="no 'plugins' array or it is empty"):
            update_marketplace_version(p, "1.0.0")


# ---------------------------------------------------------------------------
# extract_changelog_entry
# ---------------------------------------------------------------------------

class TestExtractChangelogEntry:
    def test_extracts_entry(self, changelog: Path) -> None:
        body = extract_changelog_entry(changelog, "1.2.3")
        assert "Fixed a bug" in body
        assert "Added a feature" in body
        assert "Older entry" not in body

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="does not exist"):
            extract_changelog_entry(tmp_path / "missing.md", "1.0.0")

    def test_missing_version_entry(self, changelog: Path) -> None:
        with pytest.raises(SystemExit, match="no entry for version 9.9.9"):
            extract_changelog_entry(changelog, "9.9.9")

    def test_empty_entry(self, tmp_path: Path) -> None:
        cl = tmp_path / "CHANGELOG.md"
        cl.write_text("## v2.0.0\n\n## v1.0.0\n\n- old\n")
        with pytest.raises(SystemExit, match="empty"):
            extract_changelog_entry(cl, "2.0.0")

    def test_heading_without_v_prefix(self, tmp_path: Path) -> None:
        cl = tmp_path / "CHANGELOG.md"
        cl.write_text("## 3.0.0\n\n- stuff\n")
        body = extract_changelog_entry(cl, "3.0.0")
        assert "stuff" in body

    def test_last_entry_has_no_following_heading(self, tmp_path: Path) -> None:
        cl = tmp_path / "CHANGELOG.md"
        cl.write_text("## v1.0.0\n\n- only entry\n")
        body = extract_changelog_entry(cl, "1.0.0")
        assert "only entry" in body


# ---------------------------------------------------------------------------
# check_tag
# ---------------------------------------------------------------------------

class TestCheckTag:
    def test_tag_does_not_exist(self, tags_file: Path) -> None:
        tag_err, iv_err = check_tag(tags_file, "v1.2.3", None)
        assert tag_err is None
        assert iv_err is None

    def test_tag_already_exists(self, tags_file: Path) -> None:
        tag_err, iv_err = check_tag(tags_file, "v1.2.2", None)
        assert tag_err is not None
        assert "already exists" in tag_err

    def test_missing_tags_file(self, tmp_path: Path) -> None:
        tag_err, iv_err = check_tag(tmp_path / "nope.txt", "v1.0.0", "1.0.0")
        assert tag_err is None
        assert iv_err is None

    def test_initial_version_matches(self, empty_tags_file: Path) -> None:
        tag_err, iv_err = check_tag(empty_tags_file, "v1.0.0", "1.0.0")
        assert tag_err is None
        assert iv_err is None

    def test_initial_version_mismatch(self, empty_tags_file: Path) -> None:
        tag_err, iv_err = check_tag(empty_tags_file, "v2.0.0", "1.0.0")
        assert iv_err is not None
        assert "expected v1.0.0" in iv_err

    def test_initial_version_ignored_when_tags_exist(self, tags_file: Path) -> None:
        _, iv_err = check_tag(tags_file, "v5.0.0", "1.0.0")
        assert iv_err is None
