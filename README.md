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
<summary>Cloud (2)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [cloud-onboarding](skills/cloud/onboarding/SKILL.md) | Onboard an Elastic Cloud organization: configure the `elastic` CLI's Cloud context and API key, establish a default region, then invite users, assign predefined or custom Serverless project roles, and create or revoke Cloud API keys. Use when setting up Cloud authentication or when granting, modifying, or auditing user access to an organization and its projects. | 0.3.0 | elastic |
| [cloud-provisioning](skills/cloud/provisioning/SKILL.md) | Provision and operate Elastic Cloud infrastructure: create, connect to, update, and delete Serverless projects (Elasticsearch, Observability, Security); manage traffic filters (IP and AWS PrivateLink network security); and manage the lifecycle of Elastic Cloud Hosted deployments. Use when creating or performing day-2 operations on serverless projects or hosted deployments, or restricting their network access. | 0.3.0 | elastic |

</details>

<details>
<summary>Elasticsearch (10)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [elasticsearch-anomaly-detection](skills/elasticsearch/elasticsearch-anomaly-detection/SKILL.md) | Create and manage Elastic ML anomaly detection jobs via the API. Use when setting up jobs on an index or data stream, configuring jobs and datafeeds, or opening, starting, or stopping them. | 1.1.0 | elastic |
| [elasticsearch-anomaly-detection-explainer](skills/elasticsearch/elasticsearch-anomaly-detection-explainer/SKILL.md) | Explain Elasticsearch ML anomaly detection scores, model behavior, and result interpretation. Use when the user asks why a score is high or low, how the model learns, what the numbers mean, or how to troubleshoot unexpected anomaly scores. | 0.3.0 | elastic |
| [elasticsearch-cluster-health](skills/elasticsearch/elasticsearch-cluster-health/SKILL.md) | Diagnose a non-green Elasticsearch cluster and surface the single most likely cause with remediation. Use when an operator reports yellow or red status, unassigned shards, allocation failures, or wants read-only triage before deeper investigation. Teaches replica-vs-primary impact, allocation decider classification, and data-loss awareness. | 0.1.0 | elastic |
| [elasticsearch-esql](skills/elasticsearch/elasticsearch-esql/SKILL.md) | Execute ES\|QL (Elasticsearch Query Language) queries, use when the user wants to query Elasticsearch data, analyze logs, aggregate metrics, explore data, or create charts and dashboards from ES\|QL results. | 0.7.0 | elastic |
| [elasticsearch-index-design](skills/elasticsearch/elasticsearch-index-design/SKILL.md) | Design and review Elasticsearch index mappings for stated access patterns: correct field types, text+keyword multi-fields, doc_values tuning, mapping-explosion avoidance, and explicit shard settings. Use when creating a new index, reviewing a mapping for storage or query performance, fixing wrong field types, or when the user asks which type to use for search, filter, sort, or aggregation on a field. | 0.1.0 | elastic |
| [elasticsearch-ingest](skills/elasticsearch/elasticsearch-ingest/SKILL.md) | Load CSV and JSON files into Elasticsearch indices using the bulk API and explicit mappings when field types matter. Use when batch-importing local files, converting CSV rows or JSON arrays to NDJSON bulk format, or verifying document counts and mappings after ingest — not for Logstash pipelines, Beats, custom scripts, or index-to-index reindex. | 0.1.0 | elastic |
| [elasticsearch-onboarding](skills/elasticsearch/elasticsearch-onboarding/SKILL.md) | Help developers new to Elasticsearch get from zero to a working search experience. Guide them through understanding their intent, mapping their data, and building a search experience with best practices baked in. Use this when the user shows intent to build search-related functionality, asks about Elasticsearch-related concepts for their use case, or expresses the need for help getting started with Elasticsearch. | 0.1.0 | elastic |
| [elasticsearch-query-optimization](skills/elasticsearch/elasticsearch-query-optimization/SKILL.md) | Diagnose slow Elasticsearch Query DSL searches and propose measured fixes. Use when a search is slow, profile output shows an expensive clause, exact-match filters sit in scoring context, or leading wildcards dominate latency. Ground every recommendation in search profiling — move non-scoring clauses to filter context, eliminate leading wildcards, and re-profile to confirm improvement. | 0.1.0 | elastic |
| [elasticsearch-reindex](skills/elasticsearch/elasticsearch-reindex/SKILL.md) | Guide Elasticsearch reindex for performance: local and remote, slicing, throttling, task API. Use when copying or migrating indices, changing mappings, or transforming during reindex. | 0.2.0 | elastic |
| [elasticsearch-search-relevance](skills/elasticsearch/elasticsearch-search-relevance/SKILL.md) | Improve Elasticsearch search relevance for content and catalog indices: pin or promote results with query rules (correct rule type, criteria, and rule-query wiring) and tune organic ranking with multi_match, field boosts, and analysis grounded in the index mapping. Use when search results rank poorly, a specific document must appear first for a query, or the user asks to tune full-text matching — not for ES\|QL analytics, index ingest, or cluster health. | 0.1.0 | elastic |

</details>

