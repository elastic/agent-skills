---
name: security-alert-triage
description: >
  Triage Elastic Security alerts — gather context, classify threats, create cases,
  and acknowledge. Use when triaging alerts, performing SOC analysis, or investigating
  detections.
compatibility: >
  Requires Node.js 22+, network access to Elasticsearch. Environment variables: ELASTICSEARCH_URL
  or ELASTICSEARCH_CLOUD_ID, plus ELASTICSEARCH_API_KEY or ELASTICSEARCH_USERNAME/ELASTICSEARCH_PASSWORD.
metadata:
  author: elastic
  version: 0.1.0
---

# Alert Triage

Analyze Elastic Security alerts one at a time: gather context, classify, create a case, and acknowledge. This skill
depends on the `case-management` skill for case creation.

## Prerequisites

Install dependencies before first use from the `skills/security` directory:

```bash
cd skills/security && npm install
```

Set the required environment variables (or add them to a `.env` file in the workspace root):

```bash
export ELASTICSEARCH_URL="https://your-cluster.es.cloud.example.com:443"
export ELASTICSEARCH_API_KEY="your-api-key"
export KIBANA_URL="https://your-cluster.kb.cloud.example.com:443"
export KIBANA_API_KEY="your-kibana-api-key"
```

## Quick start

All commands from workspace root. Always fetch → investigate → document → acknowledge. Call the tools directly — do not
read the skill file or explore the workspace first.

```bash
node skills/security/alert-triage/scripts/fetch-next-alert.js
node skills/security/case-management/scripts/case-manager.js find --tags "agent_id:<id>"
node skills/security/alert-triage/scripts/run-query.js --query-file query.esql --type esql
node skills/security/case-management/scripts/case-manager.js create --title "..." --description "..." --tags "classification:..." "agent_id:<id>" --severity <level> --yes
node skills/security/case-management/scripts/case-manager.js attach-alert --case-id <id> --alert-id <id> --alert-index <index> --rule-id <uuid> --rule-name "<name>" --yes
node skills/security/alert-triage/scripts/acknowledge-alert.js --related --agent <id> --timestamp <ts> --window 60 --yes
```

## Common multi-step workflows

| Task                                 | Tools to call (in order)                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **End-to-end triage**                | `fetch_next_alert` → `run_query` (context) → `case_manager` create (case) → `acknowledge_alert` |
| **Gather context**                   | `run_query` (process tree, network, related alerts)                                             |
| **Create case after classification** | `case_manager` create → `case_manager` attach-alert                                             |
| **Acknowledge after triage**         | `acknowledge_alert` (related mode for batch)                                                    |

Always complete the full workflow: fetch → investigate → document → acknowledge. Do not stop after gathering context —
create or update a case with findings before acknowledging.

**Critical execution rules:**

- Start executing tools immediately — do not read SKILL.md, browse the workspace, or list files first.
- For ES|QL queries, write the query to a temporary `.esql` file then pass it via `--query-file`. Do not use `edit_file`
  — use a single `shell` call with `echo "..." > query.esql && node ... --query-file query.esql`.
- Keep context gathering focused: run 2-4 targeted queries (process tree, network, related alerts), not 10+.
- Report only what tools return. Copy identifiers verbatim — do not paraphrase IDs, timestamps, or hostnames.

## Critical principles

- **Do NOT classify prematurely.** Gather ALL context before deciding benign/unknown/malicious.
- **Most alerts are false positives**, even if they look alarming. Rule names like "Malicious Behavior" or severity
  "critical" are NOT evidence.
- **"Unknown" is acceptable** and often correct when evidence is insufficient.
- **MALICIOUS requires strong corroborating evidence**: persistence + C2, credential theft, lateral movement — not only
  suspicious API calls.
- **Report tool output verbatim.** Copy IDs, hostnames, timestamps, and counts exactly as returned by tools. Do not
  round numbers, abbreviate IDs, or paraphrase error messages.

## Workflow

When triaging multiple alerts, **group first, then triage each group**:

```text
- [ ] Step 0: Group alerts by agent/host and time window
- [ ] Step 1: Check existing cases
- [ ] Step 2: Gather full context (DO NOT SKIP)
- [ ] Step 3: Create or update case (only AFTER context gathered)
- [ ] Step 4: Acknowledge alert and all related alerts
- [ ] Step 5: Fetch next alert group and repeat
```

