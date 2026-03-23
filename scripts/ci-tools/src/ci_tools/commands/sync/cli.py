from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from ci_tools.commands.release.core import read_manifest
from ci_tools.commands.sync.core import apply_sync, load_sync_config
from ci_tools.commands.sync.models import SyncListOutput

sync_app = typer.Typer(
    name="sync",
    help="Sync skills to target repositories.",
    no_args_is_help=True,
)

_DEFAULT_CONFIG = Path(".github/ci-tools.toml")
_DEFAULT_MANIFEST = Path(".github/.release-manifest.json")


def _die(message: str) -> None:
    typer.echo(f"Error: {message}", err=True)
    raise typer.Exit(1)


@sync_app.command("apply")
def apply(
    config: Path = typer.Option(
        _DEFAULT_CONFIG,
        "--config",
        help="Path to ci-tools.toml",
        show_default=True,
    ),
    source_root: Path = typer.Option(
        Path("."),
        "--source-root",
        help="Source repo root",
        show_default=True,
    ),
    target_root: Path = typer.Option(
        ...,
        "--target-root",
        help="Target repo checkout path",
    ),
    target: str = typer.Option(
        ...,
        "--target",
        help="Target name from config",
    ),
    version: Optional[str] = typer.Option(
        None,
        "--version",
        help="Version to stamp (default: from .release-manifest.json)",
    ),
    manifest: Path = typer.Option(
        _DEFAULT_MANIFEST,
        "--manifest",
        help="Path to .release-manifest.json (used when --version is omitted)",
        show_default=True,
    ),
    source_repo: str = typer.Option(
        "",
        "--source-repo",
        help="Source repo name for templates",
        show_default=True,
    ),
) -> None:
    """Copy files and stamp versions in a target repository."""
    try:
        if version is None:
            version = read_manifest(manifest).version
        cfg = load_sync_config(config)
        output = apply_sync(
            source_root=source_root,
            target_root=target_root,
            config=cfg,
            target_name=target,
            version=version,
            source_repo=source_repo,
        )
    except ValueError as exc:
        _die(str(exc))
        return

    typer.echo(output.model_dump_json(indent=2))


@sync_app.command("list")
def list_targets(
    config: Path = typer.Option(
        _DEFAULT_CONFIG,
        "--config",
        help="Path to ci-tools.toml",
        show_default=True,
    ),
) -> None:
    """List enabled sync targets from config."""
    try:
        cfg = load_sync_config(config)
    except ValueError as exc:
        _die(str(exc))
        return

    output = SyncListOutput(targets=[t.name for t in cfg.target])
    typer.echo(output.model_dump_json(indent=2))
