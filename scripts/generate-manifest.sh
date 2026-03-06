#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
OUTPUT_DIR="$REPO_ROOT/.claude-plugin"
OUTPUT_FILE="$OUTPUT_DIR/marketplace.json"

mkdir -p "$OUTPUT_DIR"

skill_dirs=()
if [ -d "$SKILLS_DIR" ]; then
  while IFS= read -r -d '' skill_file; do
    skill_dirs+=("$(dirname "$skill_file")")
  done < <(find "$SKILLS_DIR" -mindepth 3 -name SKILL.md -print0 | sort -z)
fi

# Build the skills JSON array entries
skills_json=""
for dir in ${skill_dirs[@]+"${skill_dirs[@]}"}; do
  rel="./${dir#"$REPO_ROOT/"}"
  if [ -n "$skills_json" ]; then
    skills_json="$skills_json,"
  fi
  skills_json="$skills_json
      \"$rel\""
done

# Write the manifest
if [ -n "$skills_json" ]; then
  skills_block="[$skills_json
    ]"
else
  skills_block="[]"
fi

cat > "$OUTPUT_FILE" <<EOF
{
  "metadata": {
    "pluginRoot": "./"
  },
  "plugins": [
    {
      "name": "elastic-agent-skills",
      "source": "elastic-agent-skills",
      "skills": $skills_block
    }
  ]
}
EOF

echo "Generated $OUTPUT_FILE with ${#skill_dirs[@]} skill(s)."
