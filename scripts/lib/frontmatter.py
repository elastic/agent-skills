"""Lightweight YAML frontmatter parser for SKILL.md files.

Avoids a PyYAML dependency by doing simple line-based parsing.  Handles
multi-line folded scalars (``key: >`` followed by indented lines) and one
level of nested mappings (``metadata:\n  version: 0.1.0`` becomes
``metadata.version: 0.1.0``).
"""

from __future__ import annotations

import re
from pathlib import Path

_NESTED_KEY_RE = re.compile(r"^([a-z][a-z0-9_-]*):\s+(.*)")


def parse_frontmatter(path: Path) -> dict[str, str] | None:
    """Extract YAML frontmatter key-value pairs from a SKILL.md file.

    Returns a flat dict (nested keys are dot-joined, e.g.
    ``metadata.version``) or ``None`` if no frontmatter is found.
    """
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None

    end = text.find("\n---", 3)
    if end == -1:
        return None

    block = text[4:end]
    result: dict[str, str] = {}
    current_key: str | None = None
    current_val_lines: list[str] = []
    is_mapping: bool | None = False

    for line in block.splitlines():
        top_match = re.match(r"^(\w[\w.]*):\s*(>-?|.*)", line)
        if top_match and not line.startswith((" ", "\t")):
            if current_key is not None and not is_mapping:
                result[current_key] = " ".join(current_val_lines).strip()
            current_key = top_match.group(1)
            val = top_match.group(2).strip()
            if val in (">", ">-"):
                current_val_lines = []
                is_mapping = False
            elif val == "":
                current_val_lines = []
                is_mapping = None
            else:
                current_val_lines = [val]
                is_mapping = False
        elif current_key is not None and line.startswith((" ", "\t")):
            stripped = line.strip()
            if is_mapping is None:
                nested = _NESTED_KEY_RE.match(stripped)
                if nested:
                    is_mapping = True
                    result[f"{current_key}.{nested.group(1)}"] = (
                        nested.group(2).strip().strip('"').strip("'")
                    )
                else:
                    is_mapping = False
                    current_val_lines.append(stripped)
            elif is_mapping:
                nested = _NESTED_KEY_RE.match(stripped)
                if nested:
                    result[f"{current_key}.{nested.group(1)}"] = (
                        nested.group(2).strip().strip('"').strip("'")
                    )
            else:
                current_val_lines.append(stripped)

    if current_key is not None and not is_mapping:
        result[current_key] = " ".join(current_val_lines).strip()

    return result
