"""Pure logic for extracting and validating release metadata."""

from __future__ import annotations

import json
import re
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CHANGELOG_HEADING_RE = re.compile(
    r"^## v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", re.MULTILINE
)


def read_version(plugin_json: Path) -> str:
    """Read and validate the semver version string from *plugin_json*."""
    if not plugin_json.is_file():
        raise SystemExit(f"error: {plugin_json} does not exist")

    try:
        data = json.loads(plugin_json.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"error: {plugin_json} is not valid JSON: {exc}") from exc

    version = data.get("version")
    if not version:
        raise SystemExit(f"error: {plugin_json} has no 'version' field")

    if not SEMVER_RE.match(version):
        raise SystemExit(
            f"error: version '{version}' in {plugin_json} is not valid semver"
            " (expected MAJOR.MINOR.PATCH)"
        )

    return version


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
