# Package capabilities

Use this table when gathering environment state and when constructing install bodies. Only apply inputs that have a
value for the chosen package — omit the rest.

| Package        | Source patterns                                                    | Component template                    | Rollover target                              | Transform pattern | Module ID         | Data view patterns                                                                | Detection tag                                     |
| -------------- | ------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------- | ----------------- | ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `beaconing`    | `packetbeat-*,logs-endpoint.events.network-*,filebeat-*`           | —                                     | —                                            | `*beaconing*`     | `beaconing-ml`    | `ml_beaconing*`                                                                   | `Use Case: Network Beaconing Identification`      |
| `ded`          | `logs-endpoint.events.network-*,logs-network_traffic*`             | —                                     | —                                            | `*ded*`           | `ded-ml`          | `ml_network_ded*`                                                                 | `Use Case: Data Exfiltration Detection`           |
| `dga`          | `logs-endpoint.events.network-*`                                   | `logs-endpoint.events.network@custom` | `logs-endpoint.events.network-default`       | —                 | `dga-ml`          | —                                                                                 | `Use Case: Domain Generation Algorithm Detection` |
| `lmd`          | `logs-endpoint.events.file-*,logs-endpoint.events.process-*`       | —                                     | —                                            | `*lmd*`           | `lmd-ml`          | `ml-rdp-lmd*`                                                                     | `Use Case: Lateral Movement Detection`            |
| `pad`          | `logs-endpoint.events.process-*,logs-system.security-*,logs-okta*` | `logs-endpoint.events.process@custom` | `logs-endpoint.events.process-default`       | `*pad*`           | `pad-ml`          | `logs-*,ml_okta_multiple_user_sessions_pad.all,ml_windows_privilege_type_pad.all` | `Use Case: Privileged Access Detection`           |
| `problemchild` | `logs-endpoint.events.process-*,logs-windows*`                     | `logs-endpoint.events.process@custom` | `logs-endpoint.events.process-default`       | —                 | `problemchild-ml` | —                                                                                 | `Use Case: Living off the Land Attack Detection`  |
| `security_ai`  | see datasets                                                       | per dataset `logs-<dataset>@custom`   | existing streams matching the source pattern | —                 | `security_ai-ml`  | `logs-aws_bedrock.invocation-*`                                                   | `Use Case: Security for AI`                       |

Empty transform or data-view cells are intentional: skip transform start/stats and package data-view create. For ML
`indexPatternName`, use data-view patterns when present; otherwise use source patterns (`logs-endpoint.events.network-*`
for DGA; `logs-endpoint.events.process-*,logs-windows*` for ProblemChild). For `security_ai`, `indexPatternName` is
`logs-aws_bedrock.invocation-*`.

PAD and ProblemChild share `logs-endpoint.events.process@custom`. Always merge fields. Never overwrite the shared
template.

## Security for AI datasets

Apply the same `security_ai` mapping and the same versioned pipeline processor to every dataset. Anomaly jobs read only
`logs-aws_bedrock.invocation-*`.

| Dataset                                          | Source pattern                                          | `@custom` template and pipeline                              |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ |
| `aws_bedrock.invocation`                         | `logs-aws_bedrock.invocation-*`                         | `logs-aws_bedrock.invocation@custom`                         |
| `openai_chatgpt_enterprise.codex_log`            | `logs-openai_chatgpt_enterprise.codex_log-*`            | `logs-openai_chatgpt_enterprise.codex_log@custom`            |
| `openai_chatgpt_enterprise.conversation_message` | `logs-openai_chatgpt_enterprise.conversation_message-*` | `logs-openai_chatgpt_enterprise.conversation_message@custom` |
| `openai_chatgpt_enterprise.custom_agents_log`    | `logs-openai_chatgpt_enterprise.custom_agents_log-*`    | `logs-openai_chatgpt_enterprise.custom_agents_log@custom`    |

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

### Security for AI — `logs-<dataset>@custom`

Use this body for every dataset in the table above. `encoding`, `hash_string`, and `word_obfuscation` keep
`synthetic_source_keep: all`. `instruction_override.input_messages.probability` is `double`.

