#!/usr/bin/env python3
"""Generate a skill table in README.md from SKILL.md frontmatter.

Walks skills/ for SKILL.md files, extracts frontmatter fields, and injects
a markdown table (grouped by namespace) between <!-- BEGIN-SKILL-TABLE -->
and <!-- END-SKILL-TABLE --> comment markers in README.md.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.frontmatter import parse_frontmatter

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
README_PATH = REPO_ROOT / "README.md"

BEGIN_MARKER = "<!-- BEGIN-SKILL-TABLE -->"
END_MARKER = "<!-- END-SKILL-TABLE -->"

COLLAPSE_THRESHOLD = 20


def discover_skills() -> dict[str, list[dict[str, str]]]:
    """Return skills grouped by namespace, sorted alphabetically."""
    namespaces: dict[str, list[dict[str, str]]] = {}

    if not SKILLS_DIR.is_dir():
        return namespaces

    for skill_md in sorted(SKILLS_DIR.rglob("SKILL.md")):
        rel = skill_md.relative_to(SKILLS_DIR)
        if len(rel.parts) < 3:
            continue

        namespace = rel.parts[0]
        fm = parse_frontmatter(skill_md)
        if fm is None:
            continue

        name = fm.get("name", rel.parts[1])
        description = fm.get("description", "")
        version = fm.get("metadata.version", "")
        author = fm.get("metadata.author", "")
        visibility = fm.get("metadata.visibility", "internal")

        link_path = str(skill_md.relative_to(REPO_ROOT))

        namespaces.setdefault(namespace, []).append(
            {
                "name": name,
                "description": description,
                "version": version,
                "author": author,
                "visibility": visibility,
                "link": link_path,
            }
        )

    return dict(sorted(namespaces.items()))


def render_table(skills: list[dict[str, str]]) -> str:
    """Render a single namespace's skill list as a markdown table."""
    lines = [
        "| Skill | Description | Version | Author | Visibility |",
        "| ----- | ----------- | ------- | ------ | ---------- |",
    ]
    for s in skills:
        skill_link = f"[{s['name']}]({s['link']})"
        desc = s["description"].replace("|", "\\|")
        version = s.get("version", "")
        author = s["author"].replace("|", "\\|") if s["author"] else ""
        visibility = s["visibility"].replace("|", "\\|")
        cells = [skill_link, desc, version, author, visibility]
        parts = [f" {c} " if c else " " for c in cells]
        lines.append("|" + "|".join(parts) + "|")
    return "\n".join(lines)


def build_section(namespaces: dict[str, list[dict[str, str]]]) -> str:
    """Build the full skills section to inject between markers."""
    total = sum(len(skills) for skills in namespaces.values())
    if total == 0:
        return ""

    collapse = total > COLLAPSE_THRESHOLD
    parts: list[str] = ["\n## Available Skills\n"]

    for ns, skills in namespaces.items():
        title = ns.replace("-", " ").title()
        table = render_table(skills)

        if collapse:
            parts.append(f"<details>\n<summary>{title} ({len(skills)})</summary>\n")
            parts.append(table)
            parts.append("\n</details>\n")
        else:
            parts.append(f"### {title}\n")
            parts.append(table)
            parts.append("")

    return "\n".join(parts)


def inject_into_readme(section: str) -> None:
    """Replace content between markers in README.md."""
    readme = README_PATH.read_text(encoding="utf-8")

    begin_idx = readme.find(BEGIN_MARKER)
    end_idx = readme.find(END_MARKER)

    if begin_idx == -1 or end_idx == -1:
        print(
            f"Error: markers {BEGIN_MARKER} / {END_MARKER} not found in {README_PATH}",
            file=sys.stderr,
        )
        sys.exit(1)

    before = readme[: begin_idx + len(BEGIN_MARKER)]
    after = readme[end_idx:]

    if section:
        new_readme = f"{before}\n{section}\n{after}"
    else:
        new_readme = f"{before}\n{after}"

    README_PATH.write_text(new_readme, encoding="utf-8")


def main() -> None:
    namespaces = discover_skills()
    total = sum(len(s) for s in namespaces.values())
    section = build_section(namespaces)
    inject_into_readme(section)
    ns_count = len(namespaces)
    print(
        f"Generated skill table in {README_PATH.name}: "
        f"{total} skill(s) across {ns_count} namespace(s)."
    )


if __name__ == "__main__":
    main()
