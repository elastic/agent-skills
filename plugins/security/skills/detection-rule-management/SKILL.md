---
name: security-detection-rule-management
description: >
  Create, tune, and manage Elastic Security detection rules (SIEM and Endpoint). Use
  for false positives, exceptions, new coverage, noisy rules, or rule management via
  Kibana API.
compatibility: >
  Requires Node.js 22+, network access to Kibana and Elasticsearch. Environment variables:
  KIBANA_URL plus KIBANA_API_KEY or KIBANA_USERNAME/KIBANA_PASSWORD; ELASTICSEARCH_URL
  or ELASTICSEARCH_CLOUD_ID plus ELASTICSEARCH_API_KEY or ELASTICSEARCH_USERNAME/ELASTICSEARCH_PASSWORD.
metadata:
  author: elastic
  version: 0.1.0
---

# Detection Rule Management

Create new detection rules for emerging threats and coverage gaps, and tune existing rules to reduce false positives.
All operations use the Kibana Detection Engine API via `rule-manager.js`.

## Execution rules

- Start executing tools immediately — do not read SKILL.md, browse the workspace, or list files first.
- Report tool output faithfully. Copy rule IDs, names, alert counts, exception IDs, and error messages exactly as
  returned by the API. Do not abbreviate rule UUIDs, invent rule names, or round alert counts.
- When a tool returns an error (rule not found, API failure), report the exact error — do not guess at alternatives.

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

## Common multi-step workflows

| Task                                | Tools to call (in order)                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Tune noisy SIEM rule**            | `rule_manager` find/noisy-rules → `run_query` (investigate FPs) → `rule_manager` patch or add-exception |
| **Add endpoint behavior exception** | `fetch_endpoint_rule` (get rule definition from GitHub) → `add_endpoint_exception` (scoped to rule.id)  |
| **Create new detection rule**       | `run_query` (test query against data) → `rule_manager` create                                           |
| **Investigate rule alert volume**   | `rule_manager` get → `run_query` (query alerts index)                                                   |

For endpoint behavior rules, always fetch the rule definition first to understand query logic and existing exclusions
before adding an exception. For SIEM rules, always investigate alert patterns with `run_query` before tuning.

**Critical:** For endpoint behavior rules, always use `fetch_endpoint_rule` (not `shell` or direct script calls) to get
the rule definition, then use `add_endpoint_exception` to add the exception. These are dedicated tools — do not invoke
the underlying scripts manually.

## Workflow: Tune a rule for false positives

### Steps 1–2: Identify noisy rules and analyze false positives

Find noisy rules with `noisy-rules` or `find`, then get the rule definition and investigate alerts:

```bash
node skills/security/detection-rule-management/scripts/rule-manager.js noisy-rules --days 7 --top 20
node skills/security/detection-rule-management/scripts/rule-manager.js find --filter "alert.attributes.name:*Suspicious*" --brief
node skills/security/detection-rule-management/scripts/rule-manager.js get --id <rule_uuid>
node skills/security/alert-triage/scripts/run-query.js "kibana.alert.rule.name:\"<rule_name>\"" --index ".alerts-security.alerts-*" --days 7 --full
```

Look for patterns: same process/user/host → exception candidate; broad pattern → tighten query; legitimate software →
exception; too broad → rewrite or adjust threshold.

### Step 3: Choose a tuning strategy

**In order of preference:**

1. **Add exception** — Best for specific known-good processes, users, or hosts. Does not modify the rule query. Use when
   the rule is correct in general but fires on known-legitimate activity.

2. **Tighten the query** — Patch the rule's query to exclude the FP pattern. Best when the false positives stem from the
   query being too broad.

3. **Adjust threshold / alert suppression** — For threshold rules, increase the threshold value. For any rule type,
   enable alert suppression to reduce duplicate alerts on the same entity.

4. **Reduce risk score / severity** — Downgrade the rule's priority if it generates many low-value alerts but still has
   some detection value.

5. **Disable the rule** — Last resort. Only if the rule provides no value or is completely redundant with another rule.

### Steps 4–5: Apply tuning, verify, and document

**Add exception** (single/multi-condition, wildcard via `matches`):

```bash
node skills/security/detection-rule-management/scripts/rule-manager.js add-exception \
  --rule-uuid <rule_uuid> \
  --entries "process.executable:is:C:\\Program Files\\SCCM\\CcmExec.exe" "process.parent.name:is:CcmExec.exe" \
  --name "Exclude SCCM" --comment "FP: SCCM deployment" --tags "tuning:fp" "source:soc" --yes
```

**Patch query, threshold, severity, or disable:**