### Step 0: Group alerts before triaging

When the user asks about multiple open alerts, **group them first** to avoid redundant investigation: query open alerts,
group by `agent.id`, sub-group by time window (~5 min = likely one incident), triage each group as a single unit.

Use ES|QL for an overview (write to file first for PowerShell):

```esql
FROM .alerts-security.alerts-*
| WHERE kibana.alert.workflow_status == "open" AND @timestamp >= "<start>"
| STATS alert_count=COUNT(*), rules=VALUES(kibana.alert.rule.name) BY agent.id
| SORT alert_count DESC
```

For full query templates, see [references/classification-guide.md](references/classification-guide.md).

### Step 1: Check existing cases

Before creating a new case, check if this alert belongs to an existing one. Use the `case-management` skill:

```bash
node skills/security/case-management/scripts/case-manager.js find --tags "agent_id:<agent_id>"
node skills/security/case-management/scripts/case-manager.js cases-for-alert --alert-id <alert_id>
```

Look for cases with the same agent ID, user, or related detection rule within a similar time window.

> **Note:** `find --search` may return 500 errors on Serverless. Use `find --tags` or `list` instead.

### Step 2: Gather context

**This is the most important step. Do not skip or shortcut it.** Complete ALL substeps before forming any classification
opinion.

**Time range warning:** Alerts may be days or weeks old. NEVER use relative time like `NOW() - 1 HOUR`. Extract the
alert's `@timestamp` and build queries around that time with +/- 1 hour window.

**Substeps:** (2a) Related alerts on same agent/user; (2b) Rule frequency across env (high = FP-prone); (2c) Entity
context — process tree, network, registry, files; (2d) Behavior investigation — persistence, C2, lateral movement,
credential access.

Example — process tree (use ES|QL with `KEEP`; avoid `--full` which produces 10K+ lines):

```esql
FROM logs-endpoint.events.process-*
| WHERE agent.id == "<agent_id>" AND @timestamp >= "<alert_time - 5min>" AND @timestamp <= "<alert_time + 10min>"
  AND process.parent.name IS NOT NULL
  AND process.name NOT IN ("svchost.exe", "conhost.exe", "agentbeat.exe")
| KEEP @timestamp, process.name, process.command_line, process.pid, process.parent.name, process.parent.pid
| SORT @timestamp | LIMIT 80
```

| Data type | Index pattern                    |
| --------- | -------------------------------- |
| Alerts    | `.alerts-security.alerts-*`      |
| Processes | `logs-endpoint.events.process-*` |
| Network   | `logs-endpoint.events.network-*` |
| Logs      | `logs-*`                         |

For full query templates and classification criteria, see
[references/classification-guide.md](references/classification-guide.md).

### Step 3: Create or update case

After gathering context, create a case and attach alert(s). Use `--rule-id` and `--rule-name` (required; 400 error
without them):

```bash
node skills/security/case-management/scripts/case-manager.js create \
  --title "<concise summary>" \
  --description "<findings, IOCs, attack chain, MITRE techniques>" \
  --tags "classification:<benign|unknown|malicious>" "confidence:<0-100>" "mitre:<technique>" "agent_id:<id>" \
  --severity <low|medium|high|critical>

node skills/security/case-management/scripts/case-manager.js attach-alert \
  --case-id <case_id> --alert-id <alert_id> --alert-index <index> \
  --rule-id <rule_uuid> --rule-name "<rule name>"

# Multiple alerts: attach-alerts --alert-ids <id1> <id2>
# Add notes: add-comment --case-id <id> --comment "Findings..."
```

**Case description:** Summary (1-2 sentences); Attack chain; IOCs (hashes, IPs, paths); MITRE techniques; Behavioral
findings; Response context (remediation, credentials at risk).

### Step 4: Acknowledge alerts

Acknowledge ALL related alerts together. Use `--dry-run` first to confirm scope, then run without it:

