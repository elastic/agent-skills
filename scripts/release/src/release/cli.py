"""CLI entry point for the release tool.

Three modes:
  - Extract (default): outputs JSON with version, tag, and release_notes.
  - Validate (--validate): checks everything is consistent and outputs a
    markdown summary suitable for a GitHub Actions job summary.
  - Sync (--sync): reads version from the manifest and updates version-stamped
    files (plugin.json, marketplace.json) to match.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from release.core import (
    check_tag,
    extract_changelog_entry,
    read_version,
    update_json_version,
    update_marketplace_version,
)


def _status(ok: bool) -> str:
    return "pass" if ok else "FAIL"


def run_validate(
    version: str,
    tag: str,
    release_notes: str,
    tag_error: str | None,
    initial_version_error: str | None,
    version_file_errors: list[tuple[str, str]] | None = None,
) -> int:
    """Print a markdown validation summary and return the exit code."""
    checks: list[tuple[str, bool, str]] = [
        ("Manifest version", True, version),
        ("Semver format", True, "valid"),
        (
            f"Tag `{tag}`",
            tag_error is None,
            "does not exist yet" if tag_error is None else tag_error,
        ),
        (
            "Initial version",
            initial_version_error is None,
            "matches" if initial_version_error is None else initial_version_error,
        ),
        ("Changelog entry", True, f"{len(release_notes.splitlines())} lines"),
    ]

    for filename, error in version_file_errors or []:
        checks.append((f"Version sync ({filename})", False, error))

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


def run_sync(
    version: str,
    plugin_json: Path | None,
    marketplace_json: Path | None,
) -> int:
    """Sync version from the manifest into target files.

    Prints a JSON summary of what was updated and returns 0.
    """
    updated: list[str] = []

    if plugin_json is not None and plugin_json.is_file():
        if update_json_version(plugin_json, version):
            updated.append(str(plugin_json))

    if marketplace_json is not None and marketplace_json.is_file():
        if update_marketplace_version(marketplace_json, version):
            updated.append(str(marketplace_json))

    json.dump({"version": version, "updated": updated}, sys.stdout, indent=2)
    print()
    return 0


def _check_version_files(
    version: str,
    plugin_json: Path | None,
    marketplace_json: Path | None,
) -> list[tuple[str, str]]:
    """Return a list of ``(filename, error_message)`` for files whose version
    does not match the manifest.
    """
    errors: list[tuple[str, str]] = []

    if plugin_json is not None and plugin_json.is_file():
        try:
            pj_version = read_version(plugin_json)
        except SystemExit:
            pj_version = None
        if pj_version != version:
            errors.append(
                (str(plugin_json), f"expected {version}, got {pj_version}")
            )

    if marketplace_json is not None and marketplace_json.is_file():
        try:
            data = json.loads(marketplace_json.read_text())
            mj_version = data["plugins"][0]["version"]
        except (json.JSONDecodeError, KeyError, IndexError):
            mj_version = None
        if mj_version != version:
            errors.append(
                (str(marketplace_json), f"expected {version}, got {mj_version}")
            )

    return errors


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Extract and validate release metadata from .release-manifest.json and CHANGELOG.md.",
    )
    p.add_argument(
        "--manifest",
        type=Path,
        default=Path(".github/.release-manifest.json"),
        help="Path to .release-manifest.json (default: .github/.release-manifest.json)",
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
        "--sync",
        action="store_true",
        help="Run in sync mode: update version-stamped files to match the manifest",
    )
    p.add_argument(
        "--plugin-json",
        type=Path,
        default=None,
        help="Path to plugin.json (sync: update target; validate: check consistency)",
    )
    p.add_argument(
        "--marketplace-json",
        type=Path,
        default=None,
        help="Path to marketplace.json (sync: update target; validate: check consistency)",
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


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    version = read_version(args.manifest)
    tag = f"v{version}"

    if args.sync:
        raise SystemExit(run_sync(version, args.plugin_json, args.marketplace_json))

    release_notes = extract_changelog_entry(args.changelog, version)

    if args.validate:
        tag_error = None
        iv_error = None
        if args.existing_tags_file:
            tag_error, iv_error = check_tag(
                args.existing_tags_file,
                tag,
                args.initial_version,
            )
        version_file_errors = _check_version_files(
            version, args.plugin_json, args.marketplace_json,
        )
        raise SystemExit(
            run_validate(
                version, tag, release_notes, tag_error, iv_error, version_file_errors,
            )
        )

    raise SystemExit(run_extract(version, tag, release_notes))
