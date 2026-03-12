from __future__ import annotations

import json

import pytest
from pathlib import Path


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    """Write a valid .release-manifest.json and return its path."""
    path = tmp_path / ".release-manifest.json"
    path.write_text(json.dumps({"version": "1.2.3"}))
    return path


@pytest.fixture()
def plugin_json(tmp_path: Path) -> Path:
    """Write a valid plugin.json and return its path."""
    path = tmp_path / "plugin.json"
    path.write_text(json.dumps({"name": "agent-skills", "version": "1.2.3"}))
    return path


@pytest.fixture()
def marketplace_json(tmp_path: Path) -> Path:
    """Write a valid marketplace.json and return its path."""
    path = tmp_path / "marketplace.json"
    path.write_text(json.dumps({
        "plugins": [{"name": "agent-skills", "version": "1.2.3"}],
    }))
    return path


@pytest.fixture()
def changelog(tmp_path: Path) -> Path:
    """Write a CHANGELOG.md with a v1.2.3 entry and return its path."""
    path = tmp_path / "CHANGELOG.md"
    path.write_text(
        "# Changelog\n"
        "\n"
        "## v1.2.3\n"
        "\n"
        "- Fixed a bug\n"
        "- Added a feature\n"
        "\n"
        "## v1.2.2\n"
        "\n"
        "- Older entry\n"
    )
    return path


@pytest.fixture()
def tags_file(tmp_path: Path) -> Path:
    """Write a tags file with some existing tags and return its path."""
    path = tmp_path / "tags.txt"
    path.write_text("v1.0.0\nv1.1.0\nv1.2.2\n")
    return path


@pytest.fixture()
def empty_tags_file(tmp_path: Path) -> Path:
    """Write an empty tags file (no releases yet) and return its path."""
    path = tmp_path / "tags.txt"
    path.write_text("")
    return path
