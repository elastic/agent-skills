#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# install-skills.sh — pure-bash installer for the Agent Skills ecosystem.
# Discovers skills in this repo's skills/ directory and copies them into
# the appropriate agent directories.
# Requires: bash 3.2+, awk, find, cp, rm, mkdir, basename, dirname
# ---------------------------------------------------------------------------

for cmd in awk find cp rm mkdir basename dirname; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' not found. Install it and try again." >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"

SCRIPT_NAME="$(basename "$0")"
VERSION="0.1.0"

# ── Agent directory mappings ──────────────────────────────────────────────
# Each entry: "agent_id|project_dir" (relative to $PWD)
AGENT_DEFS=(
  "claude-code|.claude/skills"
  "cursor|.agents/skills"
  "codex|.agents/skills"
  "opencode|.agents/skills"
  "windsurf|.windsurf/skills"
  "roo|.roo/skills"
  "cline|.agents/skills"
  "github-copilot|.agents/skills"
  "gemini-cli|.agents/skills"
)

# ── Globals ───────────────────────────────────────────────────────────────
YES=false
FORCE=false
AGENTS=()
SKILLS=()
DISCOVERED_SKILLS=()

# ── Helpers ───────────────────────────────────────────────────────────────

die() { echo "Error: $*" >&2; exit 1; }

info() { echo "  $*"; }

bold() {
  if [ -t 1 ]; then
    printf '\033[1m%s\033[0m' "$*"
  else
    printf '%s' "$*"
  fi
}

green() {
  if [ -t 1 ]; then
    printf '\033[32m%s\033[0m' "$*"
  else
    printf '%s' "$*"
  fi
}

confirm() {
  if $YES; then return 0; fi
  local prompt="$1"
  printf '%s [Y/n] ' "$prompt"
  local answer=""
  if (true >/dev/tty) 2>/dev/null; then
    read -r answer </dev/tty
  elif [ -t 0 ]; then
    read -r answer
  else
    die "No TTY available for confirmation. Re-run with --yes in non-interactive environments."
  fi
  case "$answer" in
    [nN]*) return 1 ;;
    *) return 0 ;;
  esac
}

list_agent_ids() {
  for def in "${AGENT_DEFS[@]}"; do
    echo "  ${def%%|*}"
  done
}

usage() {
  cat <<EOF
$SCRIPT_NAME v$VERSION — install agent skills without npx

Usage:
  $SCRIPT_NAME add -a <agent> [options]  Install skills from this repo
  $SCRIPT_NAME list                      List available skills in this repo
  $SCRIPT_NAME help                      Show this help

Options:
  -a, --agent <name>    Target agent(s), required for add, repeatable
  -s, --skill <name>    Install specific skill(s) by name or glob (e.g. 'observability-*'); quote globs to avoid shell expansion, repeatable
  -f, --force           Overwrite skills that are already installed
  -y, --yes             Skip confirmation prompts
  -h, --help            Show this help

Agents:
$(list_agent_ids)

Examples:
  $SCRIPT_NAME list                             Show available skills
  $SCRIPT_NAME add -a claude-code               Install all skills for Claude Code
  $SCRIPT_NAME add -a cursor -a claude-code     Install to multiple agents
  $SCRIPT_NAME add -a cursor -s 'observability-*'   Install all observability skills (glob)
  $SCRIPT_NAME add -a cursor elasticsearch-query-authoring   Install a specific skill (by frontmatter name)
  $SCRIPT_NAME add -a cursor --force -y         Overwrite without prompts
EOF
  exit 0
}

# ── Frontmatter parsing ──────────────────────────────────────────────────

