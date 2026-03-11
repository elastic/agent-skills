"""CLI entry point for the release tool.

Two modes:
  - Extract (default): outputs JSON with version, tag, and release_notes.
  - Validate (--validate): checks everything is consistent and outputs a
    markdown summary suitable for a GitHub Actions job summary.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from release.core import check_tag, extract_changelog_entry, read_version


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


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Extract release metadata from plugin.json and CHANGELOG.md."
    )
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


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    version = read_version(args.plugin_json)
    tag = f"v{version}"
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
        raise SystemExit(run_validate(version, tag, release_notes, tag_error, iv_error))

    raise SystemExit(run_extract(version, tag, release_notes))
