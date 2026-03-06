<p align="center">
  <img alt="Elastic logo" src="https://www.elastic.co/static-res/images/elastic-logo-200.png" width="200">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
</p>

# Agent Skills

Official Elastic skills for AI agent runtimes, built on the [Agent Skills](https://agentskills.io/) open standard.

## About

This repository contains curated skills that help AI agents work with the Elastic stack — Elasticsearch, Kibana,
Logstash, Beats, Fleet, APM, Elastic Security, Elastic Observability, and more. Skills are folders of instructions,
scripts, and resources that agents load dynamically to improve performance on specialized tasks.

## What Are Skills?

Skills are self-contained packages that give AI agents the knowledge and tools to complete specific tasks in a repeatable
way. Each skill lives in its own folder with a `SKILL.md` file containing metadata and instructions the agent follows.

For more background on the Agent Skills standard, see [agentskills.io](http://agentskills.io/).

<!-- vale off -->
<!-- BEGIN-SKILL-TABLE -->
<!-- END-SKILL-TABLE -->
<!-- vale on -->

## Installation

### npx (recommended)

The fastest way to install skills is with the `skills` CLI:

```sh
npx skills add -a <agent>
```

Replace `<agent>` with your agent runtime (e.g. `claude-code`, `cursor`, `codex`, `windsurf`, `roo`, `cline`,
`github-copilot`, `gemini-cli`, `opencode`). This copies the skill folders into the correct location for the agent to
discover.

Install specific skills by name:

```sh
npx skills add -a cursor elasticsearch-esql
```

Install to multiple agents at once:

```sh
npx skills add -a cursor -a claude-code
```

### Bash script (npx not available)

For environments without Node.js or npx, the repository includes a standalone bash installer at
[`scripts/install-skills.sh`](scripts/install-skills.sh). Clone this repo and run:

```sh
git clone https://github.com/elastic/agent-skills.git
cd agent-skills
./scripts/install-skills.sh add -a <agent>
```

The script requires only bash 3.2+ and standard Unix utilities (`awk`, `find`, `cp`, `rm`, `mkdir`).

Common options:

| Flag              | Description                           |
| ----------------- | ------------------------------------- |
| `-a, --agent`     | Target agent (repeatable)             |
| `-s, --skill`     | Install specific skill(s) by name     |
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

## Skill Format

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
