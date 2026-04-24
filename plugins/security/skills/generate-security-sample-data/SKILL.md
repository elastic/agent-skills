---
name: security-generate-security-sample-data
description: >
  Generate sample security events, attack scenarios, and synthetic alerts for Elastic
  Security. Use when demoing, populating dashboards, testing detection rules, or setting
  up a POC.
compatibility: >
  Requires Node.js 22+, network access to Kibana and Elasticsearch. Environment variables:
  KIBANA_URL plus KIBANA_API_KEY or KIBANA_USERNAME/KIBANA_PASSWORD; ELASTICSEARCH_URL
  or ELASTICSEARCH_CLOUD_ID plus ELASTICSEARCH_API_KEY or ELASTICSEARCH_USERNAME/ELASTICSEARCH_PASSWORD.
metadata:
  author: elastic
  version: 0.1.0
---

# Generate Security Sample Data

Generate ECS-compliant security events, multi-step attack scenarios, and synthetic alert documents that populate Elastic
Security dashboards, the Alerts tab, and Attack Discovery.

## Quick start

For a zero-friction experience that generates everything and opens Kibana:

```bash
node skills/security/generate-security-sample-data/scripts/demo-walkthrough.js
```

## Workflow

```text
- [ ] Step 1: Set environment variables
- [ ] Step 2: Generate sample data
- [ ] Step 3: Explore in Kibana
- [ ] Step 4: Clean up when done
```

### Step 1: Set environment variables

```bash
export ELASTICSEARCH_URL="https://your-project.es.region.aws.elastic.cloud"
export ELASTICSEARCH_USERNAME="admin"
export ELASTICSEARCH_PASSWORD="your-password"
export KIBANA_URL="https://your-project.kb.region.aws.elastic.cloud"
```

### Step 2: Generate sample data

#### Generate everything at once

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js \
  system endpoint okta aws windows --scenarios --alerts
```

#### Generate only events

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js \
  system endpoint --count 100
```

#### Generate only attack scenarios

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js --scenarios
```

#### Generate only synthetic alerts

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js --alerts
```

### Step 3: Explore in Kibana

After generating data, direct the user to these pages:

- **Security > Alerts** — synthetic alerts with MITRE ATT&CK mappings
- **Security > Attack Discovery** — requires an LLM connector to analyze alerts
- **Security > Hosts** — host activity from sample events
- **Security > Overview** — summary of all security data
- **Discover** — raw events across all data streams

### Step 4: Clean up when done

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js --cleanup
```

## What gets generated

Sample data spans 5 packages (system, endpoint, windows, aws, okta) and 4 focused attack scenarios covering the most
common demo themes: Windows credential theft, AWS cloud privilege escalation, Okta identity takeover, and a full
ransomware kill chain. Synthetic alert documents are indexed into `.alerts-security.alerts-default` with MITRE ATT&CK
mappings, severity levels, and risk scores.

All events use RFC 5737 / RFC 2606 safe addresses. For full tables of packages, scenarios, and alerts see
[references/sample-data-reference.md](references/sample-data-reference.md).

## Continuous mode

Stream events to simulate a live environment:

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js \
  --continuous --interval 15
```

Every 5th batch includes an attack scenario; every 10th batch adds synthetic alerts. Press Ctrl+C to stop.

## Tool reference

### sample-data.js

| Flag              | Description                                      |
| ----------------- | ------------------------------------------------ |
| `--count`, `-n`   | Events per package (default: 50)                 |
| `--scenarios`     | Run all attack simulation scenarios              |
| `--scenario NAME` | Run a specific scenario                          |
| `--alerts`        | Generate synthetic alert documents               |
| `--cleanup`       | Remove all sample data and alerts                |
| `--continuous`    | Stream live events (Ctrl+C to stop)              |
| `--interval N`    | Seconds between continuous batches (default: 30) |
| `--json`, `-j`    | Output results as JSON                           |
| `--yes`, `-y`     | Skip confirmation prompts                        |

### demo-walkthrough.js

Zero-friction runner that generates everything and opens Kibana.

| Flag           | Description                           |
| -------------- | ------------------------------------- |
| `--cleanup`    | Remove all sample data, alerts, case  |
| `--continuous` | Generate then stream live events      |
| `--count N`    | Events per package (default: 50)      |
| `--interval N` | Seconds between batches (default: 30) |

## Examples

### Quick demo for a stakeholder

> "Set up a demo environment so I can show Attack Discovery to my VP."

```bash
node skills/security/generate-security-sample-data/scripts/demo-walkthrough.js
```

### Targeted scenario testing

> "Generate only the ransomware attack chain to test our detection rules."

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js \
  --scenario ransomwareChain --alerts
```

### Simulating a live SOC

> "Keep generating events so the dashboards stay active during the demo."

```bash
node skills/security/generate-security-sample-data/scripts/demo-walkthrough.js --continuous
```

### Cleaning up after a demo

> "Remove all sample data from my project."

```bash
node skills/security/generate-security-sample-data/scripts/sample-data.js --cleanup
```

## Guidelines

- All generated documents are tagged with `tags: ["elastic-security-sample-data"]` for safe cleanup. The cleanup command
  only deletes documents with this marker.
- If marker fields are not indexed in a data stream, cleanup falls back to scanning `_source.tags` for matching sample
  documents from the last 14 days.
- Synthetic alerts are indexed directly into `.alerts-security.alerts-default` — they do not require detection rules to
  be installed or enabled.
- Attack Discovery requires an LLM connector (OpenAI, Anthropic, Google Gemini, or similar) configured in Kibana under
  Stack Management > Connectors. The "Complete" project tier unlocks the feature, but the connector must be set up
  separately.
- Use the `case-management` skill for creating investigation cases from alerts.

## Production use

- **Do not run against production clusters** unless you intend to inject synthetic data alongside real alerts. Sample
  events and alerts are tagged for cleanup but will appear in dashboards, the Alerts tab, and Attack Discovery alongside
  real data.
- All write operations (`generate`, `--cleanup`, `--continuous`) prompt for confirmation. Pass `--yes` or `-y` to skip
  when called by an agent.
- `--cleanup` runs `deleteByQuery` across all sample data indices — verify environment variables point to the intended
  cluster before running.
- `--continuous` mode indexes events indefinitely until manually stopped with Ctrl+C.

## Environment variables

| Variable                 | Required | Description                                |
| ------------------------ | -------- | ------------------------------------------ |
| `ELASTICSEARCH_URL`      | Yes      | Elasticsearch URL                          |
| `ELASTICSEARCH_API_KEY`  | Yes\*    | Elasticsearch API key                      |
| `ELASTICSEARCH_USERNAME` | Yes\*    | Elasticsearch username (alternative)       |
| `ELASTICSEARCH_PASSWORD` | Yes\*    | Elasticsearch password (alternative)       |
| `KIBANA_URL`             | No       | Kibana URL (for case creation and links)   |
| `KIBANA_USERNAME`        | No       | Kibana username (if using Kibana features) |
| `KIBANA_PASSWORD`        | No       | Kibana password (if using Kibana features) |

\*Either API key or username/password is required for Elasticsearch.
