# kibana-anomaly-detection

Claude Code plugin for Elastic ML anomaly detection — investigation, score explanation, and job operations via Kibana
Agent Builder MCP tools.

## What's included

A single Agent Skill (`SKILL.md` at the package root, frontmatter `name: kibana-anomaly-detection`) covering four modes:
**Investigate**, **Explain**, **Troubleshoot**, **Manage**. Domain-specific framing for security and observability lives
under `references/`.

**Kibana version:** Registration scripts are written for **Kibana 9.4+** (Agent Builder + Workflows). They use PUT for
idempotent updates when the API supports it and fall back to DELETE + POST on stacks without tool/skill PUT so repeated
`all register` runs stay safe.

**Kibana Agent Builder assets** (under `references/kibana/`):

- **24** ES|QL tool specs (`references/kibana/tools/esql/*.json`)
- **23** workflow YAML files (`references/kibana/workflows/*.yaml`)
- `scripts/kibana-agent-builder.mjs` — registers tools, workflows, and skills (Node.js 18+)

## Reference pages

| File                                                                                     | Purpose                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [score-reference.md](score-reference.md)                                                 | Score field definitions, bands, renormalization, explanation  |
| [anomaly-detection-functions.md](anomaly-detection-functions.md)                         | Detector function selection guide                             |
| [investigate-anomaly-esql-tools.md](investigate-anomaly-esql-tools.md)                   | Full ES\|QL templates for the Investigate mode                |
| [troubleshoot-anomaly-tool-reference.md](troubleshoot-anomaly-tool-reference.md)         | ES\|QL + workflow tool detail for the Troubleshoot mode       |
| [tools.md](tools.md) / [workflow-tools.md](workflow-tools.md)                            | Complete tool surface (ES\|QL and workflow)                   |
| [protocols/investigation.md](protocols/investigation.md)                                 | 14-step RCA protocol                                          |
| [worked-example.md](worked-example.md)                                                   | End-to-end investigation walkthrough                          |
| [job-creation-recipes.md](job-creation-recipes.md)                                       | `rare`, `high_mean`, `high_sum` job + datafeed recipes        |
| [permissions-matrix.md](permissions-matrix.md)                                           | Privileges by tool category                                   |
| [anomaly-detection-openapi-spec-discover.md](anomaly-detection-openapi-spec-discover.md) | Discover ML REST endpoints via `.kibana_ai_openapi_spec_*`    |
| [security-anomaly-expert.md](security-anomaly-expert.md)                                 | Threat-first framing (MITRE mappings, attack-chain protocol)  |
| [observability-anomaly-expert.md](observability-anomaly-expert.md)                       | SRE / reliability framing (degradation, capacity, regression) |

## Using this package from agent-skills-sandbox

This directory is part of the **agent-skills-sandbox** monorepo. There is **no** `install.sh` here — consume the skill
by pointing your Agent Skills configuration at `skills/kibana/kibana-anomaly-detection/` (single `SKILL.md` at the
package root). Restart your agent runtime after adding paths.

## Kibana Agent Builder setup

Requires Node.js 18+. Defaults to `elastic`/`changeme` when no credentials are supplied.

```bash
cd skills/kibana/kibana-anomaly-detection

# Local Kibana — credentials default to elastic/changeme (tools → workflows → skills)
node scripts/kibana-agent-builder.mjs all register --kibana-url http://localhost:5601

# HTTPS with self-signed cert (common for local deployments)
node scripts/kibana-agent-builder.mjs all register --kibana-url https://localhost:5601 --insecure
```

Environment-only flow (recommended):

```bash
cd skills/kibana/kibana-anomaly-detection
export KIBANA_URL=https://localhost:5601
export KIBANA_INSECURE=true
node scripts/kibana-agent-builder.mjs all register
```

Elastic Cloud (API key):

```bash
cd skills/kibana/kibana-anomaly-detection
export KIBANA_CLOUD_ID="<deployment_cloud_id>"
export KIBANA_API_KEY="<api_key>"
node scripts/kibana-agent-builder.mjs all register
```

`all register` runs `tools register`, `workflows register`, and `skills register`. The skill is posted with at most
**five** `tool_ids` (Kibana limit): tools detected from `SKILL.md` text first, then supplemental ids from the
registration script until the cap. Workflow-backed tools require Elastic Workflows (preview) where applicable;
exclusions live in **`scripts/agent_builder_constants.json`**.

**MCP API key permissions required:**

- Kibana: `read_onechat`, `space_read`
- Index: `read`, `view_index_metadata` on `.ml-anomalies-*`, `.ml-annotations-*`, `.ml-notifications-*`, `.ml-config`
- For source evidence: `read` on source data indices

## Layout (this repo)

```text
kibana-anomaly-detection/
├── SKILL.md                   # Single skill: Investigate / Explain / Troubleshoot / Manage modes
├── package.json               # Dev deps for the registration script
├── scripts/
│   ├── kibana-agent-builder.mjs
│   └── agent_builder_constants.json
└── references/
    ├── README.md
    ├── score-reference.md
    ├── anomaly-detection-functions.md
    ├── investigate-anomaly-esql-tools.md
    ├── troubleshoot-anomaly-tool-reference.md
    ├── job-creation-recipes.md
    ├── worked-example.md
    ├── permissions-matrix.md
    ├── tools.md
    ├── workflow-tools.md
    ├── security-anomaly-expert.md          # threat-first framing
    ├── observability-anomaly-expert.md     # SRE / reliability framing
    ├── protocols/investigation.md
    └── kibana/
        ├── tools/esql/
        └── workflows/
```
