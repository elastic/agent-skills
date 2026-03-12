"""Pure logic for extracting and validating release metadata."""

from __future__ import annotations

import json
import re
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CHANGELOG_HEADING_RE = re.compile(
    r"^## v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", re.MULTILINE
)


def read_version(version_file: Path) -> str:
    """Read and validate the semver version string from a JSON file.

    The file must contain a top-level ``"version"`` field with a valid
    semver string (MAJOR.MINOR.PATCH).  Works with any JSON file that
    follows this convention — ``plugin.json``, ``.release-manifest.json``,
    etc.
    """
    if not version_file.is_file():
        raise SystemExit(f"error: {version_file} does not exist")

    try:
        data = json.loads(version_file.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"error: {version_file} is not valid JSON: {exc}") from exc

    version = data.get("version")
    if not version:
        raise SystemExit(f"error: {version_file} has no 'version' field")

    if not SEMVER_RE.match(version):
        raise SystemExit(
            f"error: version '{version}' in {version_file} is not valid semver"
            " (expected MAJOR.MINOR.PATCH)"
        )

    return version


def update_json_version(path: Path, version: str) -> bool:
    """Set the top-level ``"version"`` field in a JSON file.

    Returns ``True`` if the file was modified, ``False`` if it already
    contained the target version.
    """
    if not path.is_file():
        raise SystemExit(f"error: {path} does not exist")

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"error: {path} is not valid JSON: {exc}") from exc

    if data.get("version") == version:
        return False

    data["version"] = version
    path.write_text(json.dumps(data, indent=2) + "\n")
    return True


def update_marketplace_version(path: Path, version: str) -> bool:
    """Set ``plugins[0].version`` in a marketplace manifest.

    Returns ``True`` if the file was modified, ``False`` if it already
    contained the target version.
    """
    if not path.is_file():
        raise SystemExit(f"error: {path} does not exist")

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"error: {path} is not valid JSON: {exc}") from exc

    plugins = data.get("plugins")
    if not isinstance(plugins, list) or len(plugins) == 0:
        raise SystemExit(f"error: {path} has no 'plugins' array or it is empty")

    if plugins[0].get("version") == version:
        return False

    plugins[0]["version"] = version
    path.write_text(json.dumps(data, indent=2) + "\n")
    return True


def extract_changelog_entry(changelog: Path, version: str) -> str:
    """Return the content under the ``## v{version}`` heading."""
    if not changelog.is_file():
        raise SystemExit(f"error: {changelog} does not exist")

    lines = changelog.read_text().splitlines(keepends=True)

    heading_re = re.compile(rf"^## v?{re.escape(version)}\b")
    start_idx = None
    for i, line in enumerate(lines):
        if heading_re.match(line):
            start_idx = i + 1
            break

    if start_idx is None:
        raise SystemExit(f"error: {changelog} has no entry for version {version}")

    end_idx = len(lines)
    for i in range(start_idx, len(lines)):
        if CHANGELOG_HEADING_RE.match(lines[i]):
            end_idx = i
            break

    body = "".join(lines[start_idx:end_idx]).strip()
    if not body:
        raise SystemExit(
            f"error: changelog entry for {version} in {changelog} is empty"
        )

    return body


def check_tag(
    tags_file: Path,
    tag: str,
    initial_version: str | None,
) -> tuple[str | None, str | None]:
    """Validate *tag* against existing tags.

    Returns ``(tag_error, initial_version_error)`` — each is ``None`` when
    the check passes or a human-readable message when it fails.
    """
    if not tags_file.is_file():
        return None, None

    existing = {
        line.strip()
        for line in tags_file.read_text().splitlines()
        if line.strip()
    }

    tag_error = None
    if tag in existing:
        tag_error = f"tag {tag} already exists"

    iv_error = None
    if initial_version and not existing:
        expected = (
            f"v{initial_version}"
            if not initial_version.startswith("v")
            else initial_version
        )
        if tag != expected:
            iv_error = f"expected {expected} for first release, got {tag}"

    return tag_error, iv_error