parse_frontmatter_field() {
  local file="$1"
  local field="$2"
  awk -v f="$field" '
    /^---$/ { count++; next }
    count == 1 && $0 ~ "^" f ":" {
      sub("^" f ":[ ]*", "")
      if ($0 == ">" || $0 == "|") {
        val = ""
        while ((getline line) > 0) {
          if (line !~ /^[[:space:]]/) break
          sub(/^[[:space:]]+/, "", line)
          if (val != "") val = val " "
          val = val line
        }
        print val
        exit
      }
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
    count >= 2 { exit }
  ' "$file"
}

# ── Skill discovery ──────────────────────────────────────────────────────

discover_skills() {
  local root="$1"
  DISCOVERED_SKILLS=()

  if [ ! -d "$root" ]; then
    return
  fi

  local found=()
  while IFS= read -r -d '' skill_file; do
    found+=("$skill_file")
  done < <(find "$root" -mindepth 3 -type f -name SKILL.md -print0 2>/dev/null)

  if [ ${#found[@]} -eq 0 ]; then
    return
  fi

  local seen=""
  for f in "${found[@]}"; do
    local real
    real="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
    if [[ "$seen" != *"|$real|"* ]]; then
      seen="${seen}|${real}|"
      DISCOVERED_SKILLS+=("$real")
    fi
  done
}

skill_name_from_file() {
  parse_frontmatter_field "$1" "name"
}

skill_desc_from_file() {
  parse_frontmatter_field "$1" "description"
}

# ── Agent lookup ──────────────────────────────────────────────────────────

get_agent_id() { echo "${1%%|*}"; }

agent_def_by_id() {
  local target="$1"
  for def in "${AGENT_DEFS[@]}"; do
    if [ "$(get_agent_id "$def")" = "$target" ]; then
      echo "$def"
      return 0
    fi
  done
  return 1
}

agent_project_dir() {
  local def
  def="$(agent_def_by_id "$1")"
  echo "$(pwd)/${def#*|}"
}

# ── Commands ──────────────────────────────────────────────────────────────

cmd_add() {
  [ -d "${PWD:-.}" ] || die "Current directory does not exist. cd into a valid directory first."

  if [ ${#AGENTS[@]} -eq 0 ]; then
    echo "Error: -a <agent> is required. Available agents:" >&2
    list_agent_ids >&2
    exit 1
  fi

  # Validate agent names
  for a in "${AGENTS[@]}"; do
    agent_def_by_id "$a" >/dev/null || die "Unknown agent: $a. Run '$SCRIPT_NAME help' to see available agents."
  done

  # Deduplicate agents
  local target_agents=()
  local seen_agents=""
  for a in "${AGENTS[@]}"; do
    if [[ "$seen_agents" != *"|$a|"* ]]; then
      seen_agents="${seen_agents}|${a}|"
      target_agents+=("$a")
    fi
  done

  discover_skills "$SKILLS_DIR"

  if [ ${#DISCOVERED_SKILLS[@]} -eq 0 ]; then
    die "No skills found in $SKILLS_DIR"
  fi

  local skill_names=() skill_dirs=()
  for sf in "${DISCOVERED_SKILLS[@]}"; do
    local name
    name="$(skill_name_from_file "$sf")"
    if [ -z "$name" ]; then
      echo "Warning: skipping $sf (missing 'name' in frontmatter)" >&2
      continue
    fi
    if [[ "$name" == *"/"* || "$name" == *".."* ]]; then
      echo "Warning: skipping $sf (invalid skill name '$name': must not contain '/' or '..')" >&2
      continue
    fi
    if ! [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
      echo "Warning: skipping $sf (invalid skill name '$name': must be kebab-case)" >&2
      continue
    fi
    skill_names+=("$name")
    skill_dirs+=("$(dirname "$sf")")
  done

  if [ ${#skill_names[@]} -eq 0 ]; then
    die "No valid skills (with name in frontmatter) found in $SKILLS_DIR"
  fi

  # Filter by --skill / positional args (exact name or glob pattern, e.g. observability-*)
  local selected_indices=()
  if [ ${#SKILLS[@]} -gt 0 ]; then
    for s in "${SKILLS[@]}"; do
      [ -n "$s" ] || die "Empty skill name or pattern not allowed"
    done
    for i in "${!skill_names[@]}"; do
      for s in "${SKILLS[@]}"; do
        if [ "$s" = "*" ] || [[ "${skill_names[$i]}" == $s ]]; then
          selected_indices+=("$i")
          break
        fi
      done
    done
    if [ ${#selected_indices[@]} -eq 0 ]; then
      die "None of the requested skills were found. Available: ${skill_names[*]}"
    fi
  else
    for i in "${!skill_names[@]}"; do
      selected_indices+=("$i")
    done
  fi

  # Show summary and confirm
  echo ""
  echo "Skills to install:"
  for i in "${selected_indices[@]}"; do
    info "$(green "${skill_names[$i]}")"
  done
  echo ""
  echo "Target agents:"
  for a in "${target_agents[@]}"; do
    info "$(bold "$a")  ->  $(agent_project_dir "$a")"
  done
  echo ""

  if ! confirm "Proceed with installation?"; then
    echo "Cancelled."
    return 0
  fi

  # Install
  local installed=0
  local skipped=0
  local installed_paths=""
  for i in "${selected_indices[@]}"; do
    local sname="${skill_names[$i]}"
    local sdir="${skill_dirs[$i]}"
    for a in "${target_agents[@]}"; do
      local dest
      dest="$(agent_project_dir "$a")/$sname"
      mkdir -p "$(dirname "$dest")"
      if [ -d "$dest" ]; then
        if [[ "$installed_paths" == *"|$dest|"* ]]; then
          continue
        elif $FORCE; then
          rm -rf "$dest"
        else
          echo "  Skipping $sname for $a (already exists, use --force to overwrite)"
          skipped=$((skipped + 1))
          continue
        fi
      fi
      cp -r "$sdir" "$dest"
      installed_paths="${installed_paths}|${dest}|"
      installed=$((installed + 1))
    done
  done

  echo ""
  if [ $skipped -gt 0 ]; then
    echo "$(green "Done.") Installed $installed, skipped $skipped (already exists)."
  else
    echo "$(green "Done.") Installed ${#selected_indices[@]} skill(s) to ${#target_agents[@]} agent(s) ($installed total copies)."
  fi
}

cmd_list() {
  discover_skills "$SKILLS_DIR"

  if [ ${#DISCOVERED_SKILLS[@]} -eq 0 ]; then
    echo "No skills found in $SKILLS_DIR"
    return 0
  fi

  local skill_names=() skill_descs=()
  for sf in "${DISCOVERED_SKILLS[@]}"; do
    local name desc
    name="$(skill_name_from_file "$sf")"
    desc="$(skill_desc_from_file "$sf")"
    if [ -z "$name" ]; then
      echo "Warning: skipping $sf (missing 'name' in frontmatter)" >&2
      continue
    fi
    skill_names+=("$name")
    skill_descs+=("$desc")
  done

  if [ ${#skill_names[@]} -eq 0 ]; then
    echo "No valid skills (with name in frontmatter) found in $SKILLS_DIR"
    return 0
  fi

  echo ""
  echo "Available skills in $(bold "$SKILLS_DIR"):"
  echo ""
  for i in "${!skill_names[@]}"; do
    printf '  %s  %s\n' "$(green "${skill_names[$i]}")" "${skill_descs[$i]}"
  done
  echo ""
  echo "${#skill_names[@]} skill(s) found."
}

# ── Argument parsing ─────────────────────────────────────────────────────

main() {
  if [ $# -eq 0 ]; then
    usage
  fi

  local command="$1"
  shift

  case "$command" in
    help|-h|--help) usage ;;
    --version) echo "$SCRIPT_NAME v$VERSION"; exit 0 ;;
    add|list|ls) ;;
    *) die "Unknown command: $command. Run '$SCRIPT_NAME help' for usage." ;;
  esac

  [ "$command" = "ls" ] && command="list"

  local positional=()
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--yes)     YES=true; shift ;;
      -f|--force)   FORCE=true; shift ;;
      -a|--agent)   [ $# -ge 2 ] || die "-a requires a value"; AGENTS+=("$2"); shift 2 ;;
      -s|--skill)   [ $# -ge 2 ] || die "-s requires a value"; [ -n "$2" ] || die "-s requires a non-empty value"; SKILLS+=("$2"); shift 2 ;;
      -h|--help)    usage ;;
      -*)           die "Unknown option: $1" ;;
      *)            positional+=("$1"); shift ;;
    esac
  done

  case "$command" in
    add)
      for p in ${positional[@]+"${positional[@]}"}; do
        SKILLS+=("$p")
      done
      cmd_add
      ;;
    list) cmd_list ;;
  esac
}

main "$@"
