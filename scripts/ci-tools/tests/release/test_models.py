from __future__ import annotations

import pytest
from pydantic import ValidationError

from ci_tools.commands.release.models import (
    MarketplaceManifest,
    MarketplacePluginEntry,
    PluginManifest,
    ReleaseManifest,
    ReleaseOutput,
    SyncOutput,
    TagCheckResult,
    ValidationResult,
    VersionFileError,
)


class TestReleaseManifest:
    def test_valid_semver(self) -> None:
        m = ReleaseManifest(version="1.2.3")
        assert m.version == "1.2.3"

    @pytest.mark.parametrize("v", ["0.0.1", "10.20.30", "1.0.0"])
    def test_valid_semver_variants(self, v: str) -> None:
        assert ReleaseManifest(version=v).version == v

    @pytest.mark.parametrize("v", ["1.2.3-beta", "v1.2.3", "1.2", "01.2.3"])
    def test_rejects_invalid_semver(self, v: str) -> None:
        with pytest.raises(ValidationError):
            ReleaseManifest(version=v)


class TestPluginManifest:
    def test_basic(self) -> None:
        m = PluginManifest(version="1.0.0")
        assert m.version == "1.0.0"

    def test_extra_fields_preserved(self) -> None:
        # extra="allow" — round-trip must not drop unknown fields
        m = PluginManifest.model_validate({"version": "1.0.0", "name": "my-plugin"})
        assert m.model_dump()["name"] == "my-plugin"


class TestMarketplacePluginEntry:
    def test_version_optional(self) -> None:
        entry = MarketplacePluginEntry.model_validate({"name": "my-plugin"})
        assert entry.version is None

    def test_version_present(self) -> None:
        entry = MarketplacePluginEntry(version="1.0.0")
        assert entry.version == "1.0.0"

    def test_extra_fields_preserved(self) -> None:
        entry = MarketplacePluginEntry.model_validate(
            {"name": "my-plugin", "version": "1.0.0", "description": "desc"}
        )
        assert entry.model_dump()["name"] == "my-plugin"


class TestMarketplaceManifest:
    def test_basic(self) -> None:
        m = MarketplaceManifest(plugins=[MarketplacePluginEntry(version="1.0.0")])
        assert m.plugins[0].version == "1.0.0"

    def test_entries_without_version(self) -> None:
        m = MarketplaceManifest.model_validate(
            {"plugins": [{"name": "a"}, {"name": "b"}]}
        )
        assert len(m.plugins) == 2
        assert m.plugins[0].version is None

    def test_rejects_empty_plugins(self) -> None:
        with pytest.raises(ValidationError):
            MarketplaceManifest(plugins=[])


class TestTagCheckResult:
    def test_defaults_to_none(self) -> None:
        r = TagCheckResult()
        assert r.tag_error is None
        assert r.initial_version_error is None


class TestVersionFileError:
    def test_fields(self) -> None:
        e = VersionFileError(filename="plugin.json", message="expected 1.2.3, got 1.0.0")
        assert e.filename == "plugin.json"
        assert "1.2.3" in e.message


class TestValidationResult:
    def test_passed_when_no_errors(self) -> None:
        r = ValidationResult(
            version="1.0.0",
            tag="v1.0.0",
            release_notes="- note",
            tag_check=TagCheckResult(),
        )
        assert r.passed is True

    def test_fails_when_tag_error(self) -> None:
        r = ValidationResult(
            version="1.0.0",
            tag="v1.0.0",
            release_notes="- note",
            tag_check=TagCheckResult(tag_error="already exists"),
        )
        assert r.passed is False

    def test_fails_when_file_errors(self) -> None:
        r = ValidationResult(
            version="1.0.0",
            tag="v1.0.0",
            release_notes="- note",
            tag_check=TagCheckResult(),
            file_errors=[VersionFileError(filename="f", message="m")],
        )
        assert r.passed is False

    def test_fails_when_initial_version_error(self) -> None:
        r = ValidationResult(
            version="1.0.0",
            tag="v1.0.0",
            release_notes="- note",
            tag_check=TagCheckResult(initial_version_error="mismatch"),
        )
        assert r.passed is False


class TestReleaseOutput:
    def test_json_roundtrip(self) -> None:
        o = ReleaseOutput(version="1.0.0", tag="v1.0.0", release_notes="- note")
        d = o.model_dump()
        assert d == {"version": "1.0.0", "tag": "v1.0.0", "release_notes": "- note"}


class TestSyncOutput:
    def test_json_roundtrip(self) -> None:
        o = SyncOutput(version="1.0.0", updated=["plugin.json"])
        assert o.model_dump() == {"version": "1.0.0", "updated": ["plugin.json"]}
