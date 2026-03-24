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

<!-- BEGIN-SKILL-TABLE -->

## Available Skills

<details>
<summary>Cloud (5)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [cloud-access-management](skills/cloud/access-management/SKILL.md) | Manage Elastic Cloud organization access: invite users, assign roles to Serverless projects, and create or revoke Cloud API keys. Use when granting, modifying, or auditing user access. | 0.1.0 | elastic |
| [cloud-create-project](skills/cloud/create-project/SKILL.md) | Creates Elastic Cloud Serverless projects (Elasticsearch, Observability, or Security) via the REST API, saves credentials to file, and bootstraps a scoped Elasticsearch API key. Use when creating a new serverless project, provisioning a search or observability environment, or spinning up a new Elastic Cloud project. | 0.1.0 | elastic |
| [cloud-manage-project](skills/cloud/manage-project/SKILL.md) | Manages existing Elastic Cloud Serverless projects: list, get, update, delete, reset credentials, resume, and load saved credentials. Connects to existing projects by resolving endpoints and acquiring scoped Elasticsearch API keys. Use when performing day-2 operations on serverless projects, connecting to an existing project, loading or resetting project credentials, or looking up project details. | 0.1.0 | elastic |
| [cloud-network-security](skills/cloud/network-security/SKILL.md) | Manage Serverless network security (traffic filters): create, update, and delete IP filters and AWS PrivateLink VPC filters. Use when restricting network access or configuring private connectivity. | 0.1.0 | elastic |
| [cloud-setup](skills/cloud/setup/SKILL.md) | Configures Elastic Cloud authentication and environment defaults. Use when setting up EC_API_KEY, configuring Cloud API access, or when another cloud skill requires credentials. | 0.1.0 | elastic |

</details>

<details>
<summary>Elasticsearch (7)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [elasticsearch-audit](skills/elasticsearch/elasticsearch-audit/SKILL.md) | Enable, configure, and query Elasticsearch security audit logs. Use when the task involves audit logging setup, event filtering, or investigating security incidents like failed logins. | 0.1.0 | elastic |
| [elasticsearch-authn](skills/elasticsearch/elasticsearch-authn/SKILL.md) | Authenticate to Elasticsearch using native, file-based, LDAP/AD, SAML, OIDC, Kerberos, JWT, or certificate realms. Use when connecting with credentials, choosing a realm, or managing API keys. Assumes the target realms are already configured. | 0.1.0 | elastic |
| [elasticsearch-authz](skills/elasticsearch/elasticsearch-authz/SKILL.md) | Manage Elasticsearch RBAC: native users, roles, role mappings, document- and field-level security. Use when creating users or roles, assigning privileges, or mapping external realms like LDAP/SAML. | 0.1.1 | elastic |
| [elasticsearch-esql](skills/elasticsearch/elasticsearch-esql/SKILL.md) | Execute ES\|QL (Elasticsearch Query Language) queries, use when the user wants to query Elasticsearch data, analyze logs, aggregate metrics, explore data, or create charts and dashboards from ES\|QL results. | 0.1.1 | elastic |
| [elasticsearch-file-ingest](skills/elasticsearch/elasticsearch-file-ingest/SKILL.md) | Ingest and transform data files (CSV/JSON/Parquet/Arrow IPC) into Elasticsearch with stream processing, custom transforms, and cross-version reindexing. Use when loading files, batch importing data, or migrating indices across versions — not for general ingest pipeline design or bulk API patterns. | 0.1.0 | elastic |
| [elasticsearch-onboarding](skills/elasticsearch/elasticsearch-onboarding/SKILL.md) | Help developers new to Elasticsearch get from zero to a working search experience. Guide them through understanding their intent, mapping their data, and building a search experience with best practices baked in. Use this when developers are new to Elasticsearch and need help getting started with their search use case. | 0.1.0 | elastic |
| [elasticsearch-security-troubleshooting](skills/elasticsearch/elasticsearch-security-troubleshooting/SKILL.md) | Diagnose and resolve Elasticsearch security errors: 401/403 failures, TLS problems, expired API keys, role mapping mismatches, and Kibana login issues. Use when the user reports a security error. | 0.1.0 | elastic |

</details>

