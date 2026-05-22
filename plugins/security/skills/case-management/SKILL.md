---
name: security-case-management
description: >
  Create, search, update, and manage SOC cases via the Kibana Cases API. Use when
  tracking incidents, linking alerts to cases, adding investigation notes, or managing
  triage output.
compatibility: >
  Requires Node.js 22+, network access to Kibana. Environment variables: KIBANA_URL,
  plus KIBANA_API_KEY or KIBANA_USERNAME/KIBANA_PASSWORD.
metadata:
  author: elastic
  version: 0.1.0
---

# Case Management

Manage SOC cases through the Kibana Cases API. All cases are scoped to `securitySolution` — this skill operates
exclusively within Elastic Security. Cases appear in Kibana Security and can be assigned to analysts, linked to alerts,
and pushed to external incident management systems via connectors.

## Prerequisites

Install dependencies before first use from the `skills/security` directory:

```bash
cd skills/security && npm install
```

Set the required environment variables (or add them to a `.env` file in the workspace root):

```bash
export KIBANA_URL="https://your-cluster.kb.cloud.example.com:443"
export KIBANA_API_KEY="your-kibana-api-key"
```

## When to use

- Creating a case after alert triage (classification, IOCs, findings)
- Searching for existing cases to correlate related alerts
- Adding investigation comments or attaching alerts to an existing case
- Updating case status or severity
- Listing recent cases for review

## When NOT to use

- Do not use this skill for Observability or Elasticsearch cases — it hardcodes `owner: securitySolution`
- Do not use for cases outside the Security solution space

## Execution rules

- Start executing tools immediately — do not read SKILL.md, browse the workspace, or list files first.
- Report tool output faithfully. Copy case IDs, titles, tags, severities, and counts exactly as returned by the API. Do
  not abbreviate case IDs, truncate titles, invent details, or round numbers.
- When the API returns zero results, state that explicitly — do not guess at possible results.
- When listing or finding cases, report the **exact total count** from the API response and present each case with its
  verbatim title, severity, and status.

## Quick start

All commands run from the workspace root. All output is JSON. Call the tools directly — do not read the skill file or
explore the workspace first. For attach-alert/attach-alerts, `--rule-id` and `--rule-name` are required by the Kibana
API (use `--rule-id unknown --rule-name unknown` if unknown). Use `attach-alerts` for batch with automatic rate-limit
retry and 2-second spacing between API calls.

## Common multi-step workflows

| Task                        | Tools to call (in order)                                                     |
| --------------------------- | ---------------------------------------------------------------------------- |
| **Create a case**           | `case_manager` create (title, description, tags, severity)                   |
| **Find cases for a host**   | `case_manager` find --tags "agent_id:\<id\>" or find --search "\<hostname\>" |
| **Attach alert to case**    | `case_manager` attach-alert (case-id, alert-id, alert-index, rule-id/name)   |
| **Add investigation notes** | `case_manager` add-comment (case-id, comment text)                           |
| **List recent open cases**  | `case_manager` list --status open --per-page \<n\>                           |
| **Update case**             | `case_manager` update (case-id, status/severity/tags changes)                |

**Finding cases for a host:** Use `find --search "<hostname>"` to search by hostname across title, description, and
comments. Alternatively use `find --tags "agent_id:<agent_id>"` if the agent ID is known. Always add `--status open` to
filter to active cases only. Report the exact `total` count and each case title verbatim from the API response.

```bash
# Create (syncAlerts enabled by default; disable with --sync-alerts false)
node skills/security/case-management/scripts/case-manager.js create --title "Malicious DLL sideloading on host1" --description "Crypto clipper malware detected via DLL sideloading..." --tags "classification:malicious" "confidence:88" "mitre:T1574.002" --severity critical --yes

# Find, list, get
node skills/security/case-management/scripts/case-manager.js find --tags "agent_id:550888e5-357d-4bc1-a154-486eb7b4e076"
node skills/security/case-management/scripts/case-manager.js find --search "DLL sideloading" --status open
node skills/security/case-management/scripts/case-manager.js list --status open --per-page 10
node skills/security/case-management/scripts/case-manager.js get --case-id <case_id>

# Attach single alert
node skills/security/case-management/scripts/case-manager.js attach-alert --case-id <case_id> --alert-id <alert_doc_id> --alert-index .ds-.alerts-security.alerts-default-2025.12.01-000013 --rule-id <rule_uuid> --rule-name "Malware Detection Alert"

# Attach multiple alerts (batch)
node skills/security/case-management/scripts/case-manager.js attach-alerts --case-id <case_id> --alert-ids <id1> <id2> <id3> --alert-index .ds-.alerts-security.alerts-default-2026.02.16-000016 --rule-id <rule_uuid> --rule-name "Malware Detection Alert"

# Add comment, update (--tags merges with existing tags, does not replace)
node skills/security/case-management/scripts/case-manager.js add-comment --case-id <case_id> --comment "Process tree analysis shows..."
node skills/security/case-management/scripts/case-manager.js update --case-id <case_id> --status closed --severity low --yes
```

