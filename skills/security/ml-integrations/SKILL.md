---
name: security-ml-integrations
description: >
  Install and manage Elastic security ML integration packages (beaconing, ded, dga,
  lmd, pad, problemchild). Handles the full lifecycle: pre-flight checks, Fleet package
  install, component templates, ingest pipelines, transforms, data views, ML anomaly
  detection jobs, and detection rules. Use when a user asks to install, set up, check
  the status of, or troubleshoot a security ML integration package.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Requires Kibana 9.4+ with Fleet, ML, and Security; a Platinum, Enterprise,
  or trial license (or Serverless); manage_ml; and the elastic CLI ≥ 0.5.
---

# Security ML Integration Package Management

Install, check, or troubleshoot a security ML package. Supported packages: `beaconing` (Network Beaconing
Identification), `ded` (Data Exfiltration Detection), `dga` (Domain Generation Algorithm Detection), `lmd` (Lateral
Movement Detection), `pad` (Privileged Access Detection), `problemchild` (Living off the Land Attack Detection).

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

2. **Identify the package.** Map the user's words to one of the six package names above. If the name is ambiguous, ask
   before calling any API. Load that package's row from [package capabilities](references/package-capabilities.md) —
   omit fields that are empty for that package.

3. **Gather environment state before any mutation.** Install only. `GET /_license` first — continue only for `platinum`,
   `enterprise`, `trial`, or Serverless. If `GET /_ml/info` returns 403, report missing `manage_ml` and stop. Then
   collect:
   - Package: `GET kbn:/api/fleet/epm/packages/{package}` for name, title, version, and `status`.
   - Source data: `POST /{source_patterns}/_search` with `size: 0` and `track_total_hits: true`. If every pattern has
     zero hits, warn that jobs will not produce useful anomalies.
   - Shared template (DGA, PAD, ProblemChild only): `GET /_component_template/{name}`. Exists → plan a merge of the
     fields in the reference. 404 → plan a create with only those fields.
   - Shared pipeline (DGA, PAD, ProblemChild only): `GET /_ingest/pipeline/{name}`. Exists → plan to append a processor.
     404 → plan a single-processor pipeline.
   - Transforms: `GET /_transform/{pattern}` (skip if the package has no transform pattern). Record each `id`,
     `dest.index`, and the `.all` alias (`dest.aliases` where `move_on_creation` is false).
   - Data views: `GET kbn:/api/data_views` and check whether the package's data-view pattern already exists.
   - ML capacity: `GET /_ml/info` (total memory) and `GET /_ml/anomaly_detectors/_all/_stats` (sum memory of **opened**
     jobs). `GET kbn:/internal/ml/modules/get_module/{module_id}` for job count and per-job memory. If jobs do not fit,
     say so and suggest prioritizing job groups — do not deploy anyway without the user accepting the risk.
   - Rules: `GET kbn:/api/detection_engine/rules/prepackaged/_status` and
     `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_review` filtered by the package detection tag.

4. **Present a plan and wait for confirmation.** Show package identity and status, source-data hits (warn if all zero),
   template/pipeline merge-or-create, transform count and states, data-view presence, ML memory fit, and rule count.
   **Do not call any write API until the user confirms.** If they decline, stop.

5. **Install the Fleet package, then apply shared mappings.** After confirmation:
   - `POST kbn:/api/fleet/epm/packages/{package}` to install assets (transforms may be deferred until started).
   - If the package uses a component template: `PUT /_component_template/{name}` with the merged or new body. Then
     `POST /{data_stream}/_rollover` on the rollover target so new indices pick up mappings.
   - If the package uses an ingest pipeline: `PUT /_ingest/pipeline/{name}` with appended or new processors. Use the
     installed package version in the versioned pipeline name.

   Skip template, pipeline, and rollover when the package row has no values for them (beaconing, ded, lmd).

6. **Start transforms and create destination aliases.** Skip this block (except `.ml-anomalies-shared`) when the package
   has no transform pattern. Fleet's first checkpoint often skips `.all` aliases. After install,
   `GET /_transform/{pattern}` again if IDs were missing. Reset only if the transform is new, never started, failed, or
   the user asked to rebuild: `POST /_transform/{id}/_stop`, `POST /_transform/{id}/_reset`,
   `POST /_transform/{id}/_update` with the existing description, `POST /_transform/{id}/_start`,
   `POST /_transform/{id}/_schedule_now`. If already `started` with `checkpointing.last.checkpoint >= 1`, skip reset;
   restamp via the existing description and ensure `.all` aliases exist. Then `POST /_aliases` to add the `.all` alias
   (and `.latest` if the dest defines it) on `dest.index`. If a data-view pattern is missing,
   `POST kbn:/api/data_views/data_view`. Also ensure a hidden `.ml-anomalies-shared` data view exists
   (`POST kbn:/api/data_views/data_view`) so package dashboards resolve.

7. **Confirm the first transform checkpoint before ML.** If the package row has no transform pattern, skip this step and
   continue to jobs. Otherwise call `GET /_transform/{pattern}/_stats`. Proceed only when each transform is `started`
   and `checkpointing.last.checkpoint >= 1`; do not use `documents_processed` as a substitute. Zero documents with a
   completed checkpoint is acceptable when source patterns are empty — destination aliases still let datafeeds start.
   Otherwise tell the user transforms must finish processing and **wait for confirmation** before the next step. Never
   set up the ML module against missing dest indices.

