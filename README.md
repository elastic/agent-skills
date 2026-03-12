<p align="center">
  <img alt="Elastic logo" src="https://www.elastic.co/static-res/images/elastic-logo-200.png" width="200">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
</p>

# Agent Skills

Official Elastic skills for AI agent runtimes, built on the [Agent Skills](https://agentskills.io/) open standard.

> [!NOTE]
> **Technical Preview**
>
> These skills are in early release and under active development. Expect changes as skills are codified with robust
> evaluations and as the model landscape evolves. Check back frequently for updates.

## About

This repository contains curated skills that help AI agents work with the Elastic stack — Elasticsearch, Kibana,
Logstash, Beats, Fleet, APM, Elastic Security, Elastic Observability, and more. Skills are folders of instructions,
scripts, and resources that agents load dynamically to improve performance on specialized tasks.

## What are skills?

Skills are self-contained packages that give AI agents the knowledge and tools to complete specific tasks in a repeatable
way. Each skill lives in its own folder with a `SKILL.md` file containing metadata and instructions the agent follows.

For more background on the Agent Skills standard, see [agentskills.io](http://agentskills.io/).

<!-- BEGIN-SKILL-TABLE -->
<!-- END-SKILL-TABLE -->

## Installation

You can install Elastic skills using the `skills` CLI with `npx`, or by cloning this repository and running the bundled installer script. The `npx` method requires `Node.js` with `npx` available in your environment.

### npx (Recommended)

The fastest way to install skills is with the [`skills`](https://github.com/vercel-labs/skills) CLI. No need to clone
this repository — just run:

```sh
npx skills add elastic/agent-skills
```

This launches an interactive prompt to select skills and target agents. The CLI copies each skill folder into the correct
location for the agent to discover.

Install a specific skill by name:

```sh
npx skills add elastic/agent-skills --skill elasticsearch-esql
```

Or use the `@` shorthand to specify the skill directly as `repo@skill` (equivalent to `--skill`):

```sh
npx skills add elastic/agent-skills@elasticsearch-esql
```

Install to specific agents:

```sh
npx skills add elastic/agent-skills -a cursor -a claude-code
```

List available skills without installing:

```sh
npx skills add elastic/agent-skills --list
```

Install all skills to all agents (non-interactive):

```sh
npx skills add elastic/agent-skills --all
```

| Flag              | Description                                       |
| ----------------- | ------------------------------------------------- |
| `-a, --agent`     | Target specific agents                          |
| `-s, --skill`     | Install specific skills by name                 |
| `-g, --global`    | Install to user home instead of project directory  |
| `-y, --yes`       | Skip confirmation prompts                         |
| `--all`           | Install all skills to all agents without prompts  |
| `--list`          | List available skills without installing           |

### Local clone

If you prefer to work from a local checkout, or your environment does not have Node.js / npx, clone the repository and
use the bundled bash installer:

```sh
git clone https://github.com/elastic/agent-skills.git
cd agent-skills
./scripts/install-skills.sh add -a <agent>
```

The script requires bash 3.2+ and standard Unix utilities (`awk`, `find`, `cp`, `rm`, `mkdir`).

| Flag              | Description                           |
| ----------------- | ------------------------------------- |
| `-a, --agent`     | Target agent (repeatable)             |
| `-s, --skill`     | Install specific skills by name     |
| `-f, --force`     | Overwrite already-installed skills    |
| `-y, --yes`       | Skip confirmation prompts             |

List all available skills:

```sh
./scripts/install-skills.sh list
```

### Supported agents

| Agent           | Install directory         |
| --------------- | ------------------------- |
| claude-code     | `.claude/skills`          |
| cursor          | `.agents/skills`          |
| codex           | `.agents/skills`          |
| opencode        | `.agents/skills`          |
| windsurf        | `.windsurf/skills`        |
| roo             | `.roo/skills`             |
| cline           | `.agents/skills`          |
| github-copilot  | `.agents/skills`          |
| gemini-cli      | `.agents/skills`          |

## Updating skills

Skills are copied into your project (or home directory) at install time. When this repository is updated — new
instructions, bug fixes, additional resources — those changes are **not** automatically synced to your local copies.
You need to update manually.

The update process depends on how the skills were installed (`npx` or a local clone).

### npx

Check whether any installed skills have changed upstream:

```sh
npx skills check
```

Pull the latest versions of all installed skills:

```sh
npx skills update
```

The CLI tracks each skill's source repository and a content hash in a lock file. `check` compares your local hashes
against GitHub; `update` re-downloads anything that has drifted.

> **Tip:** The default npx installation uses symlinks, so every agent points to a single canonical copy. Updating once
> refreshes all agents at the same time.

### Local clone

Re-run the installer with `--force` to overwrite existing skills:

```sh
git pull
./scripts/install-skills.sh add -a <agent> --force
```

Without `--force` the script skips skills that are already installed.

## Skill format

Every skill folder contains a `SKILL.md` with YAML frontmatter and markdown instructions:

```yaml
---
name: elasticsearch-my-skill
description: >
  What the skill does AND when an agent should activate it.
metadata:
  version: 0.1.0
  visibility: public
---

# My Skill

[Instructions that the agent follows when this skill is active]
```

The `description` field is the sole trigger mechanism — agent runtimes read it to decide when to load a skill. For the
full format specification, see [agentskills.io/specification](https://agentskills.io/specification).

## Scope

Skills in this repository focus on Elastic products and the Elastic stack:

- Interacting with Elasticsearch APIs (search, indexing, cluster management)
- Building and managing Kibana dashboards, saved objects, and visualizations
- Configuring Fleet policies, Elastic Agent integrations, and Beats pipelines
- Patterns for Elastic Observability, Elastic Security, and APM workflows

## Issues

Found a problem or have a suggestion? [Open an issue](https://github.com/elastic/agent-skills/issues/new) and we will
review it.

## Disclaimer

These skills are provided as-is. Always test skills thoroughly in your own environment before relying on them for
critical tasks.

## Ownership

This repository is maintained by the **Developer Tools Team** at Elastic.