<details>
<summary>Kibana (7)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [kibana-agent-builder](skills/kibana/agent-builder/SKILL.md) | Create and manage Agent Builder agents and custom tools in Kibana. Use when asked to create, update, delete, test, or inspect agents or tools in Agent Builder. | 0.2.0 | elastic |
| [kibana-alerting-rules](skills/kibana/kibana-alerting-rules/SKILL.md) | Create and manage Kibana alerting rules via REST API or Terraform. Use when creating, updating, or managing rule lifecycle (enable, disable, mute, snooze) or rules-as-code workflows. | 0.1.0 | elastic |
| [kibana-audit](skills/kibana/kibana-audit/SKILL.md) | Enable and configure Kibana audit logging for saved object access, logins, and space operations. Use when setting up Kibana audit, filtering events, or correlating Kibana and ES audit logs. | 0.1.0 | elastic |
| [kibana-connectors](skills/kibana/kibana-connectors/SKILL.md) | Create and manage Kibana connectors for Slack, PagerDuty, Jira, webhooks, and more via REST API or Terraform. Use when configuring third-party integrations or managing connectors as code. | 0.1.1 | elastic |
| [kibana-dashboards](skills/kibana/kibana-dashboards/SKILL.md) | Create and manage Kibana Dashboards and Lens visualizations. Use when you need to define dashboards and visualizations declaratively, version control them, or automate their deployment. | 0.1.0 | elastic |
| [kibana-vega](skills/kibana/kibana-vega/SKILL.md) | Create Vega and Vega-Lite visualizations with ES\|QL data sources in Kibana. Use when building custom charts, dashboards, or programmatic panel layouts beyond standard Lens charts. | 0.1.0 | elastic |
| [kibana-streams](skills/kibana/streams/SKILL.md) | List, inspect, enable, disable, and resync Kibana Streams via the REST API. Use when the user needs stream details, ingest/query settings, queries, significant events, or attachments. | 0.1.0 | elastic |

</details>

<details>
<summary>Observability (10)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [observability-edot-dotnet-instrument](skills/observability/edot-dotnet-instrument/SKILL.md) | Instrument a .NET application with the Elastic Distribution of OpenTelemetry (EDOT) .NET SDK for automatic tracing, metrics, and logs. Use when adding observability to a .NET service that has no existing APM agent. | 0.1.0 | elastic |
| [observability-edot-dotnet-migrate](skills/observability/edot-dotnet-migrate/SKILL.md) | Migrate a .NET application from the classic Elastic APM .NET agent to the EDOT .NET SDK. Use when switching from Elastic.Apm.* packages to Elastic.OpenTelemetry. | 0.1.0 | elastic |
| [observability-edot-java-instrument](skills/observability/edot-java-instrument/SKILL.md) | Instrument a Java application with the Elastic Distribution of OpenTelemetry (EDOT) Java agent for automatic tracing, metrics, and logs. Use when adding observability to a Java service that has no existing APM agent. | 0.1.1 | elastic |
| [observability-edot-java-migrate](skills/observability/edot-java-migrate/SKILL.md) | Migrate a Java application from the classic Elastic APM Java agent to the EDOT Java agent. Use when switching from elastic-apm-agent.jar to elastic-otel-javaagent.jar. | 0.1.1 | elastic |
| [observability-edot-python-instrument](skills/observability/edot-python-instrument/SKILL.md) | Instrument a Python application with the Elastic Distribution of OpenTelemetry (EDOT) Python agent for automatic tracing, metrics, and logs. Use when adding observability to a Python service that has no existing APM agent. | 0.1.0 | elastic |
| [observability-edot-python-migrate](skills/observability/edot-python-migrate/SKILL.md) | Migrate a Python application from the classic Elastic APM Python agent to the EDOT Python agent. Use when switching from elastic-apm to elastic-opentelemetry. | 0.1.0 | elastic |
| [observability-llm-obs](skills/observability/llm-obs/SKILL.md) | Monitor LLMs and agentic apps: performance, token/cost, response quality, and workflow orchestration. Use when the user asks about LLM monitoring, GenAI observability, or AI cost/quality. | 0.1.0 | elastic |
| [observability-logs-search](skills/observability/logs-search/SKILL.md) | Search and filter Observability logs using ES\|QL. Use when investigating log spikes, errors, or anomalies; getting volume and trends; or drilling into services or containers during incidents. | 0.2.0 | elastic |
| [observability-manage-slos](skills/observability/manage-slos/SKILL.md) | Create and manage SLOs in Elastic Observability using the Kibana API. Use when defining SLIs, setting error budgets, or managing SLO lifecycle. | 0.2.0 | elastic |
| [observability-service-health](skills/observability/service-health/SKILL.md) | Assess APM service health using SLOs, alerts, ML, throughput, latency, error rate, and dependencies. Use when checking service status, performance, or when the user asks about service health. | 0.1.0 | elastic |

</details>

<details>
<summary>Security (4)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [security-alert-triage](skills/security/alert-triage/SKILL.md) | Triage Elastic Security alerts — gather context, classify threats, create cases, and acknowledge. Use when triaging alerts, performing SOC analysis, or investigating detections. | 0.1.0 | elastic |
| [security-case-management](skills/security/case-management/SKILL.md) | Create, search, update, and manage SOC cases via the Kibana Cases API. Use when tracking incidents, linking alerts to cases, adding investigation notes, or managing triage output. | 0.1.0 | elastic |
| [security-detection-rule-management](skills/security/detection-rule-management/SKILL.md) | Create, tune, and manage Elastic Security detection rules (SIEM and Endpoint). Use for false positives, exceptions, new coverage, noisy rules, or rule management via Kibana API. | 0.1.0 | elastic |
| [security-generate-security-sample-data](skills/security/generate-security-sample-data/SKILL.md) | Generate sample security events, attack scenarios, and synthetic alerts for Elastic Security. Use when demoing, populating dashboards, testing detection rules, or setting up a POC. | 0.1.0 | elastic |

</details>

<!-- END-SKILL-TABLE -->

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
