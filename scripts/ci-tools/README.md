# ci-tools

Internal CI tooling for this repository. Built with [Typer](https://typer.tiangolo.com/) and [Pydantic](https://docs.pydantic.dev/).

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)

## Usage

Run from the repository root via `uv run`:

```bash
uv run --project scripts/ci-tools ci-tools [OPTIONS] COMMAND [ARGS]...
```

Or install into a local venv and invoke directly:

```bash
cd scripts/ci-tools
uv sync
uv run ci-tools --help
```

Pass `--verbose` / `-v` to enable debug logging to stderr.

---

## Commands

### `release extract`

Reads `.release-manifest.json` and `CHANGELOG.md` and emits a JSON object to stdout with the version, git tag, and changelog entry for that version. Used by the release workflow to populate `$GITHUB_OUTPUT` and the release notes file.

```bash
uv run --project scripts/ci-tools ci-tools release extract \
  --manifest .github/.release-manifest.json \
  --changelog CHANGELOG.md
```

**Output:**
```json
{
  "version": "1.2.3",
  "tag": "v1.2.3",
  "release_notes": "..."
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `--manifest` | `.github/.release-manifest.json` | Path to the release manifest JSON |
| `--changelog` | `CHANGELOG.md` | Path to the changelog |
| `--tag-prefix` | `v` | Prefix prepended to the version to form the git tag (e.g. `v`, `release/`, ``) |

---

### `release validate`

Validates all release artifacts for consistency and emits a Markdown summary to stdout. Exits 1 if any check fails. The output is suitable for piping directly into `$GITHUB_STEP_SUMMARY`.

Checks performed:
- Manifest version is valid semver
- CHANGELOG.md contains a non-empty entry for the version
- The target git tag does not already exist (when `--tags-file` is provided)
- `plugin.json` and `marketplace.json` versions match the manifest (when provided)
- First release tag matches `--initial-version` (when tags file is empty)

```bash
git tag --list 'v*' > /tmp/tags.txt

uv run --project scripts/ci-tools ci-tools release validate \
  --manifest .github/.release-manifest.json \
  --changelog CHANGELOG.md \
  --plugin-json .claude-plugin/plugin.json \
  --marketplace-json .claude-plugin/marketplace.json \
  --tags-file /tmp/tags.txt \
  --initial-version 0.1.0
```

| Option | Default | Description |
|--------|---------|-------------|
| `--manifest` | `.github/.release-manifest.json` | Path to the release manifest JSON |
| `--changelog` | `CHANGELOG.md` | Path to the changelog |
| `--plugin-json` | — | Path to `plugin.json` (version consistency check) |
| `--marketplace-json` | — | Path to `marketplace.json` (version consistency check) |
| `--tags-file` | — | File containing one existing git tag per line |
| `--initial-version` | — | Expected version for the very first release (e.g. `1.0.0`) |
| `--tag-prefix` | `v` | Prefix prepended to the version to form the git tag |

---

### `release sync`

Reads the version from `.release-manifest.json` and writes it into `plugin.json` and/or `marketplace.json`. Emits a JSON summary of which files were updated. Exits 0 even if nothing changed.

```bash
uv run --project scripts/ci-tools ci-tools release sync \
  --manifest .github/.release-manifest.json \
  --plugin-json .claude-plugin/plugin.json \
  --marketplace-json .claude-plugin/marketplace.json
```

**Output:**
```json
{
  "version": "1.2.3",
  "updated": [".claude-plugin/plugin.json"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `--manifest` | `.github/.release-manifest.json` | Path to the release manifest JSON |
| `--plugin-json` | — | Path to `plugin.json` to update |
| `--marketplace-json` | — | Path to `marketplace.json` to update |

---

## Development

```bash
cd scripts/ci-tools
uv sync          # install deps + dev deps
uv run pytest    # run the test suite
```

### Project layout

```
src/ci_tools/
├── cli.py                        # top-level Typer app; register new command groups here
├── settings.py                   # CISettings(BaseSettings) — env var config
└── commands/
    └── release/
        ├── models.py             # Pydantic domain models
        ├── core.py               # pure logic — no Typer imports, raises ValueError
        └── cli.py                # Typer sub-app (extract / validate / sync)
tests/
├── test_cli_top.py               # top-level app tests
└── release/
    ├── test_models.py
    ├── test_core.py
    └── test_cli.py
```

### Adding a new command group

1. Create `src/ci_tools/commands/<name>/` with `models.py`, `core.py`, and `cli.py`
2. Define `<name>_app = typer.Typer(name="<name>", ...)` in `cli.py`
3. In `src/ci_tools/cli.py`, add one line: `app.add_typer(<name>_app, name="<name>")`
4. Add tests under `tests/<name>/`

### Architecture

- **Core is pure** — `core.py` has no Typer or Click imports and is fully unit-testable without CLI machinery. It raises `ValueError` on bad input; the CLI layer catches these and calls `typer.Exit(1)`.
- **JSON to stdout, logs to stderr** — all commands write machine-readable output to stdout and diagnostic logs to stderr via loguru, keeping the two streams cleanly separated for CI pipelines.
- **`TagsProvider` protocol** — the DI seam for tag-checking logic. `FileTagsProvider` is the production implementation; a future `GitHubTagsProvider` (or any test stub) can be substituted with no changes to core.
- **`CISettings`** — `pydantic-settings` model that auto-reads standard CI environment variables (`GITHUB_TOKEN`, `GITHUB_REPOSITORY`, etc.) from the environment or a local `.env` file.
