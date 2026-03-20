<p align="center">
  <img alt="Elastic logo" src="https://www.elastic.co/static-res/images/elastic-logo-200.png" width="200">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
</p>

# Elastic Agent Skills

Elastic Agent Skills — built by the people who built Elastic — deliver native platform expertise directly to your AI coding agent. This is the official Agent Skills library, compatible with agentic IDEs such as Cursor, GitHub Copilot, Windsurf, Gemini CLI, and more. Skills follow the [Agent Skills](https://agentskills.io/) open standard.

> [!NOTE]
> **Technical Preview**
>
> These skills are in early release and under active development. Expect changes as skills are codified with robust
> evaluations and as the model landscape evolves. Check back frequently for updates.

## About

This repository contains curated skills that are packages of instructions, context, and tooling that teach any AI agent how to correctly work with Elasticsearch, Kibana, Elastic Observability, and Elastic Security. Drop them into the agent runtime you already use, and your assistant stops using outdated patterns and starts getting it right.

## What are skills?

Skills are self-contained packages that give AI agents the knowledge and tools to complete specific tasks in a repeatable way. Each skill lives in its own folder with a `SKILL.md` file containing metadata and instructions the agent follows.

For more background on the Agent Skills standard, see [agentskills.io](http://agentskills.io/).

## Scope

Skills in this repository focus on:

- Interacting with Elasticsearch APIs (search, indexing, cluster management)
- Building and managing Kibana content such as alerts, connectors, and more
- Patterns for Elastic Observability, Elastic Security, and Agent Builder

## Security considerations

AI coding agents operate with real credentials, real shell access, and often the full permissions of the user running them. When those agents are pointed at security workflows, the stakes are higher. That warrants a frank conversation about risk before you get started.

- **Conduct your own threat modeling.** Evaluate what data the agent can access, what actions it can take, and what happens if it behaves unexpectedly. [CISA's joint guidance on deploying AI systems securely](https://www.cisa.gov/news-events/alerts/2024/04/15/joint-guidance-deploying-ai-systems-securely) is a good starting point.
- **Be aware of what data flows through the agent.** Security data can contain PII, credentials embedded in command lines, and other regulated data. When an agent queries alerts or process events, that content enters the model's context and may be sent to a third-party API. Involve your infosec and compliance teams early.
- **These agents process attacker-controlled input.** Alerts, event fields, and file contents regularly contain strings crafted by attackers. Prompt injection is not theoretical here; it is an inherent property of the operating environment. Research like [Brainworm](https://www.originhq.com/blog/brainworm) demonstrates that agent context files alone can serve as a persistence mechanism for promptware.
- **Scope privileges tightly.** Give API keys the minimum privileges required. Broad response privileges are particularly dangerous. Read-only access is a good default until you've validated behavior.
- **Restrict agent tool access and network reach.** Most AI coding agents ship with broad defaults: shell execution, file system writes, internet access. Reducing the available tool surface limits what a compromised or misdirected agent can do.
- **Start in non-production environments.** Use a Serverless trial project, dev cluster, or isolated Kibana space to evaluate skills before connecting them to anything carrying live security data.

These skills are open source precisely so you can audit what they do. We encourage you to read them before you run them.

## Getting started

You can install Elastic skills using the Claude Code native plugin system, the `skills` CLI with `npx`, or by cloning this repository and running the bundled installer script. The `npx` method requires `Node.js` with `npx` available in your environment.

> [!TIP]
> **Don't install every skill.** Each installed skill adds routing context that your agent evaluates on every request. Install the **cloud** and **elasticsearch** auth skills — most other skills depend on them — then add only the skills relevant to your workflow. Keeping the installed set focused avoids context bloat and helps the agent route to the right skill reliably.

### Claude Code plugin (Recommended for Claude Code users)

Claude Code has a native plugin system that manages skills directly. Start by adding this repository as a marketplace source:

```sh
claude plugin marketplace add https://github.com/elastic/agent-skills
```

Once added, install individual plugins by name:

```sh
claude plugin install elastic-elasticsearch@elastic-agent-skills
claude plugin install elastic-kibana@elastic-agent-skills
claude plugin install elastic-observability@elastic-agent-skills
claude plugin install elastic-security@elastic-agent-skills
claude plugin install elastic-cloud@elastic-agent-skills
```

> [!NOTE]
> After installing, skills may not appear immediately when running `/reload-plugins`. This is a known Claude Code issue — restart your Claude Code session to pick up newly installed plugins.

Or use the interactive plugin browser inside any Claude Code session:

```
/plugins
```

This opens a menu to browse available plugins from all configured marketplaces, select what to install, and manage what is already installed.

### npx (Recommended)

The fastest way to install skills is with the [`skills`](https://github.com/vercel-labs/skills) CLI. No need to clone this repository — just run:

```sh
npx skills add elastic/agent-skills
```

This launches an interactive prompt to select skills and target agents. The CLI copies each skill folder into the correct location for the agent to discover.

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
| `-a, --agent`     | Target specific agents                            |
| `-s, --skill`     | Install specific skills by name                   |
| `-g, --global`    | Install to user home instead of project directory |
| `-y, --yes`       | Skip confirmation prompts                         |
| `--all`           | Install all skills to all agents without prompts  |
| `--list`          | List available skills without installing          |

### Local clone

If you prefer to work from a local checkout, or your environment does not have Node.js / npx, clone the repository and use the bundled bash installer:

```sh
git clone https://github.com/elastic/agent-skills.git
cd agent-skills
./scripts/install-skills.sh add -a <agent>
```

The script requires bash 3.2+ and standard Unix utilities (`awk`, `find`, `cp`, `rm`, `mkdir`).

| Flag              | Description                           |
| ----------------- | ------------------------------------- |
| `-a, --agent`     | Target agent (repeatable)             |
| `-s, --skill`     | Install specific skills by name       |
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
| pi              | `.pi/agent/skills`       |
| windsurf        | `.windsurf/skills`        |
| roo             | `.roo/skills`             |
| cline           | `.agents/skills`          |
| github-copilot  | `.agents/skills`          |
| gemini-cli      | `.agents/skills`          |

## Updating skills

The update process depends on how the skills were installed.

### Claude Code plugin

Update all installed plugins to their latest versions:

```sh
claude plugin update
```

Update a specific plugin:

```sh
claude plugin update elastic-elasticsearch
```

To keep plugins up to date automatically, enable auto-update using `/plugins` within Claude Code.

When auto-update is on, Claude Code checks for new plugin versions at startup and updates in the background.

### npx

Check whether any installed skills have changed upstream:

```sh
npx skills check
```

Pull the latest versions of all installed skills:

```sh
npx skills update
```

The CLI tracks each skill's source repository and a content hash in a lock file. `check` compares your local hashes against GitHub; `update` re-downloads anything that has drifted.

> **Tip:** The default npx installation uses symlinks, so every agent points to a single canonical copy. Updating once refreshes all agents at the same time.

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

The `description` field is the sole trigger mechanism — agent runtimes read it to decide when to load a skill. For the full format specification, see [agentskills.io/specification](https://agentskills.io/specification).

## Issues

Found a problem or have a suggestion? [Open an issue](https://github.com/elastic/agent-skills/issues/new) and we will review it.

## Disclaimer

These skills are provided as-is. Always test skills thoroughly in your own environment before relying on them for critical tasks.
