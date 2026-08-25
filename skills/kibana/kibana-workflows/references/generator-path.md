# Generator path (optional, fastest-to-author / cheapest)

> Preserved reference. Not the default path — see [SKILL.md](../SKILL.md) for the shipped Discovery-tools path and the
> measured [path benchmark](../SKILL.md#path-performance-measured). This path drives Kibana's own
> `platform.core.generate_workflow` by proxying through an Agent Builder `converse` turn. It needs an LLM connector
> wired into Agent Builder. It is the **cheapest** measured path (most generation happens inside Kibana, not in the
> 3rd-party agent's billed context) and becomes the outright best once `generate_workflow` is exposed as a standalone
> API/CLI — tracked in [security-team#18614](https://github.com/elastic/security-team/issues/18614).

## Generator path

Direct `POST /api/agent_builder/tools/_execute` on `platform.core.generate_workflow` returns only an `attachment_id`
that lives on a conversation which doesn't exist outside of Agent Builder — the raw YAML can't be retrieved. The
practical way to reach the generator from a 3rd-party agent is to **proxy the request through an Agent Builder converse
turn**, then fetch the emitted workflow attachment from that conversation. One converse turn inside Kibana runs the AB
workflow-authoring skill end-to-end (typically <10s, ~4 LLM calls) and produces raw YAML you can then save, test, and
run through the plain workflows API.

Upstream tracking issue: [security-team#18614](https://github.com/elastic/security-team/issues/18614) asks for a
standalone endpoint that returns the YAML inline; until it lands, use the recipe below.

1. **Capture the user's intent as a natural-language brief.** Include: trigger (manual / scheduled / alert), the inputs
   the workflow receives at runtime, data sources to read, actions to take, and the desired output. If a required
   dependency is unknown (e.g. a Slack connector id), say so in the brief — the generator will slot in a placeholder or
   use a configured connector.

2. **Send the brief through Agent Builder converse, asking for inline YAML.** Build a JSON payload:

   ````json
   {
     "input": "<brief>. Return the full YAML in a fenced ```yaml code block in your reply, and do not save the workflow."
   }
   ````

   The trailing "return the full YAML in a fenced `yaml` block" instruction is load-bearing — without it, the AB agent
   only emits a `<render_attachment id="..."/>` placeholder and you need a second API call to fetch the body. With the
   instruction, the agent internally calls `attachments.read` on its own generated attachment and inlines the YAML in
   `.response.message`.

   Call `POST kbn:/api/agent_builder/converse` with the payload. Write the response to a file (do **not** pipe through
   inline `python3 -c` — multi-line JSON breaks trivially on shell quoting). Capture:
   - `conversation_id` — for cleanup in step 4.
   - `.response.message` — the assistant text containing the YAML in a fenced block.

   Do **not** pre-fetch step definitions, connectors, or the schema — the AB skill already has that knowledge built in.

3. **Extract the YAML.** Read the fenced `yaml` block from `.response.message` and save the raw YAML to a local file for
   the next steps. If the block is missing (rare), fall back to
   `GET kbn:/api/agent_builder/conversations/{conversation_id}/attachments` and read the `workflow.yaml` entry's
   `.versions[-1].data.yaml`.

4. **Clean up the throwaway conversation** with `DELETE kbn:/api/agent_builder/conversations/{conversation_id}` so it
   doesn't clutter the user's history.

5. **Validate before executing.** Call `platform.workflows.validate_workflow` via `/tools/_execute` with
   `{ "yaml": "..." }`. On failure it returns the errors _plus_ the step definitions for every referenced step type, so
   a second `get_step_definitions` call is usually unnecessary. Fix each error, then re-validate. If the AB generator
   produced invalid YAML, prefer sending a follow-up converse turn (`conversation_id: <the previous cid>`,
   `input: "the YAML failed validation with: ...  please fix"`) over hand-editing — the generator can re-emit a
   corrected attachment.

6. **Test only an execution-safe draft.** Use the standard workflow test path (`POST kbn:/api/workflows/test`) — Agent
   Builder does not replace this. For read-only or explicitly authorized workflows, test as-is. Otherwise, ask the AB
   generator to produce a "console-only" copy first (converse: "convert this workflow to replace every side-effecting
   step with a console log describing what it would do").

   For iterating on a single step in isolation, use `platform.workflows.workflow_execute_step`. Safe steps (read-only
   ES, `data.*`, `console`, `if`) run immediately. Unsafe steps (HTTP, ES writes, connectors, AI) require user
   confirmation via a `confirmation_body` param — always populate it with a Markdown preview describing resolved inputs,
   the side effect, and whether it's reversible.

7. **Save and run** via the plain workflows API: `POST kbn:/api/workflows/workflow` (leave `enabled: false` when the
   workflow has un-tested side effects), then `POST kbn:/api/workflows/workflow/{id}/run` when the user authorizes.

8. **Use discovery tools only for questions.** `get_step_definitions`, `get_trigger_definitions`, `get_examples`, and
   `get_connectors` are for answering the user's questions ("what does the http step output?", "which Slack connectors
   are configured?"), for debugging a validation error the generator couldn't fix, or for surfacing a legacy step type
   (`includeDeprecated: true`). They are not preparation for the generator turn.
