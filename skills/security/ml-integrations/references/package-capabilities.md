# Package capabilities

Use this table when gathering environment state and when constructing install bodies. Only apply inputs that have a
value for the chosen package — omit the rest.

| Package        | Source patterns                                                    | Component template                    | Rollover target                        | Transform pattern | Module ID         | Data view patterns                                                                | Detection tag                                     |
| -------------- | ------------------------------------------------------------------ | ------------------------------------- | -------------------------------------- | ----------------- | ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `beaconing`    | `packetbeat-*,logs-endpoint.events.network-*,filebeat-*`           | —                                     | —                                      | `*beaconing*`     | `beaconing-ml`    | `ml_beaconing*`                                                                   | `Use Case: Network Beaconing Identification`      |
| `ded`          | `logs-endpoint.events.network-*,logs-network_traffic*`             | —                                     | —                                      | `*ded*`           | `ded-ml`          | `ml_network_ded*`                                                                 | `Use Case: Data Exfiltration Detection`           |
| `dga`          | `logs-endpoint.events.network-*`                                   | `logs-endpoint.events.network@custom` | `logs-endpoint.events.network-default` | —                 | `dga-ml`          | —                                                                                 | `Use Case: Domain Generation Algorithm Detection` |
| `lmd`          | `logs-endpoint.events.file-*,logs-endpoint.events.process-*`       | —                                     | —                                      | `*lmd*`           | `lmd-ml`          | `ml-rdp-lmd*`                                                                     | `Use Case: Lateral Movement Detection`            |
| `pad`          | `logs-endpoint.events.process-*,logs-system.security-*,logs-okta*` | `logs-endpoint.events.process@custom` | `logs-endpoint.events.process-default` | `*pad*`           | `pad-ml`          | `logs-*,ml_okta_multiple_user_sessions_pad.all,ml_windows_privilege_type_pad.all` | `Use Case: Privileged Access Detection`           |
| `problemchild` | `logs-endpoint.events.process-*,logs-windows*`                     | `logs-endpoint.events.process@custom` | `logs-endpoint.events.process-default` | —                 | `problemchild-ml` | —                                                                                 | `Use Case: Living off the Land Attack Detection`  |

Empty transform or data-view cells are intentional: skip transform start/stats and package data-view create. For ML
`indexPatternName`, use data-view patterns when present; otherwise use source patterns (`logs-endpoint.events.network-*`
for DGA; `logs-endpoint.events.process-*,logs-windows*` for ProblemChild).

PAD and ProblemChild share `logs-endpoint.events.process@custom`. Always merge fields and append pipeline processors.
Never overwrite the shared template or pipeline.

## Component template fields

When `GET /_component_template/{name}` returns a template, deep-merge the fields below into existing `properties`. When
it returns 404, create a template that contains only these fields.

### DGA — `logs-endpoint.events.network@custom`

```json
{
  "template": {
    "mappings": {
      "properties": {
        "ml_is_dga": {
          "properties": {
            "malicious_prediction": { "type": "long" },
            "malicious_probability": { "type": "float" }
          }
        }
      }
    }
  }
}
```

### PAD — `logs-endpoint.events.process@custom`

```json
{
  "template": {
    "mappings": {
      "properties": {
        "process": {
          "properties": {
            "command_line_entropy": { "type": "double" }
          }
        }
      }
    }
  }
}
```

### ProblemChild — `logs-endpoint.events.process@custom`

```json
{
  "template": {
    "mappings": {
      "properties": {
        "problemchild": {
          "properties": {
            "prediction": { "type": "long" },
            "prediction_probability": { "type": "float" }
          }
        },
        "blocklist_label": { "type": "long" }
      }
    }
  }
}
```

## Ingest pipeline wiring

When `GET /_ingest/pipeline/{name}` returns a pipeline, append the package processor to the existing `processors` list.
When it returns 404, create a pipeline with a single processor. PAD and ProblemChild share
`logs-endpoint.events.process@custom` — always append.

| Package        | Versioned pipeline name pattern           | `@custom` pipeline                    |
| -------------- | ----------------------------------------- | ------------------------------------- |
| `dga`          | `{version}-ml_dga_ingest_pipeline`        | `logs-endpoint.events.network@custom` |
| `pad`          | `{version}-ml_pad_ingest_pipeline`        | `logs-endpoint.events.process@custom` |
| `problemchild` | `{version}-problem_child_ingest_pipeline` | `logs-endpoint.events.process@custom` |

`{version}` is the installed package version from `GET kbn:/api/fleet/epm/packages/{package}`.

Processor shape (always set `ignore_missing_pipeline` and `ignore_failure`):

```json
{
  "processors": [
    {
      "pipeline": {
        "name": "{version}-ml_pad_ingest_pipeline",
        "ignore_missing_pipeline": true,
        "ignore_failure": true
      }
    }
  ]
}
```
