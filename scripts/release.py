# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Extract release metadata from plugin.json and CHANGELOG.md.

Two modes:
  - Extract (default): outputs JSON with version, tag, and release_notes.
  - Validate (--validate): checks everything is consistent and outputs a
    markdown summary suitable for a GitHub Actions job summary.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CHANGELOG_HEADING_RE = re.compile(
    r"^## v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", re.MULTILINE
)


def read_version(plugin_json: Path) -> str:
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
            f"error: version '{version}' in {plugin_json} is not valid semver (expected MAJOR.MINOR.PATCH)"
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

    existing = {line.strip() for line in tags_file.read_text().splitlines() if line.strip()}

    tag_error = None
    if tag in existing:
        tag_error = f"tag {tag} already exists"

    iv_error = None
    if initial_version and not existing:
        expected = f"v{initial_version}" if not initial_version.startswith("v") else initial_version
        if tag != expected:
            iv_error = f"expected {expected} for first release, got {tag}"

    return tag_error, iv_error


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

def _status(ok: bool) -> str:
    return "pass" if ok else "FAIL"


def run_validate(
    version: str,
    tag: str,
    release_notes: str,
    tag_error: str | None,
    initial_version_error: str | None,
) -> int:
    """Print a markdown validation summary and return the exit code."""
    checks: list[tuple[str, bool, str]] = [
        ("plugin.json version", True, version),
        ("Semver format", True, "valid"),
        (f"Tag `{tag}`", tag_error is None, "does not exist yet" if tag_error is None else tag_error),
        ("Initial version", initial_version_error is None,
         "matches" if initial_version_error is None else initial_version_error),
        ("Changelog entry", True, f"{len(release_notes.splitlines())} lines"),
    ]

    all_ok = all(ok for _, ok, _ in checks)

    lines = [
        f"## Release Validation — {'passed' if all_ok else 'FAILED'}",
        "",
        "| Check | Status | Detail |",
        "|-------|--------|--------|",
    ]
    for name, ok, detail in checks:
        lines.append(f"| {name} | {_status(ok)} | {detail} |")

    lines += [
        "",
        "### Release Notes Preview",
        "",
    ]
    for note_line in release_notes.splitlines():
        lines.append(f"> {note_line}" if note_line else ">")

    print("\n".join(lines))

    return 0 if all_ok else 1


def run_extract(version: str, tag: str, release_notes: str) -> int:
    """Print JSON release metadata to stdout."""
    payload = {
        "version": version,
        "tag": tag,
        "release_notes": release_notes,
    }
    json.dump(payload, sys.stdout, indent=2)
    print()
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--plugin-json",
        type=Path,
        default=Path(".claude-plugin/plugin.json"),
        help="Path to plugin.json (default: .claude-plugin/plugin.json)",
    )
    p.add_argument(
        "--changelog",
        type=Path,
        default=Path("CHANGELOG.md"),
        help="Path to CHANGELOG.md (default: CHANGELOG.md)",
    )
    p.add_argument(
        "--validate",
        action="store_true",
        help="Run in validation mode: output markdown summary instead of JSON",
    )
    p.add_argument(
        "--existing-tags-file",
        type=Path,
        default=None,
        help="File containing one existing git tag per line (validate mode only)",
    )
    p.add_argument(
        "--initial-version",
        default=None,
        help="Expected version for the first release when no tags exist (e.g. 1.0.0)",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    version = read_version(args.plugin_json)
    tag = f"v{version}"
    release_notes = extract_changelog_entry(args.changelog, version)

    if args.validate:
        tag_error = None
        iv_error = None
        if args.existing_tags_file:
            tag_error, iv_error = check_tag(
                args.existing_tags_file, tag, args.initial_version,
            )
        return run_validate(version, tag, release_notes, tag_error, iv_error)

    return run_extract(version, tag, release_notes)


if __name__ == "__main__":
    raise SystemExit(main())