```json
{
  "template": {
    "mappings": {
      "properties": {
        "security_ai": {
          "type": "object",
          "properties": {
            "encoding": {
              "type": "object",
              "synthetic_source_keep": "all",
              "properties": {
                "input_messages": {
                  "type": "object",
                  "properties": {
                    "strings": { "type": "keyword" },
                    "probabilities": { "type": "float" },
                    "decoded": { "type": "keyword" }
                  }
                },
                "output_messages": {
                  "type": "object",
                  "properties": {
                    "strings": { "type": "keyword" },
                    "probabilities": { "type": "float" },
                    "decoded": { "type": "keyword" }
                  }
                },
                "model_version": { "type": "keyword" }
              }
            },
            "hash_string": {
              "type": "object",
              "synthetic_source_keep": "all",
              "properties": {
                "input_messages": {
                  "type": "object",
                  "properties": {
                    "strings": { "type": "keyword" },
                    "probabilities": { "type": "float" }
                  }
                },
                "output_messages": {
                  "type": "object",
                  "properties": {
                    "strings": { "type": "keyword" },
                    "probabilities": { "type": "float" }
                  }
                },
                "model_version": { "type": "keyword" }
              }
            },
            "word_obfuscation": {
              "type": "object",
              "synthetic_source_keep": "all",
              "properties": {
                "input_messages": {
                  "type": "object",
                  "properties": {
                    "strings": { "type": "keyword" },
                    "probabilities": { "type": "float" },
                    "contexts": { "type": "keyword" }
                  }
                },
                "output_messages": {
                  "type": "object",
                  "properties": {
                    "strings": { "type": "keyword" },
                    "probabilities": { "type": "float" },
                    "contexts": { "type": "keyword" }
                  }
                },
                "model_version": { "type": "keyword" }
              }
            },
            "instruction_override": {
              "type": "object",
              "properties": {
                "model_version": { "type": "keyword" },
                "input_messages": {
                  "type": "object",
                  "properties": {
                    "probability": { "type": "double" },
                    "prediction": { "type": "keyword" },
                    "top_snippet": {
                      "type": "object",
                      "properties": {
                        "text": { "type": "keyword" },
                        "probability": { "type": "float" },
                        "kind": { "type": "keyword" },
                        "candidates_scored": { "type": "integer" }
                      }
                    }
                  }
                }
              }
            },
            "refusal": {
              "type": "object",
              "properties": {
                "model_version": { "type": "keyword" },
                "output_messages": {
                  "type": "object",
                  "properties": {
                    "blob_probability": { "type": "float" },
                    "probability": { "type": "float" },
                    "is_refusal": { "type": "boolean" },
                    "safeguards_flag_sentence": { "type": "keyword" },
                    "top_snippet": {
                      "type": "object",
                      "properties": {
                        "text": { "type": "keyword" },
                        "probability": { "type": "float" },
                        "kind": { "type": "keyword" },
                        "candidates_scored": { "type": "integer" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Ingest pipeline wiring

When `GET /_ingest/pipeline/{name}` returns 404, create a pipeline with one processor. When it returns a pipeline, a
processor belongs to the package being installed when `pipeline.name` ends with that package's suffix:

- `dga`: `ml_dga_ingest_pipeline`
- `pad`: `ml_pad_ingest_pipeline`
- `problemchild`: `problem_child_ingest_pipeline`
- `security_ai`: `security_ai_ingest_pipeline`

The installed name is `{version}-<suffix>`.

- That exact name is already present: do not add another.
- An older version of the same suffix is present: replace that name with `{version}-<suffix>`. If several copies of the
  same suffix exist, keep one at the installed version.
- No processor with that suffix is present: append one.
- Do not remove or rewrite processors for a different suffix. PAD must keep a ProblemChild processor, and ProblemChild
  must keep a PAD processor. Security for AI must keep unrelated processors such as `1.2.0-aws_bedrock_existing`.

| Package        | Versioned pipeline name pattern           | `@custom` pipeline                               |
| -------------- | ----------------------------------------- | ------------------------------------------------ |
| `dga`          | `{version}-ml_dga_ingest_pipeline`        | `logs-endpoint.events.network@custom`            |
| `pad`          | `{version}-ml_pad_ingest_pipeline`        | `logs-endpoint.events.process@custom`            |
| `problemchild` | `{version}-problem_child_ingest_pipeline` | `logs-endpoint.events.process@custom`            |
| `security_ai`  | `{version}-security_ai_ingest_pipeline`   | one `logs-<dataset>@custom` pipeline per dataset |

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

## Security for AI models, jobs, and rules

After Fleet install, confirm these trained model ids with `GET /_ml/trained_models/{model_id}`:

- `security_ai_string_encoding_classifier_0.1`
- `security_ai_word_obfuscation_classifier_0.1`
- `security_ai_instruction_override_classifier_0.1`
- `security_ai_refusal_detection_classifier_0.1`

A missing model does not roll back the install. `security_ai` enrichment omits that detector.

Anomaly jobs are Bedrock-only. Each job's model memory limit is 64mb:

- `security_ai_bedrock_asi02_large_tool_batch`
- `security_ai_bedrock_asi02_rare_tool`
- `security_ai_bedrock_asi02_high_tool_volume`

If the user declines job setup because Bedrock has no hits, skip `security_ai-ml` and do not enable these three rules:

- AWS Bedrock Unusually Large Tool-Request Batch
- AWS Bedrock Unusual Tool Selection
- AWS Bedrock High Tool-Request Call Volume

Two rules call `COMPLETION` with `.google-gemini-3.8-flash-completion`. Follow step 8 in the skill for when to enable,
patch, or leave them disabled:

- High Confidence Prompt Injection in a GenAI User Message
- High Confidence Malicious GenAI Assistant Response

The other package rules tagged `Use Case: Security for AI` do not need an inference endpoint.
