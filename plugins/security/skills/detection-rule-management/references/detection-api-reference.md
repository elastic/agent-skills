# Kibana Detection Engine API Reference

Quick reference for the detection rules and exceptions APIs used by `rule_manager.py`.

## Detection rules

| Operation             | Method | Path                                                              |
| --------------------- | ------ | ----------------------------------------------------------------- |
| Find / list rules     | GET    | `/api/detection_engine/rules/_find`                               |
| Get single rule       | GET    | `/api/detection_engine/rules?id=<uuid>` or `?rule_id=<stable_id>` |
| Create rule           | POST   | `/api/detection_engine/rules`                                     |
| Patch rule (partial)  | PATCH  | `/api/detection_engine/rules`                                     |
| Update rule (full)    | PUT    | `/api/detection_engine/rules`                                     |
| Delete rule           | DELETE | `/api/detection_engine/rules?id=<uuid>`                           |
| Bulk action           | POST   | `/api/detection_engine/rules/_bulk_action`                        |
| Export rules (NDJSON) | POST   | `/api/detection_engine/rules/_export`                             |
| Import rules (NDJSON) | POST   | `/api/detection_engine/rules/_import`                             |
| Preview rule          | POST   | `/api/detection_engine/rules/preview`                             |
| Get tags              | GET    | `/api/detection_engine/tags`                                      |

### Rule types

| `type` value       | Language            | Description                                    |
| ------------------ | ------------------- | ---------------------------------------------- |
| `query`            | `kuery` or `lucene` | Custom KQL / Lucene query                      |
| `eql`              | `eql`               | Event Query Language (sequences, joins)        |
| `esql`             | `esql`              | ES\|QL aggregation-based rules                 |
| `threshold`        | `kuery`             | Alert when field value count exceeds threshold |
| `machine_learning` | —                   | Anomaly-based (requires ML job)                |
| `threat_match`     | `kuery`             | Indicator match / threat intel                 |
| `new_terms`        | `kuery`             | Alert on previously unseen field values        |

### Key create/patch body fields

| Field                 | Type     | Notes                               |
| --------------------- | -------- | ----------------------------------- |
| `name`                | string   | Required                            |
| `description`         | string   | Required                            |
| `type`                | string   | See rule types above                |
| `query`               | string   | Detection query                     |
| `language`            | string   | `kuery`, `lucene`, `eql`, `esql`    |
| `index`               | string[] | Index patterns (not for ES\|QL)     |
| `severity`            | string   | `low`, `medium`, `high`, `critical` |
| `risk_score`          | int      | 0-100                               |
| `interval`            | string   | e.g. `5m`, `1h`                     |
| `from`                | string   | Lookback, e.g. `now-6m`             |
| `tags`                | string[] | Categorization tags                 |
| `enabled`             | bool     | Default `true`                      |
| `threat`              | object[] | MITRE ATT&CK mapping                |
| `false_positives`     | string[] | Known FP descriptions               |
| `note`                | string   | Investigation guide (markdown)      |
| `max_signals`         | int      | Max alerts per run (default 100)    |
| `exceptions_list`     | object[] | Attached exception lists            |
| `alert_suppression`   | object   | Suppress duplicate alerts           |
| `building_block_type` | string   | `"default"` for building blocks     |

### MITRE ATT&CK `threat` field structure

```json
[
  {
    "framework": "MITRE ATT&CK",
    "tactic": {
      "id": "TA0003",
      "name": "Persistence",
      "reference": "https://attack.mitre.org/tactics/TA0003/"
    },
    "technique": [
      {
        "id": "T1547",
        "name": "Boot or Logon Autostart Execution",
        "reference": "https://attack.mitre.org/techniques/T1547/",
        "subtechnique": [
          {
            "id": "T1547.001",
            "name": "Registry Run Keys / Startup Folder",
            "reference": "https://attack.mitre.org/techniques/T1547/001/"
          }
        ]
      }
    ]
  }
]
```

### Bulk action types

| Action      | Description                                      |
| ----------- | ------------------------------------------------ |
| `enable`    | Enable matching rules                            |
| `disable`   | Disable matching rules                           |
| `delete`    | Delete matching rules                            |
| `duplicate` | Duplicate matching rules                         |
| `export`    | Export matching rules                            |
| `edit`      | Edit tags, index patterns, actions, or schedules |

Bulk edit sub-actions (`edit` field):

```json
[
  { "type": "add_tags", "value": ["tuned"] },
  { "type": "delete_tags", "value": ["needs-review"] },
  { "type": "set_tags", "value": ["production", "tuned"] },
  { "type": "add_index_patterns", "value": ["logs-newdata-*"] },
  { "type": "delete_index_patterns", "value": ["logs-old-*"] },
  { "type": "set_index_patterns", "value": ["logs-endpoint.*"] },
  { "type": "set_schedule", "value": { "interval": "10m", "lookback": "5m" } }
]
```

## Exceptions

| Operation             | Method | Path                                          |
| --------------------- | ------ | --------------------------------------------- |
| Add exception to rule | POST   | `/api/detection_engine/rules/{id}/exceptions` |
| Create exception list | POST   | `/api/exception_lists`                        |
| Create shared list    | POST   | `/api/exceptions/shared`                      |
| Find exception lists  | GET    | `/api/exception_lists/_find`                  |
| Find exception items  | GET    | `/api/exception_lists/items/_find`            |
| Create exception item | POST   | `/api/exception_lists/items`                  |
| Update exception item | PUT    | `/api/exception_lists/items`                  |
| Delete exception item | DELETE | `/api/exception_lists/items?id=<id>`          |

### Exception entry operators

| Shorthand        | `type`      | `operator` | Value format     |
| ---------------- | ----------- | ---------- | ---------------- |
| `is`             | `match`     | `included` | single string    |
| `is_not`         | `match`     | `excluded` | single string    |
| `is_one_of`      | `match_any` | `included` | comma-separated  |
| `is_not_one_of`  | `match_any` | `excluded` | comma-separated  |
| `exists`         | `exists`    | `included` | —                |
| `does_not_exist` | `exists`    | `excluded` | —                |
| `matches`        | `wildcard`  | `included` | wildcard pattern |
| `does_not_match` | `wildcard`  | `excluded` | wildcard pattern |

### Exception item structure

```json
{
  "type": "simple",
  "name": "Exclude SCCM deployments",
  "description": "SCCM pushes trigger this rule; confirmed benign",
  "entries": [
    {
      "field": "process.parent.name",
      "type": "match",
      "operator": "included",
      "value": "CcmExec.exe"
    }
  ],
  "tags": ["tuning:fp", "source:soc"],
  "comments": [{ "comment": "Added after triage case #1234. SCCM deploys via CcmExec." }]
}
```

## Environment variables

| Variable                | Required | Description           |
| ----------------------- | -------- | --------------------- |
| `ELASTICSEARCH_URL`     | Yes      | Elasticsearch URL     |
| `ELASTICSEARCH_API_KEY` | Yes      | Elasticsearch API key |
| `KIBANA_URL`            | Yes      | Kibana URL            |
| `KIBANA_API_KEY`        | Yes      | Kibana API key        |
