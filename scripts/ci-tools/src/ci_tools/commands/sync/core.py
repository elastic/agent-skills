from __future__ import annotations

import json
import shutil
import tomllib
from fnmatch import fnmatch
from pathlib import Path

from ci_tools.commands.sync.models import (
    CopyMapping,
    SyncApplyOutput,
    SyncConfig,
    SyncTarget,
    VersionUpdate,
)


def load_sync_config(path: Path) -> SyncConfig:
    if not path.is_file():
        raise ValueError(f"Config file not found: {path}")
    with open(path, "rb") as f:
        data = tomllib.load(f)
    sync_data = data.get("sync")
    if sync_data is None:
        raise ValueError(f"Missing [sync] section in {path}")
    return SyncConfig.model_validate(sync_data)


def resolve_target(config: SyncConfig, name: str) -> SyncTarget:
    for t in config.target:
        if t.name == name:
            return t
    available = [t.name for t in config.target]
    raise ValueError(f"Target '{name}' not found. Available: {available}")


def resolve_template(
    template: str, *, version: str, source_repo: str, target_name: str
) -> str:
    return template.format_map(
        {"version": version, "source_repo": source_repo, "target_name": target_name}
    )


def resolve_field(config: SyncConfig, target: SyncTarget, field: str) -> str:
    override = getattr(target, field, None)
    if override is not None:
        return override
    return getattr(config.defaults, field)


def copy_tree(
    source: Path, dest: Path, exclude: list[str] | None = None
) -> tuple[int, int]:
    exclude = exclude or []
    files_copied = 0
    files_deleted = 0

    # Delete stale files in dest that aren't in source and don't match exclude
    if dest.is_dir():
        for dest_file in sorted(dest.rglob("*")):
            if not dest_file.is_file():
                continue
            rel = dest_file.relative_to(dest)
            rel_str = str(rel)
            if any(fnmatch(rel_str, pat) for pat in exclude):
                continue
            source_file = source / rel
            if not source_file.is_file():
                dest_file.unlink()
                files_deleted += 1

    # Copy all files from source to dest
    if source.is_dir():
        for source_file in sorted(source.rglob("*")):
            if not source_file.is_file():
                continue
            rel = source_file.relative_to(source)
            dest_file = dest / rel
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, dest_file)
            files_copied += 1

    return files_copied, files_deleted


def apply_copies(
    source_root: Path, target_root: Path, copies: list[CopyMapping]
) -> tuple[int, int]:
    total_copied = 0
    total_deleted = 0
    for mapping in copies:
        src = source_root / mapping.source
        dst = target_root / mapping.dest
        copied, deleted = copy_tree(src, dst, mapping.exclude)
        total_copied += copied
        total_deleted += deleted
    return total_copied, total_deleted


def navigate_field(data: dict | list, path: str) -> list[tuple[dict, str]]:
    parts = path.split(".")
    current: list[dict | list] = [data]

    for i, part in enumerate(parts):
        is_last = i == len(parts) - 1
        next_level: list[dict | list] = []

        for node in current:
            if part == "*":
                if not isinstance(node, list):
                    raise ValueError(f"Wildcard '*' used on non-list at '{'.'.join(parts[:i])}'")
                if is_last:
                    raise ValueError("Wildcard '*' cannot be the final path segment")
                next_level.extend(node)
            elif isinstance(node, list):
                try:
                    idx = int(part)
                except ValueError:
                    raise ValueError(f"Expected integer index for list at '{'.'.join(parts[:i])}', got '{part}'")
                if idx < 0 or idx >= len(node):
                    raise ValueError(f"Index {idx} out of range for list of length {len(node)}")
                if is_last:
                    return [(node, part)]  # type: ignore[list-item]
                next_level.append(node[idx])
            elif isinstance(node, dict):
                if part not in node:
                    raise ValueError(f"Key '{part}' not found at '{'.'.join(parts[:i])}'")
                if is_last:
                    next_level.append(node)
                else:
                    next_level.append(node[part])
            else:
                raise ValueError(f"Cannot navigate into {type(node).__name__} at '{'.'.join(parts[:i])}'")

        if is_last and part != "*":
            return [(n, part) for n in next_level]  # type: ignore[misc]
        current = next_level

    return []


def update_json_field(path: Path, field_path: str, value: str) -> bool:
    text = path.read_text()
    data = json.loads(text)
    targets = navigate_field(data, field_path)
    changed = False
    for parent, key in targets:
        if isinstance(parent, list):
            idx = int(key)
            if parent[idx] != value:
                parent[idx] = value
                changed = True
        elif isinstance(parent, dict):
            if parent.get(key) != value:
                parent[key] = value
                changed = True
    if changed:
        path.write_text(json.dumps(data, indent=2) + "\n")
    return changed


def apply_versions(
    target_root: Path, versions: list[VersionUpdate], version: str
) -> list[str]:
    updated: list[str] = []
    for v in versions:
        file_path = target_root / v.file
        if not file_path.is_file():
            continue
        if update_json_field(file_path, v.field, version):
            updated.append(f"{v.file}:{v.field}")
    return updated


def apply_sync(
    source_root: Path,
    target_root: Path,
    config: SyncConfig,
    target_name: str,
    version: str,
    source_repo: str,
) -> SyncApplyOutput:
    target = resolve_target(config, target_name)

    template_vars = dict(version=version, source_repo=source_repo, target_name=target_name)

    branch = resolve_template(resolve_field(config, target, "branch"), **template_vars)
    commit_message = resolve_template(resolve_field(config, target, "commit_message"), **template_vars)
    pr_title = resolve_template(resolve_field(config, target, "pr_title"), **template_vars)
    pr_body = resolve_template(resolve_field(config, target, "pr_body"), **template_vars)

    files_copied, files_deleted = apply_copies(source_root, target_root, target.copies)
    versions_updated = apply_versions(target_root, target.versions, version)

    return SyncApplyOutput(
        target_name=target_name,
        repo=target.repo,
        branch=branch,
        commit_message=commit_message,
        pr_title=pr_title,
        pr_body=pr_body,
        files_copied=files_copied,
        files_deleted=files_deleted,
        versions_updated=versions_updated,
        changes_made=files_copied > 0 or files_deleted > 0 or len(versions_updated) > 0,
    )
