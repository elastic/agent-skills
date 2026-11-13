---
name: security-ml-integrations
description: >
  Install and manage Elastic security ML integration packages (beaconing, ded, dga,
  lmd, pad, problemchild, security_ai). Handles the full lifecycle: pre-flight checks,
  Fleet package install, component templates, ingest pipelines, transforms, data views,
  ML anomaly detection jobs, and detection rules. Use when a user asks to install,
  set up, check the status of, or troubleshoot a security ML integration package,
  including the technical preview Security for AI package.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
compatibility: Requires Kibana 9.4+ with Fleet, ML, and Security (Security for AI
  requires Kibana 9.6+); a Platinum, Enterprise, or trial license (or Serverless);
  manage_ml; and the elastic CLI ≥ 0.5.
---

# Security ML Integration Package Management

Install, check, or troubleshoot a security ML package. Supported packages: `beaconing` (Network Beaconing
Identification), `ded` (Data Exfiltration Detection), `dga` (Domain Generation Algorithm Detection), `lmd` (Lateral
Movement Detection), `pad` (Privileged Access Detection), `problemchild` (Living off the Land Attack Detection),
`security_ai` (Security for AI, technical preview).

<!-- begin-partial: preamble -->

## Environment Configuration

This skill executes Elasticsearch operations through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, call the HTTP API directly, or attempt other workarounds.

