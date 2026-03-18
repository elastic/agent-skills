from __future__ import annotations

from typer.testing import CliRunner

from ci_tools.cli import app

runner = CliRunner()


class TestTopLevelCLI:
    def test_help_exits_zero(self) -> None:
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0
        assert "Usage" in result.stdout

    def test_release_group_exists(self) -> None:
        result = runner.invoke(app, ["release", "--help"])
        assert result.exit_code == 0
        assert "extract" in result.stdout
        assert "validate" in result.stdout
        assert "sync" in result.stdout

    def test_verbose_flag_accepted(self) -> None:
        result = runner.invoke(app, ["--verbose", "--help"])
        assert result.exit_code == 0

    def test_github_group_exists(self) -> None:
        result = runner.invoke(app, ["github", "--help"])
        assert result.exit_code == 0
        assert "setup-labels" in result.stdout

    def test_no_args_shows_help(self) -> None:
        # no_args_is_help=True — shows help content (Typer 0.24 exits 2 in this case)
        result = runner.invoke(app, [])
        assert "Usage" in result.output
        assert "release" in result.output
        assert "github" in result.output
