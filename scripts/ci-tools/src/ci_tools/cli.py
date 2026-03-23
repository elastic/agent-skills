"""Top-level ci-tools Typer application.

Registers all command groups here. Adding a new domain is one line:
    app.add_typer(new_app, name="domain-name")
"""
from __future__ import annotations

import sys

import typer
from loguru import logger

from ci_tools.commands.github.cli import github_app
from ci_tools.commands.release.cli import release_app
from ci_tools.commands.sync.cli import sync_app

app = typer.Typer(
    name="ci-tools",
    help="CI tooling for this repository.",
    no_args_is_help=True,
)

app.add_typer(release_app, name="release")
app.add_typer(github_app, name="github")
app.add_typer(sync_app, name="sync")


@app.callback()
def main(
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """ci-tools — extensible CI utilities."""
    logger.remove()
    level = "DEBUG" if verbose else "WARNING"
    logger.add(sys.stderr, level=level, format="<level>{level}</level>: {message}")