Write operations (`create`, `update`) prompt for confirmation by default. Pass `--yes` to skip the prompt (required when
called by an agent).

## Reporting list and find results

When reporting results from `list` or `find`:

1. State the exact `total` count from the JSON response (e.g., "There are 12 open cases total").
2. Present each case as a compact one-line entry: `<title> | <severity> | <case_id_short> | <created_at>`. Copy the
   **exact title** verbatim from the `title` field — do not rephrase, abbreviate, or summarize.
3. If the user asked for N cases, present exactly N entries (or fewer if fewer exist). Do not add extra columns (alerts
   count, description, status) unless the user specifically requested them.
4. Do not add information beyond what the API returned. If a field is null or missing, omit it.
5. After presenting the results, stop. Do not add analysis, commentary, or observations about the cases.

## Tag conventions

Use structured tags for machine-searchable metadata:

| Tag pattern              | Example                             | Purpose                                          |
| ------------------------ | ----------------------------------- | ------------------------------------------------ |
| `classification:<value>` | `classification:malicious`          | Triage classification (benign/unknown/malicious) |
| `confidence:<score>`     | `confidence:85`                     | Confidence score 0-100                           |
| `mitre:<technique>`      | `mitre:T1574.002`                   | MITRE ATT&CK technique IDs                       |
| `agent_id:<id>`          | `agent_id:550888e5-...`             | Elastic agent ID for correlation                 |
| `rule:<name>`            | `rule:Malicious Behavior Detection` | Detection rule name                              |

## Case severity mapping

| Classification           | Kibana severity |
| ------------------------ | --------------- |
| benign (score 0-19)      | `low`           |
| unknown (score 20-60)    | `medium`        |
| malicious (score 61-80)  | `high`          |
| malicious (score 81-100) | `critical`      |

## Known limitations

### syncAlerts is security-only

The `syncAlerts` setting (enabled by default) synchronizes case status with attached alert statuses. This feature is
only available for Security Solution cases. Pass `--sync-alerts false` when creating a case if alert sync is not needed.

### Rate limiting

The Kibana API enforces rate limits. When attaching multiple alerts, the `attach-alerts` batch command automatically
handles 429 responses with retry. If using `attach-alert` one at a time, space calls ~10 seconds apart.

### `find --search` on Serverless

The `find --search` parameter may return 500 errors on Kibana Serverless deployments. Use `find --tags` for filtering
instead, or `list` to browse recent cases.

### `find --tags` requires exact match

Tag searches are exact-match only. `find --tags "agent_id:abc123"` works, but partial matches do not.

## Kibana Cases API reference

For detailed API endpoints, request/response formats, and examples, see
[references/kibana-cases-api.md](references/kibana-cases-api.md).

## Examples

- "Create a case for the phishing alert I triaged with severity high"
- "Search for open cases related to brute force attacks"
- "Add the investigation findings as a comment to case ID abc-123"

## Guidelines

- Report only tool output — do not invent IDs, hostnames, IPs, or details not present in the tool response.
- Preserve identifiers from the request — use exact values the user provides in tool calls and responses.
- Confirm actions concisely using the tool's return data.
- Distinguish facts from inference — label conclusions beyond tool output as your assessment.
- When presenting case lists or search results, copy the **exact title** from each case. Do not paraphrase, abbreviate,
  or summarize titles. Include the total count from the API `total` field.
- Start executing tools immediately. Do not read SKILL.md, browse directories, or list files before acting.

## Production use

- Write operations (`create`, `update`) prompt for confirmation. Pass `--yes` or `-y` to skip when called by an agent.
- Verify `KIBANA_URL` and `KIBANA_API_KEY` point to the intended cluster before running any command.
- Cases are scoped to `securitySolution` — this skill does not affect Observability or other Kibana case owners.

## Environment variables

| Variable         | Required | Description                                                      |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `KIBANA_URL`     | Yes      | Kibana base URL (e.g., `https://my-kibana.kb.cloud.example.com`) |
| `KIBANA_API_KEY` | Yes      | Kibana API key for authentication                                |