```bash
node skills/security/detection-rule-management/scripts/rule-manager.js patch --id <rule_uuid> --query "process.name:powershell.exe AND NOT process.parent.name:CcmExec.exe" --yes
node skills/security/detection-rule-management/scripts/rule-manager.js patch --id <rule_uuid> --max-signals 50 --yes
node skills/security/detection-rule-management/scripts/rule-manager.js patch --id <rule_uuid> --severity low --risk-score 21 --yes
node skills/security/detection-rule-management/scripts/rule-manager.js disable --id <rule_uuid> --yes
```

Write operations (`patch`, `enable`, `disable`, `delete`, `add-exception`, `bulk-action`) prompt for confirmation by
default. Pass `--yes` to skip the prompt (required when called by an agent).

Verify with `rule-manager.js get --id <rule_uuid>`. Update triage cases via the `case-management` skill.

---

## Workflow: Create new detection rule

### Steps 1–2: Define the threat, data sources, and fields

Specify MITRE ATT&CK technique(s), required data sources (Endpoint, Network, Cloud), and malicious vs legitimate
behavior. Common indexes: `logs-endpoint.events.process-*`, `logs-endpoint.events.network-*`,
`.alerts-security.alerts-*`, `logs-windows.*`, `logs-aws.*`. Key fields: `process.name`, `process.command_line`,
`process.parent.name`, `destination.ip`, `winlog.event_id`, `event.action`. Verify data with `run-query.js`:

```bash
node skills/security/alert-triage/scripts/run-query.js "process.name:certutil.exe" --index "logs-endpoint.events.process-*" --days 30 --size 5
```

### Step 3: Write and test the query

Rule types: `query` (KQL field matching), `eql` (event sequences), `esql` (aggregations), `threshold` (volume-based),
`threat_match` (IOC correlation), `new_terms` (first-seen). Test against Elasticsearch before creating:

```bash
node skills/security/alert-triage/scripts/run-query.js "process.name:certutil.exe AND process.command_line:(*urlcache* OR *decode*)" \
  --index "logs-endpoint.events.process-*" --days 30
```

For EQL, use `--query-file` to avoid shell escaping issues.

**Validate query syntax before creating or patching a rule.** The `validate-query` command catches common errors locally
— escaped backslashes, mismatched parentheses, unbalanced quotes, and duplicate boolean operators:

```bash
node skills/security/detection-rule-management/scripts/rule-manager.js validate-query \
  --query "process.name:taskkill.exe AND process.command_line:(*chrome.exe* OR *msedge.exe*)" --language kuery
```

The `create` and `patch` commands also run validation automatically and reject invalid queries. Pass `--skip-validation`
only if you are certain the query is correct despite triggering a check.

Common KQL syntax mistakes:

- **Escaped forward-slashes** — KQL wildcards use plain text. Write `*/IM chrome.exe*`, not `*\/IM chrome.exe*`.
- **Mismatched parentheses** — every `(` must have a matching `)`.
- **Unbalanced quotes** — every `"` must be paired.
- **Duplicate operators** — `AND AND` or `OR OR` is always an error.

### Step 4: Create the rule

```bash
node skills/security/detection-rule-management/scripts/rule-manager.js create \
  --name "Certutil URL Download or Decode" \
  --description "Detects certutil.exe used to download files or decode Base64 payloads, a common LOLBin technique." \
  --type query \
  --query "process.name:certutil.exe AND process.command_line:(*urlcache* OR *decode*)" \
  --index "logs-endpoint.events.process-*" \
  --severity medium --risk-score 47 \
  --tags "OS:Windows" "Tactic:Defense Evasion" "Tactic:Command and Control" \
  --false-positives "IT administrators using certutil for legitimate certificate operations" \
  --references "https://attack.mitre.org/techniques/T1140/" \
  --interval 5m --disabled
```

For complex rules (EQL sequences, MITRE mappings, alert suppression), use `create --from-file rule_definition.json` and
`--threat-file`. See [references/detection-api-reference.md](references/detection-api-reference.md) for schema.

### Step 5: Monitor and iterate

Monitor alert volume with `noisy-rules --days 3 --top 10` and tune false positives as needed.

---

## Workflow: Endpoint behavior rules tuning

Tune **Elastic Endpoint behavior rules** by adding **Endpoint exceptions** scoped to specific rules. Endpoint exceptions
live in **Security → Exceptions → Endpoint Security Exception List**, not under individual SIEM rules.

**Key principles:** Always fetch the rule definition from protections-artifacts first. Always scope exceptions to the
rule (`rule.id` or `rule.name`). Use full paths over process names. Run the mandatory entity cross-check (Step 4b)
before any exception. Simulate impact (Step 5b) and aim for ≥60% noise reduction.

**Scripts:** `fetch-endpoint-rule-from-github.js` (get rule TOML by id), `add-endpoint-exception.js` (add to Endpoint
Exception List; rule.id/rule.name required), `check-exclusion-best-practices.js`.

