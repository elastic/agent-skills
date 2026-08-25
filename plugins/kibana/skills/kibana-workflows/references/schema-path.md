# Schema path (last resort)

Hand-author workflow YAML from the raw JSON Schema. Use **only** when the `platform.workflows.*` discovery tools are not
registered on the target Kibana — in practice Kibana 9.4 or a deployment without Agent Builder; from 9.5 and on
Serverless the tools are registered and visible by default.

Measured cost of this path on a representative task: **942s wall / 50 turns / $1.63** vs 206s / 25 / $0.57 on the
Discovery-tools path — the ~2 MB schema keeps bleeding into context. Treat it as a compatibility fallback, never a
preference. See [path-performance.md](path-performance.md) for the full benchmark.

## Process

1. **Capture the user's intent before writing YAML.** Identify, in order, the trigger (`manual` / `scheduled` /
   `alert`), the runtime inputs, the data sources to read, the actions to take, and the desired output. If a required
   dependency is unknown (e.g. a Slack connector id), ask the user or use a clearly-marked placeholder.

2. **Discover the current schema.** Call `GET kbn:/api/workflows/schema?loose=false` — the strict, space-aware JSON
   Schema for every step type on the target Kibana. It is large (~2 MB); save it to a file and grep for the exact `type`
   consts you need rather than dumping it into context. Get connector instance ids from
   `GET kbn:/api/workflows/connectors`.

3. **Draft YAML that follows the discovered schema.** A workflow requires `name`, at least one trigger, and a non-empty
   `steps` array. `version: '1'` is optional and defaults to `1`. Use 2-space indentation. Fields outside `with` depend
   on the step type.

   Load references progressively:
   - [Workflow YAML Reference](workflow-yaml-reference.md) for root structure, triggers, templating, control flow.
   - [Generation Tips](generation-tips.md) when repairing or validating a draft.
   - [Workflow Patterns](workflow-patterns.md) when mapping a complex request to a workflow shape.
   - [Demo Test Loop](demo-test-loop.md) only for the safe hello-world lifecycle.

4. **Test, save, and run** per the Test / save / run section in [SKILL.md](../SKILL.md).