This skill references operations in HTTP-shorthand form (e.g., `GET /`, `GET /_cat/indices`, `GET /{index}/_mapping`,
`GET /{index}/_settings/index.mode`, `POST /_query`). The [Operations](#operations) table at the end of this document
maps each shorthand to the equivalent `elastic` CLI command — always use the CLI rather than calling the HTTP API
directly.

<!-- end-partial: preamble -->

Package source patterns, shared template fields, and ingest-pipeline wiring live in
[package capabilities](references/package-capabilities.md).

## Process

1. **Classify the request.** Status, README, or install. Status and README stay read-only — do not install, start
   transforms, deploy jobs, or enable rules. After identifying the package, branch: status uses
   `GET kbn:/api/fleet/epm/packages/{package}` only (title, version, status); README adds
   `GET kbn:/api/fleet/epm/packages/{package}/{version}/docs/README.md` and returns that document; install continues.

2. **Identify the package.** Map the user's words to one of the seven package names above. `security_ai` is a technical
   preview. If the name is ambiguous, ask before calling any API. Load that package's row from
   [package capabilities](references/package-capabilities.md) — omit fields that are empty for that package. For
   `security_ai`, also load the datasets table. Each dataset has its own template and pipeline. Rollover targets are the
   data streams that already match that dataset's source pattern.

3. **Gather environment state before any mutation.** Install only. `GET /_license` first — continue only for `platinum`,
   `enterprise`, `trial`, or Serverless. If `GET /_ml/info` returns 403, report missing `manage_ml` and stop. Then
   collect:
   - Package: `GET kbn:/api/fleet/epm/packages/{package}` for name, title, version, and `status`.
   - Kibana version (`security_ai` only): `GET kbn:/api/status`. Continue only when `version.number` is 9.6.0 or newer.
     If it is older, report that Security for AI requires Kibana 9.6+ and stop before any write.
   - Source data: `POST /{source_patterns}/_search` with `size: 0` and `track_total_hits: true`. For `security_ai`,
     count hits on each dataset pattern. If every pattern has zero hits, warn that jobs will not produce useful
     anomalies. Also warn when `logs-aws_bedrock.invocation-*` has zero hits, because anomaly jobs read only that
     pattern, and ask whether to deploy the anomaly jobs.
   - Shared template (DGA, PAD, ProblemChild only): `GET /_component_template/{name}`. Exists → plan a merge of the
     fields in the reference. 404 → plan a create with only those fields.
   - Ingest pipeline (`dga`, `pad`, `problemchild`, and each `security_ai` dataset): `GET /_ingest/pipeline/{name}` and
     plan the reuse, replace, or append result from
     [ingest-pipeline wiring](references/package-capabilities.md#ingest-pipeline-wiring).
   - Security for AI templates and pipelines: for each dataset, `GET /_component_template/logs-<dataset>@custom` and
     apply the pipeline rule above to `logs-<dataset>@custom`. Template exists → plan a deep-merge of `security_ai`. 404
     → plan a create that contains only those fields. Do not edit the `@package` template. Then
     `GET /_data_stream/{source_pattern}` and record each data stream name. No match → plan to skip rollover for that
     dataset. Do not assume a `-default` stream exists.
   - Security for AI completion endpoint: `GET /_inference/completion/_all`. Record whether
     `.google-gemini-3.8-flash-completion` exists.
   - Transforms: `GET /_transform/{pattern}` (skip if the package has no transform pattern). Record each `id`,
     `dest.index`, and the `.all` alias (`dest.aliases` where `move_on_creation` is false).
   - Data views: `GET kbn:/api/data_views` and check whether the package's data-view pattern already exists.
   - ML capacity: `GET /_ml/info` (total memory) and `GET /_ml/anomaly_detectors/_all/_stats` (sum memory of **opened**
     jobs). `GET kbn:/internal/ml/modules/get_module/{module_id}` for job count and per-job memory. If jobs do not fit,
     say so and suggest prioritizing job groups — do not deploy anyway without the user accepting the risk.
   - Rules: `GET kbn:/api/detection_engine/rules/prepackaged/_status` and
     `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_review` filtered by the package detection tag.

4. **Present a plan and wait for confirmation.** Show package identity and status, source-data hits (warn if all zero),
   template/pipeline merge-or-create, transform count and states, data-view presence, ML memory fit, and rule count. For
   `security_ai`, also say the package is a technical preview, list per-dataset hit counts, name the data streams that
   will be rolled over, and say whether the two COMPLETION rules will stay disabled. **Do not call any write API until
   the user confirms.** If they decline, stop.

5. **Install the Fleet package, then apply shared mappings.** After confirmation:
   - `POST kbn:/api/fleet/epm/packages/{package}` to install assets (transforms may be deferred until started).
   - If the package uses a component template: `PUT /_component_template/{name}` with the merged or new body. Then
     `POST /{data_stream}/_rollover` on the rollover target so new indices pick up mappings.
   - If the package uses an ingest pipeline: `PUT /_ingest/pipeline/{name}` with the result from the ingest-pipeline
     wiring section.

   Skip template, pipeline, and rollover when the package row has no values for them (beaconing, ded, lmd).

   For `security_ai`, prepare the template and pipeline for every dataset, then roll over only the data streams found in
   pre-flight. Deep-merge `security_ai` into existing `properties`. `POST /{name}/_rollover` once per returned data
   stream name, including streams whose namespace is not `default`. When `GET /_data_stream/{source_pattern}` matched
   nothing, skip rollover for that dataset and say so. A missing `-default` stream is not an error. After the Fleet
   POST, `GET /_ml/trained_models/{model_id}` for each model id in the reference. A missing model does not roll back the
   install. Report that `security_ai` enrichment will omit that detector.

6. **Start transforms and create destination aliases.** Skip transform stop, reset, start, alias, and schedule steps
   when the package has no transform pattern (`dga`, `problemchild`, `security_ai`). Still create a missing package data
   view when that cell has a value. When a transform pattern is present, Fleet's first checkpoint often skips `.all`
   aliases. After install, `GET /_transform/{pattern}` again if IDs were missing. Reset only if the transform is new,
   never started, failed, or the user asked to rebuild: `POST /_transform/{id}/_stop`, `POST /_transform/{id}/_reset`,
   `POST /_transform/{id}/_update` with the existing description, `POST /_transform/{id}/_start`,
   `POST /_transform/{id}/_schedule_now`. If already `started` with `checkpointing.last.checkpoint >= 1`, skip reset;
   restamp via the existing description and ensure `.all` aliases exist. Then `POST /_aliases` to add the `.all` alias
   (and `.latest` if the dest defines it) on `dest.index`. If a data-view pattern is missing,
   `POST kbn:/api/data_views/data_view`. Also ensure a hidden `.ml-anomalies-shared` data view exists
   (`POST kbn:/api/data_views/data_view`) so package dashboards resolve.

7. **Confirm the first transform checkpoint before ML.** If step 6 skipped transforms, skip this step and continue to
   jobs. Otherwise call `GET /_transform/{pattern}/_stats`. Proceed only when each transform is `started` and
   `checkpointing.last.checkpoint >= 1`; do not use `documents_processed` as a substitute. Zero documents with a
   completed checkpoint is acceptable when source patterns are empty — destination aliases still let datafeeds start.
   Otherwise tell the user transforms must finish processing and **wait for confirmation** before the next step. Never
   set up the ML module against missing dest indices.

8. **Deploy ML jobs, then detection rules.** After transforms are confirmed (or skipped):
   - `POST kbn:/internal/ml/modules/setup/{module_id}` with `startDatafeed: true` and `indexPatternName` set to the
     package data-view pattern, or source patterns when that cell is empty. **Do not put spaces after commas** in
     `indexPatternName` — the setup API splits on commas without trimming. Correct:
     `logs-*,ml_okta_multiple_user_sessions_pad.all,ml_windows_privilege_type_pad.all`. For `security_ai`,
     `indexPatternName` is `logs-aws_bedrock.invocation-*`. Do not pass the OpenAI patterns. If Bedrock had zero hits
     and the user declined job setup, skip module setup and do not enable the three Bedrock anomaly rules.
   - Initialize the detection engine if needed (`POST kbn:/api/detection_engine/index`), install the prebuilt rules
     package (`POST kbn:/api/fleet/epm/packages/security_detection_engine`), review the package-tagged rules, then call
     `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_perform` with
     `{"mode":"SPECIFIC_RULES","rules":[{"rule_id":"<rule_id>","version":<version>}]}` (one entry per reviewed rule).
     Enable the package's ML rules with `POST kbn:/api/detection_engine/rules/_bulk_action` (`disable` then `enable` on
     immutable ML rules tagged with the package detection tag so API keys are stamped with the calling user).
   - For `security_ai`, enable High Confidence Prompt Injection in a GenAI User Message and High Confidence Malicious
     GenAI Assistant Response with no query edit when `.google-gemini-3.8-flash-completion` is in
     `GET /_inference/completion/_all`. When it is absent, tell the user that endpoint is unavailable, list the
     completion endpoint ids that were returned, and ask which one to use. Do not patch or enable either rule before
     they approve an id from that list. After approval, `PATCH kbn:/api/detection_engine/rules` on each installed rule
     so the `COMPLETION` `inference_id` is the approved id. Then `GET kbn:/api/detection_engine/rules` and enable that
     rule only when the saved query contains the approved id and no longer contains
     `.google-gemini-3.8-flash-completion`. If they decline, the chosen id was not in the list, or the patch is rejected
     because the license cannot edit prebuilt rules, leave both original rules disabled. Do not create a duplicate.
     Enable the other package rules that are in scope.

9. **Report created versus skipped.** Package version and asset count; template/pipeline/rollover created, updated, or
   skipped; transforms started; data views created or already present; ML jobs and datafeeds started (and any that
   failed, with the mapping or index reason); rules installed and enabled. For `security_ai`, also report each model id
   as present or missing, and name any COMPLETION rules left disabled.

## Examples

### Install PAD

User: "Install PAD"

1. Gather state for `pad`. Package not installed, zero source hits, `logs-endpoint.events.process@custom` already has
   ProblemChild fields, no `@custom` pipeline, two stopped transforms, 15 jobs fit in available memory, tagged rules
   available.
2. Present the plan: warn about empty source data; merge `process.command_line_entropy`; create the PAD pipeline
   processor; start both transforms; create the PAD data view. Wait for confirm.
3. After confirm: `POST kbn:/api/fleet/epm/packages/pad`, merge-and-`PUT` the shared template, `PUT` the pipeline,
   restamp via existing description (reset only if transforms are new or stopped), `POST /_aliases` for each `.all`
   alias.
4. `GET /_transform/*pad*/_stats`. If checkpoint 1 is done (even with 0 docs), continue; otherwise wait for the user.
5. `POST kbn:/internal/ml/modules/setup/pad-ml` with a no-space `indexPatternName`, then install and enable rules tagged
   `Use Case: Privileged Access Detection`.
6. Report each section as created, updated, or skipped.

### Install beaconing (no template or pipeline)

User: "Set up beaconing"

1. Gather state. Omit template, pipeline, and rollover — the beaconing row has none.
2. Present a shorter plan (package, one transform, data view, jobs, rules). Wait for confirm.
3. Install the package, start the transform, create `ml_beaconing*` if missing, confirm checkpoint, set up
   `beaconing-ml`, enable rules tagged `Use Case: Network Beaconing Identification`.

### Install Security for AI (technical preview)

User: "Install Security for AI"

1. `GET kbn:/api/status` reports 9.6.1, so continue. License is platinum. Package `security_ai` is not installed. Call
   out that it is a technical preview.
2. Bedrock has hits. The three OpenAI patterns have zero hits. `GET /_data_stream/logs-aws_bedrock.invocation-*` returns
   `logs-aws_bedrock.invocation-prod` and no `-default` stream. The OpenAI patterns match no data streams.
   `logs-aws_bedrock.invocation@custom` already has unrelated fields and processors. There is no transform pattern.
   `.google-gemini-3.8-flash-completion` is absent. Three jobs fit in memory.
3. Present the plan: warn about empty OpenAI sources; deep-merge `security_ai` and append
   `{version}-security_ai_ingest_pipeline` on each dataset only because those pipelines have unrelated processors and no
   `security_ai_ingest_pipeline` call yet; roll over `logs-aws_bedrock.invocation-prod` because that is the stream
   `GET /_data_stream/logs-aws_bedrock.invocation-*` returned; skip rollover for the OpenAI datasets because they have
   no data streams; create `logs-aws_bedrock.invocation-*` if missing; set up `security_ai-ml` with that index pattern;
   install rules tagged `Use Case: Security for AI`. Wait for confirm.
4. After confirm: `POST kbn:/api/fleet/epm/packages/security_ai`. Check the four trained model ids and report any that
   are missing without rolling back. Merge-and-`PUT` each template and `PUT` each pipeline with that one new processor,
   including datasets with no data stream. `POST /logs-aws_bedrock.invocation-prod/_rollover`. Do not call rollover on a
   `-default` name that was not returned.
5. Skip transforms and the checkpoint wait. `POST kbn:/internal/ml/modules/setup/security_ai-ml` with `indexPatternName`
   `logs-aws_bedrock.invocation-*`.
6. Install the tagged rules. Enable the six that do not need COMPLETION. The default completion endpoint is absent, so
   ask which returned endpoint to use and do not patch yet.
7. Report each section as created, updated, or skipped, including missing models.

### Status only

User: "Is beaconing installed?"

1. `GET kbn:/api/fleet/epm/packages/beaconing` only.
2. Report title, version, and status. A README request also fetches and returns the docs README. Do not install or start
   anything.

## Guidelines

- Gather environment state before every install. Do not skip the pre-flight reads.
- Stay read-only on status and README questions.
- Wait for explicit confirmation before any write. Check license before the Fleet POST.
- Pause after transforms until `checkpointing.last.checkpoint >= 1` (0 docs is acceptable when source patterns are
  empty). Skip transform and package data-view steps when those capability cells are empty.
- Never overwrite a shared `@custom` template. PAD and ProblemChild share `logs-endpoint.events.process@custom` — merge
  fields.
- Put no spaces after commas in ML `indexPatternName`.
- Cite Fleet package APIs as `kbn:/api/fleet/...`. Do not use a `fleet:` prefix.
- Restamp a Fleet transform by setting `--description` to the existing text, then start. Do not use `--body '{}'`.
- On serverless, `GET /_ml/info` may return 410. Continue with opened-job stats from
  `GET /_ml/anomaly_detectors/_all/_stats`; do not abort the install.
- Anomaly jobs for `security_ai` use only `logs-aws_bedrock.invocation-*`. Skip transforms for that package.

## Operations

| HTTP API (shorthand)                                                       | `elastic` CLI command                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET kbn:/api/status`                                                      | `elastic kb system get-status`                                                                                  |
| `GET kbn:/api/fleet/epm/packages/{package}`                                | `elastic kb elastic-package-manager-epm get-fleet-epm-packages-pkgname --pkg-name '{package}'`                  |
| `GET kbn:/api/fleet/epm/packages/{package}/{version}/docs/README.md`       | CLI gap — package-file fetch 404s on registry paths; keep this shorthand as the contract                        |
| `POST kbn:/api/fleet/epm/packages/{package}`                               | `elastic kb elastic-package-manager-epm post-fleet-epm-packages-pkgname --pkg-name '{package}'`                 |
| `POST /{source_patterns}/_search`                                          | `elastic es count --index '{source_patterns}' --allow-no-indices true --ignore-unavailable true`                |
| `GET /_component_template/{name}`                                          | `elastic es cluster get-component-template --name '{name}'`                                                     |
| `PUT /_component_template/{name}`                                          | `elastic es cluster put-component-template --name '{name}' --template '{json}'`                                 |
| `GET /_ingest/pipeline/{name}`                                             | `elastic es ingest get-pipeline --id '{name}'`                                                                  |
| `PUT /_ingest/pipeline/{name}`                                             | `elastic es ingest put-pipeline --id '{name}' --input-file '{path}'`                                            |
| `GET /_data_stream/{name}`                                                 | `elastic es indices get-data-stream --name '{name}'`                                                            |
| `POST /{data_stream}/_rollover`                                            | `elastic es indices rollover --alias '{data_stream}'`                                                           |
| `GET /_transform/{pattern}`                                                | `elastic es transform get-transform --transform-id '{pattern}'`                                                 |
| `GET /_transform/{pattern}/_stats`                                         | `elastic es transform get-transform-stats --transform-id '{pattern}'`                                           |
| `POST /_transform/{id}/_stop`                                              | `elastic es transform stop-transform --transform-id '{id}' --force true --wait-for-completion true`             |
| `POST /_transform/{id}/_reset`                                             | `elastic es transform reset-transform --transform-id '{id}' --force true`                                       |
| `POST /_transform/{id}/_update`                                            | `elastic es transform update-transform --transform-id '{id}' --description '{existing}'`                        |
| `POST /_transform/{id}/_start`                                             | `elastic es transform start-transform --transform-id '{id}'`                                                    |
| `POST /_transform/{id}/_schedule_now`                                      | `elastic es transform schedule-now-transform --transform-id '{id}'`                                             |
| `POST /_aliases`                                                           | `elastic es indices update-aliases --actions '{json}'`                                                          |
| `GET kbn:/api/data_views`                                                  | `elastic kb data-views get-all-data-views-default`                                                              |
| `POST kbn:/api/data_views/data_view`                                       | `elastic kb data-views create-data-view-default --data-view '{json}'`                                           |
| `GET /_license`                                                            | `elastic es license get`                                                                                        |
| `GET /_ml/info`                                                            | `elastic es ml info`                                                                                            |
| `GET /_ml/trained_models/{model_id}`                                       | `elastic es ml get-trained-models --model-id '{model_id}'`                                                      |
| `GET /_inference/completion/_all`                                          | `elastic es inference get --task-type completion --inference-id '_all'`                                         |
| `GET /_ml/anomaly_detectors/_all/_stats`                                   | `elastic es ml get-job-stats --job-id '_all'`                                                                   |
| `GET kbn:/internal/ml/modules/get_module/{module_id}`                      | CLI gap — ML module get is an internal Kibana API; keep this shorthand as the contract                          |
| `POST kbn:/internal/ml/modules/setup/{module_id}`                          | CLI gap — ML module setup is an internal Kibana API; keep this shorthand as the contract                        |
| `GET kbn:/api/detection_engine/rules/prepackaged/_status`                  | CLI gap — no generated prepackaged-status command; keep this shorthand as the contract                          |
| `POST kbn:/api/detection_engine/index`                                     | CLI gap — no generated detection-engine index command; keep this shorthand as the contract                      |
| `POST kbn:/api/fleet/epm/packages/security_detection_engine`               | `elastic kb elastic-package-manager-epm post-fleet-epm-packages-pkgname --pkg-name 'security_detection_engine'` |
| `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_review`  | CLI gap — prebuilt-rule review is an internal Kibana API; keep this shorthand as the contract                   |
| `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_perform` | CLI gap — prebuilt-rule install is an internal Kibana API; keep this shorthand as the contract                  |
| `GET kbn:/api/detection_engine/rules`                                      | `elastic kb security-detections-api read-rule --rule-id '{rule_id}'`                                            |
| `PATCH kbn:/api/detection_engine/rules`                                    | `elastic kb security-detections-api patch-rule --body '{json}'`                                                 |
| `POST kbn:/api/detection_engine/rules/_bulk_action`                        | CLI gap — generated `perform-rules-bulk-action` accepts only `edit`; keep this shorthand for disable/enable     |

Internal ML-module APIs, prebuilt-rules `_review`/`_perform`, detection-engine index, and rules disable/enable have no
usable generated CLI commands yet. Keep the HTTP shorthand as the contract; do not add skill-owned scripts as a
workaround. Generated Fleet EPM get/install commands exist — use those instead of the shorthand.
