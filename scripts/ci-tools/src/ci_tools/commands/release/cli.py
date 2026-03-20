"""Typer sub-app for release commands.

Commands:
  extract   — emit JSON with version, tag, release_notes
  validate  — emit Markdown summary; exits 1 on any failure
  sync      — update version-stamped files and emit JSON summary
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

from ci_tools.commands.release.core import (
    FileTagsProvider,
    check_tags,
    check_version_files,
    extract_changelog_entry,
    read_manifest,
    update_marketplace_version,
    update_plugin_version,
)
from ci_tools.commands.release.models import (
    ReleaseOutput,
    SyncOutput,
    TagCheckResult,
    ValidationResult,
)

release_app = typer.Typer(
    name="release",
    help="Release management commands.",
    no_args_is_help=True,
)

_DEFAULT_MANIFEST = Path(".github/.release-manifest.json")
_DEFAULT_CHANGELOG = Path("CHANGELOG.md")


def _die(message: str) -> None:
    """Print an error to stderr and exit 1."""
    typer.echo(f"Error: {message}", err=True)
    raise typer.Exit(1)


@release_app.command("extract")
def extract(
    manifest: Path = typer.Option(
        _DEFAULT_MANIFEST,
        "--manifest",
        help="Path to .release-manifest.json",
        show_default=True,
    ),
    changelog: Path = typer.Option(
        _DEFAULT_CHANGELOG,
        "--changelog",
        help="Path to CHANGELOG.md",
        show_default=True,
    ),
    tag_prefix: str = typer.Option(
        "v",
        "--tag-prefix",
        help="Prefix prepended to the version to form the git tag (e.g. 'v', 'release/', '').",
        show_default=True,
    ),
) -> None:
    """Emit JSON with version, tag, and release_notes."""
    try:
        m = read_manifest(manifest)
        notes = extract_changelog_entry(changelog, m.version)
    except ValueError as exc:
        _die(str(exc))
        return  # unreachable — satisfies type checker

    output = ReleaseOutput(version=m.version, tag=f"{tag_prefix}{m.version}", release_notes=notes)
    typer.echo(output.model_dump_json(indent=2))


@release_app.command("validate")
def validate(
    manifest: Path = typer.Option(
        _DEFAULT_MANIFEST,
        "--manifest",
        help="Path to .release-manifest.json",
        show_default=True,
    ),
    changelog: Path = typer.Option(
        _DEFAULT_CHANGELOG,
        "--changelog",
        help="Path to CHANGELOG.md",
        show_default=True,
    ),
    plugin_json: Optional[list[Path]] = typer.Option(
        None,
        "--plugin-json",
        help="Path to plugin.json (version consistency check). Repeatable.",
    ),
    marketplace_json: Optional[Path] = typer.Option(
        None,
        "--marketplace-json",
        help="Path to marketplace.json (version consistency check)",
    ),
    tags_file: Optional[Path] = typer.Option(
        None,
        "--tags-file",
        help="File with one existing git tag per line",
    ),
    initial_version: Optional[str] = typer.Option(
        None,
        "--initial-version",
        help="Expected version for the very first release (e.g. 1.0.0)",
    ),
    tag_prefix: str = typer.Option(
        "v",
        "--tag-prefix",
        help="Prefix prepended to the version to form the git tag (e.g. 'v', 'release/', '').",
        show_default=True,
    ),
) -> None:
    """Validate all release artifacts and emit a Markdown summary.

    Exits 1 if any check fails — suitable for piping into $GITHUB_STEP_SUMMARY.
    """
    try:
        m = read_manifest(manifest)
        notes = extract_changelog_entry(changelog, m.version)
    except ValueError as exc:
        _die(str(exc))
        return

    tag = f"{tag_prefix}{m.version}"

    tag_check = TagCheckResult()
    if tags_file is not None:
        tag_check = check_tags(FileTagsProvider(tags_file), tag, initial_version)

    version_files: list[Path] = list(plugin_json or [])
    if marketplace_json is not None:
        version_files.append(marketplace_json)
    file_errors = check_version_files(m.version, version_files)

    result = ValidationResult(
        version=m.version,
        tag=tag,
        release_notes=notes,
        tag_check=tag_check,
        file_errors=file_errors,
    )

    _print_validation_summary(result)

    if not result.passed:
        raise typer.Exit(1)


def _print_validation_summary(result: ValidationResult) -> None:
    """Print the Markdown validation table + release notes preview to stdout."""

    def _s(ok: bool) -> str:
        return "pass" if ok else "FAIL"

    status = "passed" if result.passed else "FAILED"

    checks = [
        ("Manifest version", True, result.version),
        ("Semver format", True, "valid"),
        (
            f"Tag `{result.tag}`",
            result.tag_check.tag_error is None,
            "does not exist yet"
            if result.tag_check.tag_error is None
            else result.tag_check.tag_error,
        ),
        (
            "Initial version",
            result.tag_check.initial_version_error is None,
            "matches"
            if result.tag_check.initial_version_error is None
            else result.tag_check.initial_version_error,
        ),
        (
            "Changelog entry",
            True,
            f"{len(result.release_notes.splitlines())} lines",
        ),
    ]
    for err in result.file_errors:
        checks.append((f"Version sync ({err.filename})", False, err.message))

    lines = [
        f"## Release Validation — {status}",
        "",
        "| Check | Status | Detail |",
        "|-------|--------|--------|",
    ]
    for name, ok, detail in checks:
        lines.append(f"| {name} | {_s(ok)} | {detail} |")

    lines += ["", "### Release Notes Preview", ""]
    for line in result.release_notes.splitlines():
        lines.append(f"> {line}" if line else ">")

    typer.echo("\n".join(lines))


@release_app.command("sync")
def sync(
    manifest: Path = typer.Option(
        _DEFAULT_MANIFEST,
        "--manifest",
        help="Path to .release-manifest.json",
        show_default=True,
    ),
    plugin_json: Optional[list[Path]] = typer.Option(
        None,
        "--plugin-json",
        help="Path to plugin.json to update. Repeatable.",
    ),
    marketplace_json: Optional[Path] = typer.Option(
        None,
        "--marketplace-json",
        help="Path to marketplace.json to update",
    ),
) -> None:
    """Sync version from the manifest into plugin.json and/or marketplace.json."""
    try:
        m = read_manifest(manifest)
    except ValueError as exc:
        _die(str(exc))
        return

    updated: list[str] = []

    for path in plugin_json or []:
        if path.is_file():
            try:
                if update_plugin_version(path, m.version):
                    updated.append(str(path))
            except ValueError as exc:
                logger.warning("Skipping {}: {}", path, exc)

    if marketplace_json is not None and marketplace_json.is_file():
        try:
            if update_marketplace_version(marketplace_json, m.version):
                updated.append(str(marketplace_json))
        except ValueError as exc:
            logger.warning("Skipping {}: {}", marketplace_json, exc)

    output = SyncOutput(version=m.version, updated=updated)
    typer.echo(output.model_dump_json(indent=2))
