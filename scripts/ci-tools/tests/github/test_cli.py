"""Tests for ci-tools github commands."""
from __future__ import annotations

import subprocess
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from ci_tools.commands.github.cli import github_app

runner = CliRunner()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _completed(returncode: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    """Build a fake CompletedProcess."""
    result: subprocess.CompletedProcess[str] = MagicMock(spec=subprocess.CompletedProcess)
    result.returncode = returncode
    result.stdout = stdout
    result.stderr = stderr
    return result


# Typer collapses a single-command app so that it acts as the command itself.
# Invoke github_app directly without the "setup-labels" sub-command name.
def _invoke(*args: str):
    return runner.invoke(github_app, list(args))


# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

class TestSetupLabelsHelp:
    def test_help_exits_zero(self) -> None:
        result = _invoke("--help")
        assert result.exit_code == 0
        assert "--repo" in result.stdout


# ---------------------------------------------------------------------------
# Repo detection
# ---------------------------------------------------------------------------

class TestSetupLabelsRepoDetection:
    def test_explicit_repo_skips_detection(self) -> None:
        """--repo bypasses gh repo view."""
        side_effects = [
            _completed(returncode=1),   # label view: pending → not found
            _completed(returncode=0),   # label create: pending
            _completed(returncode=1),   # label view: tagged  → not found
            _completed(returncode=0),   # label create: tagged
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects) as mock_run:
            result = _invoke("--repo", "owner/repo")

        assert result.exit_code == 0
        # gh repo view must NOT have been called
        calls_flat = [str(c.args[0]) for c in mock_run.call_args_list if c.args]
        assert not any("view" in c and "nameWithOwner" in c for c in calls_flat)

    def test_auto_detects_repo_when_no_flag(self) -> None:
        side_effects = [
            _completed(returncode=0, stdout="owner/repo\n"),   # gh repo view
            _completed(returncode=0),                           # label view: pending → found
            _completed(returncode=0),                           # label edit: pending
            _completed(returncode=0),                           # label view: tagged  → found
            _completed(returncode=0),                           # label edit: tagged
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects):
            result = _invoke()

        assert result.exit_code == 0
        assert "owner/repo" in result.output

    def test_exits_1_when_repo_detection_fails(self) -> None:
        with patch(
            "ci_tools.commands.github.cli.subprocess.run",
            return_value=_completed(returncode=1, stderr="not a git repo"),
        ):
            result = _invoke()

        assert result.exit_code == 1
        assert "Error" in result.output


# ---------------------------------------------------------------------------
# Create vs update logic
# ---------------------------------------------------------------------------

class TestSetupLabelsCreateOrUpdate:
    def test_creates_labels_that_do_not_exist(self) -> None:
        side_effects = [
            _completed(returncode=1),   # label view: pending → not found
            _completed(returncode=0),   # label create: pending
            _completed(returncode=1),   # label view: tagged  → not found
            _completed(returncode=0),   # label create: tagged
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects) as mock_run:
            result = _invoke("--repo", "owner/repo")

        assert result.exit_code == 0
        assert "Creating label 'autorelease: pending'" in result.output
        assert "Creating label 'autorelease: tagged'" in result.output

        create_calls = [c for c in mock_run.call_args_list if c.args and "create" in c.args[0]]
        assert len(create_calls) == 2

    def test_updates_labels_that_already_exist(self) -> None:
        side_effects = [
            _completed(returncode=0),   # label view: pending → found
            _completed(returncode=0),   # label edit: pending
            _completed(returncode=0),   # label view: tagged  → found
            _completed(returncode=0),   # label edit: tagged
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects) as mock_run:
            result = _invoke("--repo", "owner/repo")

        assert result.exit_code == 0
        assert "already exists — updating" in result.output

        edit_calls = [c for c in mock_run.call_args_list if c.args and "edit" in c.args[0]]
        assert len(edit_calls) == 2

    def test_passes_correct_colors_and_descriptions(self) -> None:
        side_effects = [
            _completed(returncode=1), _completed(returncode=0),   # pending: create
            _completed(returncode=1), _completed(returncode=0),   # tagged:  create
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects) as mock_run:
            _invoke("--repo", "owner/repo")

        create_calls = [c.args[0] for c in mock_run.call_args_list if c.args and "create" in c.args[0]]
        # c.args[0] is a list of strings; use any() for substring matching
        pending_cmd = next(c for c in create_calls if any("pending" in s for s in c))
        tagged_cmd  = next(c for c in create_calls if any("tagged"  in s for s in c))

        assert any("FBCA04" in s for s in pending_cmd)
        assert any("Release PR awaiting merge" in s for s in pending_cmd)
        assert any("0E8A16" in s for s in tagged_cmd)
        assert any("Release PR has been tagged and published" in s for s in tagged_cmd)

    def test_exits_1_on_gh_failure(self) -> None:
        side_effects = [
            _completed(returncode=1),                              # label view → not found
            _completed(returncode=1, stderr="network error"),      # create fails
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects):
            result = _invoke("--repo", "owner/repo")

        assert result.exit_code == 1
        assert "Error" in result.output

    def test_prints_done_on_success(self) -> None:
        side_effects = [
            _completed(returncode=1), _completed(returncode=0),
            _completed(returncode=1), _completed(returncode=0),
        ]
        with patch("ci_tools.commands.github.cli.subprocess.run", side_effect=side_effects):
            result = _invoke("--repo", "owner/repo")

        assert result.exit_code == 0
        assert "Done." in result.output
