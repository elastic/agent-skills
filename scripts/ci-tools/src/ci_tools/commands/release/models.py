"""Pydantic domain models for release commands."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ReleaseManifest(BaseModel):
    """The .release-manifest.json file."""

    version: str = Field(pattern=r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class PluginManifest(BaseModel):
    """plugin.json — extra fields are preserved on write."""

    model_config = ConfigDict(extra="allow")

    version: str


class MarketplaceManifest(BaseModel):
    """marketplace.json — extra fields are preserved on write."""

    model_config = ConfigDict(extra="allow")

    plugins: list[PluginManifest] = Field(min_length=1)


class TagCheckResult(BaseModel):
    """Result of checking a release tag against existing tags."""

    tag_error: str | None = None
    initial_version_error: str | None = None


class VersionFileError(BaseModel):
    """A single version-consistency failure for a tracked file."""

    filename: str
    message: str


class ValidationResult(BaseModel):
    """Aggregated result of a full release validation run."""

    version: str
    tag: str
    release_notes: str
    tag_check: TagCheckResult
    file_errors: list[VersionFileError] = []

    @property
    def passed(self) -> bool:
        return (
            self.tag_check.tag_error is None
            and self.tag_check.initial_version_error is None
            and not self.file_errors
        )


class ReleaseOutput(BaseModel):
    """JSON output of the `release extract` command."""

    version: str
    tag: str
    release_notes: str


class SyncOutput(BaseModel):
    """JSON output of the `release sync` command."""

    version: str
    updated: list[str]