8. **Deploy ML jobs, then detection rules.** After transforms are confirmed (or skipped):
   - `POST kbn:/internal/ml/modules/setup/{module_id}` with `startDatafeed: true` and `indexPatternName` set to the
     package data-view pattern, or source patterns when that cell is empty. **Do not put spaces after commas** in
     `indexPatternName` — the setup API splits on commas without trimming. Correct:
     `logs-*,ml_okta_multiple_user_sessions_pad.all,ml_windows_privilege_type_pad.all`.
   - Initialize the detection engine if needed (`POST kbn:/api/detection_engine/index`), install the prebuilt rules
     package (`POST kbn:/api/fleet/epm/packages/security_detection_engine`), review the package-tagged rules, then call
     `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_perform` with
     `{"mode":"SPECIFIC_RULES","rules":[{"rule_id":"<rule_id>","version":<version>}]}` (one entry per reviewed rule).
     Enable the package's ML rules with `POST kbn:/api/detection_engine/rules/_bulk_action` (`disable` then `enable` on
     immutable ML rules tagged with the package detection tag so API keys are stamped with the calling user).

9. **Report created versus skipped.** Package version and asset count; template/pipeline/rollover created, updated, or
   skipped; transforms started; data views created or already present; ML jobs and datafeeds started (and any that
   failed, with the mapping or index reason); rules installed and enabled.

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
- Never overwrite shared `@custom` templates or pipelines. PAD and ProblemChild share
  `logs-endpoint.events.process@custom` — merge fields and append processors.
- Put no spaces after commas in ML `indexPatternName`.
- Cite Fleet package APIs as `kbn:/api/fleet/...`. Do not use a `fleet:` prefix.
- Restamp a Fleet transform by setting `--description` to the existing text, then start. Do not use `--body '{}'`.
- On serverless, `GET /_ml/info` may return 410. Continue with opened-job stats from
  `GET /_ml/anomaly_detectors/_all/_stats`; do not abort the install.

## Operations

| HTTP API (shorthand)                                                       | `elastic` CLI command                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET kbn:/api/fleet/epm/packages/{package}`                                | `elastic kb elastic-package-manager-epm get-fleet-epm-packages-pkgname --pkg-name '{package}'`                  |
| `GET kbn:/api/fleet/epm/packages/{package}/{version}/docs/README.md`       | CLI gap — package-file fetch 404s on registry paths; keep this shorthand as the contract                        |
| `POST kbn:/api/fleet/epm/packages/{package}`                               | `elastic kb elastic-package-manager-epm post-fleet-epm-packages-pkgname --pkg-name '{package}'`                 |
| `POST /{source_patterns}/_search`                                          | `elastic es count --index '{source_patterns}' --allow-no-indices true --ignore-unavailable true`                |
| `GET /_component_template/{name}`                                          | `elastic es cluster get-component-template --name '{name}'`                                                     |
| `PUT /_component_template/{name}`                                          | `elastic es cluster put-component-template --name '{name}' --template '{json}'`                                 |
| `GET /_ingest/pipeline/{name}`                                             | `elastic es ingest get-pipeline --id '{name}'`                                                                  |
| `PUT /_ingest/pipeline/{name}`                                             | `elastic es ingest put-pipeline --id '{name}' --input-file '{path}'`                                            |
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
| `GET /_ml/anomaly_detectors/_all/_stats`                                   | `elastic es ml get-job-stats --job-id '_all'`                                                                   |
| `GET kbn:/internal/ml/modules/get_module/{module_id}`                      | CLI gap — ML module get is an internal Kibana API; keep this shorthand as the contract                          |
| `POST kbn:/internal/ml/modules/setup/{module_id}`                          | CLI gap — ML module setup is an internal Kibana API; keep this shorthand as the contract                        |
| `GET kbn:/api/detection_engine/rules/prepackaged/_status`                  | CLI gap — no generated prepackaged-status command; keep this shorthand as the contract                          |
| `POST kbn:/api/detection_engine/index`                                     | CLI gap — no generated detection-engine index command; keep this shorthand as the contract                      |
| `POST kbn:/api/fleet/epm/packages/security_detection_engine`               | `elastic kb elastic-package-manager-epm post-fleet-epm-packages-pkgname --pkg-name 'security_detection_engine'` |
| `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_review`  | CLI gap — prebuilt-rule review is an internal Kibana API; keep this shorthand as the contract                   |
| `POST kbn:/internal/detection_engine/prebuilt_rules/installation/_perform` | CLI gap — prebuilt-rule install is an internal Kibana API; keep this shorthand as the contract                  |
| `POST kbn:/api/detection_engine/rules/_bulk_action`                        | CLI gap — generated `perform-rules-bulk-action` accepts only `edit`; keep this shorthand for disable/enable     |

Internal ML-module APIs, prebuilt-rules `_review`/`_perform`, detection-engine index, and rules disable/enable have no
usable generated CLI commands yet. Keep the HTTP shorthand as the contract; do not add skill-owned scripts as a
workaround. Generated Fleet EPM get/install commands exist — use those instead of the shorthand.