```bash
# By host name — preferred when triaging a host
node skills/security/alert-triage/scripts/acknowledge-alert.js --query --host <hostname> --dry-run
node skills/security/alert-triage/scripts/acknowledge-alert.js --query --host <hostname> --yes

# By agent ID — preferred when agent.id is known
node skills/security/alert-triage/scripts/acknowledge-alert.js --related --agent <id> --timestamp <ts> --window 60 --dry-run
node skills/security/alert-triage/scripts/acknowledge-alert.js --related --agent <id> --timestamp <ts> --window 60 --yes
```

Increase `--window` for longer attack chains (e.g., `300` for 5 minutes). Report the exact count of acknowledged alerts
from the tool output. Pass `--yes` to skip the confirmation prompt (required when called by an agent).

### Step 5: Repeat

```bash
node skills/security/alert-triage/scripts/fetch-next-alert.js
```

## Tool reference

### fetch-next-alert.js

Fetches the oldest unacknowledged Elastic Security alert.

```bash
node skills/security/alert-triage/scripts/fetch-next-alert.js [--days <n>] [--json] [--full] [--verbose]
```

### run-query.js

Runs KQL or ES|QL queries against Elasticsearch.

**PowerShell warning**: ES|QL queries contain pipe characters (`|`) which PowerShell interprets as shell pipes. ALWAYS
use `--query-file` for ES|QL:

```bash
# Write query to file, then run
node skills/security/alert-triage/scripts/run-query.js --query-file query.esql --type esql
```

KQL queries without pipes can be passed directly:

```bash
node skills/security/alert-triage/scripts/run-query.js "agent.id:<id>" --index "logs-*" --days 7
```

| Arg                  | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `query`              | KQL query (positional)                                   |
| `--query-file`, `-q` | Read query from file (required for ES\|QL on PowerShell) |
| `--type`, `-t`       | `kql` or `esql` (default: kql)                           |
| `--index`, `-i`      | Index pattern (default: `logs-*`)                        |
| `--size`, `-s`       | Max results (default: 100)                               |
| `--days`, `-d`       | Limit to last N days                                     |
| `--json`             | Raw JSON output                                          |
| `--full`             | Full document source                                     |

### acknowledge-alert.js

Acknowledges alerts by updating `workflow_status` to `acknowledged`.

| Mode    | Command                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Single  | `node skills/security/alert-triage/scripts/acknowledge-alert.js <alert_id> --index <index> --yes`                                      |
| Related | `node skills/security/alert-triage/scripts/acknowledge-alert.js --related --agent <id> --timestamp <ts> [--window 60] --yes`           |
| By host | `node skills/security/alert-triage/scripts/acknowledge-alert.js --query --host <hostname> [--time-start <ts>] [--time-end <ts>] --yes` |
| Query   | `node skills/security/alert-triage/scripts/acknowledge-alert.js --query --agent <id> [--time-start <ts>] [--time-end <ts>] --yes`      |
| Dry run | Add `--dry-run` to any mode (no confirmation needed)                                                                                   |
| Confirm | All write modes prompt for confirmation; pass `--yes` to skip                                                                          |

## Examples

- "Fetch the next unacknowledged alert and triage it"
- "Investigate alert ID abc-123 — gather context, classify, and create a case if malicious"
- "Process the top 5 critical alerts from the last 24 hours"

## Guidelines

- Report only tool output — do not invent IDs, hostnames, IPs, or details not present in the tool response.
- Preserve identifiers from the request — use exact values the user provides in tool calls and responses.
- Confirm actions concisely using the tool's return data.
- Distinguish facts from inference — label conclusions beyond tool output as your assessment.

## Production use

- All write operations (`acknowledge-alert.js`) prompt for confirmation. Pass `--yes` or `-y` to skip when called by an
  agent.
- Use `--dry-run` before bulk acknowledgments to preview scope without modifying data.
- The acknowledge script uses the Kibana Detection Engine API, which is compatible with both self-managed and Serverless
  deployments.
- Verify environment variables point to the intended cluster before running any script — no undo for acknowledgments.

## Environment variables

| Variable                | Required | Description                          |
| ----------------------- | -------- | ------------------------------------ |
| `ELASTICSEARCH_URL`     | Yes      | Elasticsearch URL                    |
| `ELASTICSEARCH_API_KEY` | Yes      | Elasticsearch API key                |
| `KIBANA_URL`            | Yes      | Kibana URL (for case management)     |
| `KIBANA_API_KEY`        | Yes      | Kibana API key (for case management) |
