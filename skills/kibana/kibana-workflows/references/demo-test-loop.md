# Demo Test Loop

A minimal, side-effect-free demo of the test, save, run, inspect, and delete lifecycle. Use it to sanity-check a fresh
environment or as the canonical "hello world" when teaching the skill.

## Prompt

```text
Use the kibana-workflows skill. Create a manual workflow named "Manual Hello Workflow" that accepts
a `name` input and logs `Hello {{ inputs.name }}`. Test the draft, then save, run, and inspect the
execution.
```

## Expected YAML Draft

```yaml
version: "1"
name: Manual Hello Workflow
description: Logs a greeting from a manual workflow
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

## 1. Test The Draft

Write the YAML to `workflow.yaml`, then build a JSON input file for `POST kbn:/api/workflows/test`:

```json
{
  "workflowYaml": "version: '1'\nname: Manual Hello Workflow\nenabled: true\ntriggers:\n  - type: manual\n    inputs:\n      properties:\n        name:\n          type: string\n          default: world\nsteps:\n  - name: log_hello\n    type: console\n    with:\n      message: \"Hello {{ inputs.name }}\"\n",
  "inputs": { "name": "world" }
}
```

Save as `/tmp/workflow-test.json`. The response includes `workflowExecutionId`.

Use the [Operations](../SKILL.md#operations) table to map each HTTP shorthand below to the corresponding `elastic` CLI
command.

## 2. Wait For The Execution

Poll `GET kbn:/api/workflows/executions/{executionId}` until `status` is one of `completed`, `failed`, `cancelled`, or
`timed_out`. If it never reaches a terminal state within a minute, something is wrong with the workflow or the host.

## 3. Inspect Logs

Call `GET kbn:/api/workflows/executions/{executionId}/logs` and confirm the `console` step printed `Hello world` (or
`Hello <inputs.name>` if a different value was passed).

## 4. Save And Run

Once the draft tests green, save it with `POST kbn:/api/workflows/workflow` using
`{ "yaml": "...", "id": "manual-hello-workflow" }`, then call `POST kbn:/api/workflows/workflow/{id}/run` with the same
inputs.

## 5. Clean Up

Permanently delete the disposable demo with `DELETE kbn:/api/workflows/workflow/{id}?force=true` so its explicit ID can
be reused. Omit `force=true` when normal recoverable deletion is preferable.

## Success Criteria

- The skill loads in the host agent (Claude Code, Cursor, Codex, agent-builder).
- The generated YAML uses explicit `version: '1'`, a manual trigger with `inputs.properties`, and a `console` step.
- `POST kbn:/api/workflows/test` returns a `workflowExecutionId` and the execution reaches `status=completed`.
- The execution logs include `Hello world` (or the alternate input value).
- The full lifecycle — test → save → run → execution → logs → delete — completes without errors.
