from __future__ import annotations

import pytest
from pydantic import ValidationError

from ci_tools.commands.sync.models import (
    CopyMapping,
    SyncConfig,
    SyncDefaults,
    SyncTarget,
    VersionUpdate,
)


class TestCopyMapping:
    def test_defaults(self) -> None:
        m = CopyMapping(source="a", dest="b")
        assert m.exclude == []

    def test_with_exclude(self) -> None:
        m = CopyMapping(source="a", dest="b", exclude=["*.md"])
        assert m.exclude == ["*.md"]


class TestVersionUpdate:
    def test_basic(self) -> None:
        v = VersionUpdate(file="package.json", field="version")
        assert v.file == "package.json"


class TestSyncDefaults:
    def test_defaults(self) -> None:
        d = SyncDefaults()
        assert "automated/skill-sync" in d.branch
        assert "{version}" in d.commit_message


class TestSyncTarget:
    def test_minimal(self) -> None:
        t = SyncTarget(
            name="test",
            repo="org/repo",
            copies=[CopyMapping(source="a", dest="b")],
        )
        assert t.branch is None
        assert t.versions == []

    def test_with_overrides(self) -> None:
        t = SyncTarget(
            name="test",
            repo="org/repo",
            branch="custom",
            copies=[CopyMapping(source="a", dest="b")],
        )
        assert t.branch == "custom"


class TestSyncConfig:
    def test_valid(self) -> None:
        cfg = SyncConfig(
            target=[
                SyncTarget(
                    name="test",
                    repo="org/repo",
                    copies=[CopyMapping(source="a", dest="b")],
                )
            ]
        )
        assert len(cfg.target) == 1

    def test_empty_targets_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncConfig(target=[])

    def test_defaults_applied(self) -> None:
        cfg = SyncConfig(
            target=[
                SyncTarget(
                    name="test",
                    repo="org/repo",
                    copies=[CopyMapping(source="a", dest="b")],
                )
            ]
        )
        assert cfg.defaults.branch == "automated/skill-sync"