For the full step-by-step workflow (Steps 1–6), queries, and simulation templates, see
[references/endpoint-behavior-tuning-workflow.md](references/endpoint-behavior-tuning-workflow.md). For exclusion best
practices, see
[references/endpoint-rule-exclusion-best-practices.md](references/endpoint-rule-exclusion-best-practices.md).

---

## Tool reference

### rule-manager.js

All commands are run from the workspace root. All output is JSON unless noted.

| Command              | Description                                   |
| -------------------- | --------------------------------------------- |
| `find`               | Search/list rules with optional KQL filter    |
| `get`                | Get a rule by `--id` or `--rule-id`           |
| `create`             | Create a rule (inline flags or `--from-file`) |
| `patch`              | Patch specific fields on a rule               |
| `enable`             | Enable a rule                                 |
| `disable`            | Disable a rule                                |
| `delete`             | Delete a rule                                 |
| `export`             | Export rules as NDJSON                        |
| `bulk-action`        | Bulk enable/disable/delete/duplicate/edit     |
| `add-exception`      | Add an exception item to a rule               |
| `list-exceptions`    | List items on an exception list               |
| `create-shared-list` | Create a shared exception list                |
| `noisy-rules`        | Find noisiest rules by alert volume           |
| `validate-query`     | Check query syntax before create/patch        |

**Endpoint behavior tuning:** `fetch-endpoint-rule-from-github.js` (get rule TOML by id), `add-endpoint-exception.js`
(add to Endpoint Exception List; rule.id/rule.name required), `check-exclusion-best-practices.js`.

### Exception entry format

Pass entries as `field:operator:value`. Operators: `is`, `is_not`, `is_one_of`, `is_not_one_of`, `exists`,
`does_not_exist`, `matches`, `does_not_match`. Example: `process.name:is:svchost.exe`,
`file.path:matches:C:\\Program Files\\*`.

## Additional resources

- For full API schema details, see [references/detection-api-reference.md](references/detection-api-reference.md)
- For **endpoint behavior** tuning: [references/endpoint-exceptions-guide.md](references/endpoint-exceptions-guide.md),
  [references/endpoint-rule-exclusion-best-practices.md](references/endpoint-rule-exclusion-best-practices.md)
- For alert investigation during tuning, use the `alert-triage` skill
- For documenting tuning actions in cases, use the `case-management` skill

## Examples

- "Find the noisiest detection rules from the last 7 days and help me tune one"
- "Add an exception to exclude SCCM from the suspicious PowerShell rule"
- "Create a new detection rule for certutil URL download or decode"

## Guidelines

- **Report only tool output.** When summarizing results, quote or paraphrase only what the tools returned. Do not invent
  IDs, hostnames, IPs, scores, process trees, or other details not present in the tool response.
- **Preserve identifiers from the request.** If the user provides specific hostnames, agent IDs, case IDs, or other
  values, use those exact values in tool calls and responses — do not substitute different identifiers.
- **Confirm actions concisely.** After executing a tool, confirm what was done using the tool's return data. Do not
  fabricate internal IDs, metadata, or status details unless they appear in the tool response.
- **Distinguish facts from inference.** If you draw conclusions beyond what the tools returned (e.g., suggesting a MITRE
  technique based on observed behavior), clearly label those as your assessment rather than presenting them as tool
  output.
- **Start executing tools immediately.** Do not read SKILL.md, browse directories, or list files before acting.
- **Report tool output verbatim.** Copy rule IDs, names, alert counts, and error messages exactly as returned. Do not
  abbreviate UUIDs or round numbers.

## Production use

- All write operations (`create`, `patch`, `enable`, `disable`, `delete`, `add-exception`, `bulk-action`,
  `add-endpoint-exception`) prompt for confirmation. Pass `--yes` or `-y` to skip when called by an agent.
- **Endpoint exceptions suppress detections globally.** Always scope exceptions to a specific rule using `rule.id` or
  `rule.name` in the entries. A broad, unscoped exception can silently reduce detection coverage.
- Verify environment variables point to the intended cluster before running any script.
- Use `--dry-run` with `bulk-action` to preview impact before executing bulk changes.

## Environment variables

| Variable                | Required | Description                                     |
| ----------------------- | -------- | ----------------------------------------------- |
| `ELASTICSEARCH_URL`     | Yes      | Elasticsearch URL (for noisy-rules aggregation) |
| `ELASTICSEARCH_API_KEY` | Yes      | Elasticsearch API key                           |
| `KIBANA_URL`            | Yes      | Kibana URL (for rules API)                      |
| `KIBANA_API_KEY`        | Yes      | Kibana API key                                  |
