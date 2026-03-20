from __future__ import annotations

from pydantic import BaseModel, Field


class CopyMapping(BaseModel):
    source: str
    dest: str
    exclude: list[str] = []

class VersionUpdate(BaseModel):
    file: str
    field: str

class SyncDefaults(BaseModel):
    branch: str = "automated/skill-sync"
    commit_message: str = "chore: sync skills from agent-skills {version}"
    pr_title: str = "chore: sync agent-skills {version}"
    pr_body: str = "Automated sync from {source_repo} release {version}"

class SyncTarget(BaseModel):
    name: str
    repo: str
    branch: str | None = None
    commit_message: str | None = None
    pr_title: str | None = None
    pr_body: str | None = None
    copies: list[CopyMapping]
    versions: list[VersionUpdate] = []

class SyncConfig(BaseModel):
    defaults: SyncDefaults = SyncDefaults()
    target: list[SyncTarget] = Field(min_length=1)

class SyncApplyOutput(BaseModel):
    target_name: str
    repo: str
    branch: str
    commit_message: str
    pr_title: str
    pr_body: str
    files_copied: int
    files_deleted: int
    versions_updated: list[str]
    changes_made: bool

class SyncListOutput(BaseModel):
    targets: list[str]
