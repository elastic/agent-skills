---
name: kibana-workflows
description: >
  Author, validate, test, run, and inspect Elastic Workflow YAML definitions. Use
  when the user wants to turn natural language into a Kibana workflow, fix workflow
  YAML, understand triggers or steps, or run a quick test loop against a real Kibana.
metadata:
  author: elastic
  version: 0.5.0
  universal: true
compatibility: Kibana 9.4 or later with matching Elasticsearch and an Enterprise license,
  or an Elastic Serverless project with Workflows available; requires the `elastic`
  CLI ≥ 0.2 with `stack kb workflows` support. When Agent Builder is enabled on the
  target Kibana, the `platform.core.generate_workflow` and `platform.workflows.*`
  tools are preferred over the raw schema.
---

# Author Elastic Workflows

Create and iterate on Elastic Workflow YAML definitions. Workflows are declarative automations that run inside Kibana:
they query Elasticsearch, set data, branch, loop, call connectors, create cases, notify external systems, and invoke AI
steps.

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

If the user asks only for a draft or explanation and explicitly forbids live access, skip connection verification and do
not call the CLI or APIs. State that the draft was not validated against a target deployment.

If workflow APIs are unavailable, report the returned status and message. Common causes are an unsupported Kibana
version, insufficient license or feature privileges, or Workflows not being offered on the target project. The
`workflows:ui:enabled` setting controls the Kibana UI; it does not remove the public Workflows APIs.

## Pick the authoring path

Default to the **Discovery-tools path** below — the `platform.workflows.*` tools are registered by default on Kibana
9.5+ and Serverless. Confirm with one probe: `GET kbn:/api/agent_builder/tools` returns
`{ "results": [ { "id": ... } ] }`; save it to a file and grep for `"id": "platform.workflows."`. Two fallbacks, both
loaded only when needed:

- No `agent_builder` endpoint (404) or no `platform.workflows.*` ids (e.g. Kibana 9.4) → read
  [references/schema-path.md](references/schema-path.md) and hand-author from the raw JSON Schema.
- An LLM connector is wired into Agent Builder and the user prefers Kibana's own generator → read
  [references/generator-path.md](references/generator-path.md).

State which path you picked and why in one sentence before proceeding. Measured path benchmarks live in
[references/path-performance.md](references/path-performance.md).

## Guidelines (all paths)

- **Treat tests as executions.** `POST kbn:/api/workflows/test` runs the workflow graph, and
  `POST kbn:/api/workflows/step/test` runs the selected step. Test only when every executed action is read-only or the
  user authorized its effects. Otherwise test a copy whose writes, notifications, and external calls are replaced with
  `console`, then restore the real steps and save the workflow disabled.
