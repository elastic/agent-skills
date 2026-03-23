"""Pure logic for release commands. No Typer imports. Raises ValueError on bad input."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Protocol

from loguru import logger
from pydantic import ValidationError

from ci_tools.commands.release.models import (
    MarketplaceManifest,
    MarketplacePluginEntry,
    PluginManifest,
    ReleaseManifest,
    TagCheckResult,
    VersionFileError,
)

CHANGELOG_HEADING_RE = re.compile(
    r"^## v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", re.MULTILINE
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load_json(path: Path) -> dict:
    """Load and parse a JSON file, raising ValueError on any problem."""
    if not path.is_file():
        raise ValueError(f"{path} does not exist")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path} contains invalid JSON: {exc}") from exc


# ---------------------------------------------------------------------------
# Manifest readers
# ---------------------------------------------------------------------------


def read_manifest(path: Path) -> ReleaseManifest:
    """Read and validate the release manifest JSON."""
    logger.debug("Reading release manifest: {}", path)
    data = _load_json(path)
    try:
        return ReleaseManifest.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"{path}: invalid manifest — {exc}") from exc


def read_plugin_manifest(path: Path) -> PluginManifest:
    """Read plugin.json, preserving all extra fields."""
    logger.debug("Reading plugin manifest: {}", path)
    data = _load_json(path)
    try:
        return PluginManifest.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"{path}: invalid plugin manifest — {exc}") from exc


def read_marketplace_manifest(path: Path) -> MarketplaceManifest:
    """Read marketplace.json, preserving all extra fields."""
    logger.debug("Reading marketplace manifest: {}", path)
    data = _load_json(path)
    try:
        return MarketplaceManifest.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"{path}: invalid marketplace manifest — {exc}") from exc


# ---------------------------------------------------------------------------
# Manifest writers
# ---------------------------------------------------------------------------


def update_plugin_version(path: Path, version: str) -> bool:
    """Set the version field in plugin.json. Returns True if the file was modified."""
    manifest = read_plugin_manifest(path)
    if manifest.version == version:
        logger.debug("{} already at version {}", path, version)
        return False
    manifest.version = version
    path.write_text(json.dumps(manifest.model_dump(), indent=2, ensure_ascii=False) + "\n")
    logger.info("Updated {} → {}", path, version)
    return True


def update_marketplace_version(path: Path, version: str) -> bool:
    """Set version on all plugin entries in marketplace.json. Returns True if modified."""
    manifest = read_marketplace_manifest(path)
    changed = False
    for entry in manifest.plugins:
        if entry.version != version:
            entry.version = version
            changed = True
    if not changed:
        logger.debug("{} already at version {}", path, version)
        return False
    path.write_text(json.dumps(manifest.model_dump(), indent=2, ensure_ascii=False) + "\n")
    logger.info("Updated {} → {}", path, version)
    return True


# ---------------------------------------------------------------------------
# Changelog
# ---------------------------------------------------------------------------


def extract_changelog_entry(changelog: Path, version: str) -> str:
    """Return the body under the ## v{version} heading in CHANGELOG.md."""
    logger.debug("Extracting changelog entry for {}", version)
    if not changelog.is_file():
        raise ValueError(f"{changelog} does not exist")

    heading_re = re.compile(rf"^## v?{re.escape(version)}\b", re.MULTILINE)
    lines = changelog.read_text().splitlines(keepends=True)

    start_idx: int | None = None
    for i, line in enumerate(lines):
        if heading_re.match(line):
            start_idx = i + 1
            break

    if start_idx is None:
        raise ValueError(f"{changelog}: no entry for version {version}")

    end_idx = len(lines)
    for i in range(start_idx, len(lines)):
        if CHANGELOG_HEADING_RE.match(lines[i]):
            end_idx = i
            break

    body = "".join(lines[start_idx:end_idx]).strip()
    if not body:
        raise ValueError(f"{changelog}: changelog entry for {version} is empty")

    return body


# ---------------------------------------------------------------------------
# Tags provider — dependency injection seam
# ---------------------------------------------------------------------------


class TagsProvider(Protocol):
    """Anything that can return the set of existing git tags.

    Concrete implementations: FileTagsProvider (production), stub/mock (tests).
    Future: GitHubTagsProvider that calls the GitHub API directly.
    """

    def get_tags(self) -> set[str]: ...


class FileTagsProvider:
    """Reads tags from a plain-text file (one tag per line)."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def get_tags(self) -> set[str]:
        if not self.path.is_file():
            return set()
        return {
            line.strip()
            for line in self.path.read_text().splitlines()
            if line.strip()
        }


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def check_tags(
    provider: TagsProvider,
    tag: str,
    initial_version: str | None,
) -> TagCheckResult:
    """Check *tag* against the provider's existing tags.

    Returns a TagCheckResult; fields are None when the check passes.
    """
    existing = provider.get_tags()

    tag_error: str | None = None
    if tag in existing:
        tag_error = f"tag {tag} already exists"

    iv_error: str | None = None
    if initial_version and not existing:
        expected = (
            f"v{initial_version}"
            if not initial_version.startswith("v")
            else initial_version
        )
        if tag != expected:
            iv_error = f"expected {expected} for first release, got {tag}"

    return TagCheckResult(tag_error=tag_error, initial_version_error=iv_error)


def check_version_files(
    version: str,
    paths: list[Path],
) -> list[VersionFileError]:
    """Return errors for each tracked file whose version doesn't match *version*.

    Files that don't exist are silently skipped (no error).
    For marketplace files, all plugin entries are checked.
    """
    errors: list[VersionFileError] = []
    for path in paths:
        if not path.is_file():
            logger.debug("Skipping missing version file: {}", path)
            continue
        try:
            # Try plugin manifest first (single version field), then marketplace
            try:
                manifest = read_plugin_manifest(path)
                if manifest.version != version:
                    errors.append(
                        VersionFileError(
                            filename=str(path),
                            message=f"expected {version}, got {manifest.version}",
                        )
                    )
            except ValueError:
                mmanifest = read_marketplace_manifest(path)
                for i, entry in enumerate(mmanifest.plugins):
                    actual = entry.version
                    if actual != version:
                        name = entry.model_dump().get("name", f"plugins[{i}]")
                        errors.append(
                            VersionFileError(
                                filename=str(path),
                                message=f"{name}: expected {version}, got {actual}",
                            )
                        )
        except Exception:
            errors.append(
                VersionFileError(
                    filename=str(path),
                    message=f"could not read version from {path}",
                )
            )

    return errors