<details>
<summary>Kibana (5)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [kibana-agent-builder](skills/kibana/kibana-agent-builder/SKILL.md) | Create and manage Kibana Agent Builder agents and custom tools. Use when asked to create, update, delete, test, or inspect agents or tools in Agent Builder, or when the user wants to understand what agents or tools already exist. | 0.3.0 | elastic |
| [kibana-alerting-rules](skills/kibana/kibana-alerting-rules/SKILL.md) | Create and manage Kibana alerting rules. Use when creating, updating, or managing rule lifecycle (enable, disable, mute, snooze), choosing metric threshold rule types and params, or read-only find/list with tag filters. | 0.3.0 | elastic |
| [kibana-anomaly-detection](skills/kibana/kibana-anomaly-detection/SKILL.md) | Elastic ML anomaly detection — investigation/RCA, score explanation, job lifecycle troubleshooting, and job operations. Use when answering "what broke?"/"which entity?"/RCA, "why is score high/low?"/renormalization, "datafeed stopped"/"memory limit"/hard_limit, or configuring ML anomaly detection jobs. Reads results from `.ml-anomalies-*` and job state from ML REST APIs. | 0.3.0 | elastic |
| [kibana-dashboards](skills/kibana/kibana-dashboards/SKILL.md) | Create and manage Kibana Dashboards and Lens visualizations. Use when you need to define dashboards and visualizations declaratively, version control them, or automate their deployment. | 0.3.0 | elastic |
| [kibana-workflows](skills/kibana/kibana-workflows/SKILL.md) | Author, validate, test, run, and inspect Elastic Workflow YAML definitions. Use when the user wants to turn natural language into a Kibana workflow, fix workflow YAML, understand triggers or steps, or run a quick test loop against a real Kibana. | 0.5.0 | elastic |

</details>

<details>
<summary>Observability (5)</summary>

| Skill | Description | Version | Author |
| ----- | ----------- | ------- | ------ |
| [observability-k8s-investigation](skills/observability/k8s-investigation/SKILL.md) | Investigate Kubernetes workload, node, and control-plane issues using OTel telemetry (EDOT). Use when diagnosing pod failures (CrashLoopBackOff, OOMKilled, Error), node pressure, resource exhaustion, image pull failures, admission rejections, autoscaling anomalies, or correlating K8s state with application signals. OTel ingest path only — the legacy ECS Kubernetes integration shape is out of scope. | 0.5.1 | elastic |
| [observability-llm-obs](skills/observability/llm-obs/SKILL.md) | Answer questions about LLM and agentic-application behavior from data already ingested into Elastic: latency and error rate, token and cost utilization, response quality and guardrail events, and agentic call-chain orchestration. Use when the user asks about LLM monitoring, GenAI observability, token spend or AI cost, model latency, prompt or guardrail failures, or how an agent's tool-call chain executed. | 0.3.1 | elastic |
| [observability-onboarding](skills/observability/onboarding/SKILL.md) | Onboard an application into Elastic Observability with the Elastic Distribution of OpenTelemetry (EDOT): route on language and runtime, detect and replace a classic Elastic APM agent, apply the required OTLP configuration, and then verify with ES\|QL that traces, metrics, and logs actually arrive under the expected service name. Use when adding observability to a service, migrating off the classic Elastic APM agent, or debugging why an instrumented service is not showing up in Elastic. | 0.3.0 | elastic |
| [observability-service-reliability](skills/observability/service-reliability/SKILL.md) | Design and operate service reliability targets in Elastic Observability: choose an SLI type and a defensible target, pick a time window and budgeting method, create and maintain SLOs through the Kibana API, attach burn-rate alert rules, and decide when an SLO is the wrong instrument and a threshold rule, anomaly job, or synthetics monitor is right. Use when defining or reviewing SLOs and error budgets, tuning burn-rate alerting, reducing alert noise, or setting up availability monitoring for a user-facing endpoint. | 0.4.1 | elastic |
| [observability-sre-triage](skills/observability/sre-triage/SKILL.md) | Triage a degraded or suspect service end to end: read SLO status and burn rate, check active alerting rules and ML anomalies, measure throughput, latency, and error rate, assess dependency health and infrastructure saturation, and funnel logs down to the failures that explain it. Use when someone asks whether a service is healthy, why it is slow or erroring, what is in its logs, or which attribute distinguishes the requests that are failing. Also use when someone asks for the query behind any of those signals — throughput, latency percentiles, error rate, dependency health, or log volume — over APM/OTel traces, metrics, or logs. | 0.5.1 | elastic |

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

### GitHub Copilot CLI

GitHub Copilot CLI has a native plugin system. Add this repository as a marketplace source:

```sh
copilot plugin marketplace add elastic/agent-skills
```

Once added, install individual plugins by name:

```sh
copilot plugin install elasticsearch@elastic-agent-skills
copilot plugin install kibana@elastic-agent-skills
copilot plugin install observability@elastic-agent-skills
copilot plugin install security@elastic-agent-skills
copilot plugin install cloud@elastic-agent-skills
```

Or browse available plugins interactively inside a Copilot session:

```
/plugin list
```

### npx (Recommended)

The fastest way to install skills is with the [`skills`](https://github.com/vercel-labs/skills) CLI. No need to clone this repository — just run:

```sh
npx skills add elastic/agent-skills
```

This launches an interactive prompt to select skills and [target agents](https://github.com/vercel-labs/skills?tab=readme-ov-file#supported-agents). The CLI copies each skill folder into the correct location for the agent to discover.

Install a specific skill by name:

```sh
npx skills add elastic/agent-skills --skill elasticsearch-esql
```

Or use the `@` shorthand to specify the skill directly as `repo@skill` (equivalent to `--skill`):

```sh
npx skills add elastic/agent-skills@elasticsearch-esql
```

Install to specific agents (see [supported agents](https://github.com/vercel-labs/skills?tab=readme-ov-file#supported-agents)):

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
| `-a, --agent`     | Target specific agents (see [Supported agents](https://github.com/vercel-labs/skills?tab=readme-ov-file#supported-agents)) |
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

### GitHub Copilot CLI

Update all installed plugins to their latest versions:

```sh
copilot plugin update
```

Update a specific plugin:

```sh
copilot plugin update elasticsearch
```

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