- **Cite endpoints in HTTP shorthand, never raw transport.** This skill's body refers to operations like
  `POST kbn:/api/workflows/test`. The [Operations](#operations) table is the single place where shorthand binds to a
  concrete CLI command.
- **Prefer purpose-built actions over generic `http`.** For Slack/Jira/PagerDuty/etc., prefer the connector step type
  (e.g. `slack2.sendMessage`) over a raw `http` call. Discover the exact action type via `get_step_definitions` (or the
  strict schema on the fallback path).
- **Reference step outputs as `steps.<name>.output`, never `steps.<name>.with.*`.** Trigger event data is `event`, never
  `trigger.event` or `triggers.event`.
- **Don't guess connector ids.** Call `platform.workflows.get_connectors` (Discovery-tools path) or
  `GET kbn:/api/workflows/connectors` (Schema path), or ask the user. Placeholders should be obviously fake.
- **Handle failure deliberately.** Add retry or fallback behavior where the user's requirements call for resilience. Do
  not add `continue: true` everywhere: it can hide a failed action and allow the workflow to report false success.
- **Surface gates, don't paper over them.** If the API returns `403 ... not available`, report the required license or
  privileges; do not silently retry or blame the UI setting.

## Discovery-tools path

Use when `platform.workflows.*` tools are registered on the target Kibana. All calls go through
`POST kbn:/api/agent_builder/tools/_execute` with `{ "tool_id": "...", "tool_params": { ... } }`. Response shape:
`{ "results": [ { "type": "other", "data": { ... }, "tool_result_id": "..." } ] }` — the payload you want is
`.results[0].data`. Send the request body from a file and write the response to a file (see [Operations](#operations)),
then jq against that file; do not inline `python3 -c` on multi-line JSON.

**Keep context small; minimize round-trips.** Do NOT front-load the whole step catalog — pull only the targeted details
you need, keep large tool output in files (not the transcript), and author in as few turns as possible (measured
rationale: [references/path-performance.md](references/path-performance.md)).

1. **Capture the user's intent before writing YAML.** Identify, in order, the trigger (`manual` / `scheduled` /
   `alert`), the inputs the workflow will receive at runtime, the data sources it must read, the actions it must take,
   and the desired output. If a required dependency is unknown (e.g. a Slack connector id), ask the user or use a
   clearly-marked placeholder.

2. **Look up only what you'll use.** For the specific step types this workflow needs:
   - `platform.workflows.get_step_definitions` with an exact `stepType` (e.g. `"http"`, `"elasticsearch.esql.query"`,
     `"slack2.sendMessage"`), or with `search` to browse. The response includes input params, config params, an
     `outputSummary` when you pass `includeOutputSummary: true`, and usage examples. Pass `includeFullSchema: true` only
     if the compact summary is insufficient.
   - `platform.workflows.get_trigger_definitions` for the trigger event schema.
   - `platform.workflows.get_connectors` to resolve real `connector-id` values for connector actions.
   - `platform.workflows.get_examples` when you need a working YAML shape for a pattern.

   Write each response to a file and jq the field you need — don't let full tool output land in the transcript.

3. **Draft the whole workflow in one pass.** A workflow requires `name`, at least one trigger, and a non-empty `steps`
   array. Use 2-space indentation. Reference outputs as `steps.<name>.output.*`. Build the complete YAML in a single
   edit rather than growing it across many turns.

4. **Validate once.** Call `platform.workflows.validate_workflow` with `{ "yaml": "..." }`. On failure it returns
   errors + step definitions for referenced step types automatically, so you rarely need a second `get_step_definitions`
   call. Fix all reported issues in a single edit, then re-validate.

5. **Test, save, and run.** See [Test / save / run](#test--save--run) below. Use
   `platform.workflows.workflow_execute_step` to iterate on a single step (with `confirmation_body` for unsafe steps).

## Schema path (last resort)

Only for Kibanas without the `platform.workflows.*` tools (see the probe above). Full recipe:
[references/schema-path.md](references/schema-path.md).

## Test / save / run

Shared final phase for both paths.

1. **Test only an execution-safe draft.** Call `POST kbn:/api/workflows/test` with the YAML inline as `workflowYaml` and
   the run-time `inputs`. For any workflow that writes / notifies / calls external services, replace those steps with
   `console` in the tested copy first, then restore them and save the workflow disabled.

2. **Poll the execution.** The response carries a `workflowExecutionId`. Poll
   `GET kbn:/api/workflows/executions/{executionId}` until `status` is one of `completed`, `failed`, `cancelled`, or
   `timed_out`; then fetch `GET kbn:/api/workflows/executions/{executionId}/logs` for step-by-step output. Only treat
   `status: completed` as success.

3. **Save.** `POST kbn:/api/workflows/workflow` with `{ yaml, id? }`. Save side-effecting workflows with
   `enabled: false` until the user has authorized a real run. Subsequent edits use
   `PUT kbn:/api/workflows/workflow/{id}` and may update `yaml`, `enabled`, `name`, `tags`, or `description` (partial
   updates supported).

4. **Run only when authorized.** Enable the workflow, then call `POST kbn:/api/workflows/workflow/{id}/run` with the
   same `inputs` shape used at test time. Inspect via the execution + logs endpoints.

## Workflow YAML Quick Reference

```yaml
version: "1"
name: Manual Hello Workflow
description: Logs a hello message from a manual workflow
enabled: true
tags: ["demo", "workflow"]

triggers:
  - type: manual
    inputs:
      properties:
        name:
          type: string
          description: Name to greet
          default: "world"

steps:
  - name: log_hello
    type: console
    with:
      message: "Hello {{ inputs.name }}"
```

An ordinary action step can use fields like these when its strict schema allows them:

```yaml
- name: unique_step_name
  type: step_type
  with:
    param: value
  connector-id: connector-id-for-connector-actions # connector actions only
  if: "steps.previous.output.ok: true"
  timeout: "30s"
  on-failure:
    retry:
      max-attempts: 3
      delay: "5s"
    fallback:
      - name: handle_error
        type: console
        with:
          message: "Step failed"
```

Use `{{ ... }}` when rendering text. Use `${{ ... }}` when an entire value must retain its native type, for example
`documents: "${{ steps.search.output.hits.hits }}"`.

Common step types include:

| Step type                  | Use for                            |
| -------------------------- | ---------------------------------- |
| `console`                  | Debug logging during tests         |
| `elasticsearch.search`     | Query Elasticsearch with Query DSL |
| `elasticsearch.esql.query` | Query Elasticsearch with ES\|QL    |
| `elasticsearch.bulk`       | Bulk indexing                      |
| `kibana.request`           | Call a Kibana API                  |
| `data.set`                 | Set values under `variables`       |
| `if`                       | Branch on a KQL-style condition    |
| `foreach`                  | Loop over a collection             |
| `wait`                     | Pause execution                    |
| `http`                     | Generic HTTP requests              |
| `workflow.execute`         | Run another saved workflow         |

This is not an exhaustive compatibility list. On the Discovery-tools path, `platform.workflows.get_step_definitions`
answers "does step X exist and what does it take". On the schema path, `GET kbn:/api/workflows/schema?loose=false` is
the source of truth, and `GET kbn:/api/workflows/connectors` lists configured connector instances.

`data.set` stores variables for the current execution; it does not persist durable data. Use an Elasticsearch or Kibana
write action when the user asks to retain data after the execution.

## Examples

**Manual hello (smallest possible draft):** "Make a workflow that logs hello." → manual trigger + one `console` step
that prints `Hello {{ inputs.name | default: "world" }}`. Test with `POST kbn:/api/workflows/test`. See
[Demo Test Loop](references/demo-test-loop.md).

**Scheduled health check:** "Every 5 minutes, ping `https://api.example.com/health` and log the response." → `scheduled`
trigger (`every: 5m`) + `http` step + `console`. Look up the exact `with` shape with `get_step_definitions("http")`. Add
bounded retry if requested.

**Alert-triggered case + Slack notify:** "When a Security alert fires, create a case and post to #soc-incidents." →
`alert` trigger + `foreach` over `event.alerts` + connector actions. Use `get_step_definitions("cases.createCase")` and
`get_step_definitions(search: "slack")` (current fixtures use `cases.createCase` and `slack2.sendMessage`), then
`get_connectors` for the real `connector-id`s. See [Workflow Patterns](references/workflow-patterns.md).

For unfamiliar shapes on the schema path, read [Workflow Patterns](references/workflow-patterns.md) and
[Generation Tips](references/generation-tips.md) before drafting.

## Operations

The HTTP-shorthand references in the body above bind to the `elastic` CLI commands below. Multi-line YAML and JSON
payloads are easier to pass via `--input-file <path>` than as inline flags.

**Workflows API (both paths).**

| HTTP API (shorthand)                                      | `elastic` CLI command                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /`                                                   | `elastic es info`                                                                             |
| `GET kbn:/api/workflows`                                  | `elastic stack kb workflows get-workflows`                                                    |
| `GET kbn:/api/workflows/workflow/{id}`                    | `elastic stack kb workflows get-workflows-workflow-id --id <id>`                              |
| `POST kbn:/api/workflows/workflow`                        | `elastic stack kb workflows post-workflows-workflow --input-file <path>`                      |
| `PUT kbn:/api/workflows/workflow/{id}`                    | `elastic stack kb workflows put-workflows-workflow-id --id <id> --input-file <path>`          |
| `DELETE kbn:/api/workflows/workflow/{id}`                 | `elastic stack kb workflows delete-workflows-workflow-id --id <id>`                           |
| `DELETE kbn:/api/workflows/workflow/{id}?force=true`      | `elastic stack kb workflows delete-workflows-workflow-id --id <id> --force true`              |
| `POST kbn:/api/workflows/test`                            | `elastic stack kb workflows post-workflows-test --input-file <path>`                          |
| `POST kbn:/api/workflows/workflow/{id}/run`               | `elastic stack kb workflows post-workflows-workflow-id-run --id <id> --inputs <json>`         |
| `POST kbn:/api/workflows/step/test`                       | `elastic stack kb workflows post-workflows-step-test --input-file <path>`                     |
| `GET kbn:/api/workflows/executions/{executionId}`         | `elastic stack kb workflows get-workflows-executions-executionid --execution-id <id>`         |
| `GET kbn:/api/workflows/executions/{executionId}/logs`    | `elastic stack kb workflows get-workflows-executions-executionid-logs --execution-id <id>`    |
| `POST kbn:/api/workflows/executions/{executionId}/cancel` | `elastic stack kb workflows post-workflows-executions-executionid-cancel --execution-id <id>` |
| `POST kbn:/api/workflows/executions/{executionId}/resume` | `elastic stack kb workflows post-workflows-executions-executionid-resume --execution-id <id>` |
| `GET kbn:/api/workflows/workflow/{workflowId}/executions` | `elastic stack kb workflows get-workflows-workflow-workflowid-executions --workflow-id <id>`  |
| `GET kbn:/api/workflows/schema?loose=false`               | `elastic stack kb workflows get-workflows-schema --loose false`                               |
| `GET kbn:/api/workflows/connectors`                       | `elastic stack kb workflows get-workflows-connectors`                                         |

**Agent Builder tools (Discovery-tools path).**

Every tool below is invoked through the same execute endpoint. Pass `--input-file` a JSON file with
`{ "tool_id": "...", "tool_params": { ... } }`.

| HTTP API (shorthand)                         | `elastic` CLI command                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET kbn:/api/agent_builder/tools`           | `elastic stack kb agent-builder get-agent-builder-tools`                              |
| `POST kbn:/api/agent_builder/tools/_execute` | `elastic stack kb agent-builder post-agent-builder-tools-execute --input-file <path>` |

Workflow-relevant `tool_id`s:

| `tool_id`                                    | Purpose                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `platform.workflows.validate_workflow`       | Validate a YAML string; failure response includes step definitions for referenced step types.  |
| `platform.workflows.workflow_execute_step`   | Execute one step against the real environment (with user confirmation for unsafe steps).       |
| `platform.workflows.get_step_definitions`    | Look up step type params, outputs, examples. `stepType` for exact match, `search` for keyword. |
| `platform.workflows.get_trigger_definitions` | Look up a trigger's full event schema.                                                         |
| `platform.workflows.get_connectors`          | List connector instances configured on the target.                                             |
| `platform.workflows.get_examples`            | Search the bundled example library for working YAML patterns.                                  |

**Notes.**

For `post-workflows-test`, the input file is JSON of the form `{ "workflowYaml": "...", "inputs": {} }` (or `workflowId`
in place of `workflowYaml`). For `post-workflows-workflow`, use `{ "yaml": "...", "id": "..." }` — `id` is optional. For
`put-workflows-workflow-id`, include only the fields to update from `name`, `enabled`, `tags`, `yaml`, and
`description`. Deletion is soft by default. Use `force=true` only when permanent deletion and immediate ID reuse are
intended. The Kibana API version is `2023-10-31`; the CLI sets it automatically.

When invoking read-only `get-` commands from a shell that leaves stdin open (some terminals and agent runtimes do this),
append `</dev/null` to avoid an `EAGAIN: resource temporarily unavailable` crash — e.g.
`elastic stack kb workflows get-workflows-executions-executionid --execution-id "{id}" </dev/null`.
