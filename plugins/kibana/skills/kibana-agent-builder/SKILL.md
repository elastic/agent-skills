---
name: kibana-agent-builder
description: >
  Create and manage Kibana Agent Builder agents and custom tools. Use when asked to
  create, update, delete, test, or inspect agents or tools in Agent Builder, or when
  the user wants to understand what agents or tools already exist.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
---

# Kibana Agent Builder

Create, inspect, update, delete, and test Agent Builder **tools** and **agents**. Ground LLM responses in Elasticsearch
data through scoped search tools, parameterized ES|QL, and workflow integrations.

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

## Resource model

Agent Builder exposes three distinct resource kinds — do not conflate them:

| Kind                    | Purpose                                                                                            | Typical API                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Tool**                | Reusable function an agent invokes to retrieve or act on data (`index_search`, `esql`, `workflow`) | `POST kbn:/api/agent_builder/tools`          |
| **Agent**               | LLM entity with instructions and a curated toolset                                                 | `POST kbn:/api/agent_builder/agents`         |
| **Chat / conversation** | Ephemeral messaging session with an existing agent                                                 | `POST kbn:/api/agent_builder/converse/async` |

Creating a tool does **not** create an agent. Listing or chatting with an agent does **not** create a tool. When the
user asks to "create an agent" or "create a tool," identify which resource they mean before calling a write API.

Built-in tools use the `platform.core.*` prefix (for example `platform.core.search`). Custom tools and agents are
user-defined. Read [architecture-guide.md](references/architecture-guide.md) for built-in tool inventory, context
engineering, and security notes.

## Process

1. **Classify the task.** Decide whether the user needs a **tool**, an **agent**, or **chat** with an existing agent. If
   they ask what already exists ("what agents are there?", "list agents"), treat the request as **read-only discovery**
   — answer from live data before proposing any create, update, or delete.

2. **Discover existing resources before any write.** When creating or updating:
   - Call `GET kbn:/api/agent_builder/tools` to list available tools (built-in and custom). Do not invent tool IDs.
   - Call `GET kbn:/api/agent_builder/agents` to list existing agents and avoid duplicate IDs or names.

   When the user only asks what agents exist, stop after `GET kbn:/api/agent_builder/agents`. Enumerate each agent's id
   and name. If the list is empty, say so plainly — do not fabricate agents. Only proceed to creation when the user
   explicitly asks to create one and you have confirmed the target id is unused.

3. **Choose the tool type (for tool tasks).** Match intent to the narrowest tool type:
   - **Open-ended search over a known index pattern** → `index_search` with a **specific pattern** (for example
     `customer-feedback-*`), never `*` or all-indices scope unless the user explicitly requires it.
   - **Fixed analytics, aggregations, or parameterized queries** → `esql` with `?param` placeholders and a `params`
     object (use `{}` when there are no parameters).
   - **Multi-step automation beyond retrieval** → `workflow` referencing an existing workflow id.

   For ES|QL syntax and query design, follow the `elasticsearch-esql` skill. For workflow YAML, follow the
   `kibana-workflows` skill.

4. **Build the tool payload.** Required fields: `id`, `type`, `description`, `configuration`. Optional: `tags`.

   **API constraints** (violations return 400):
   - POST accepts only `id`, `type`, `description`, `configuration`, `tags`. **`name` is not valid** on tools.
   - Index search configuration uses `"pattern"`, **not** `"index"`.
   - ES|QL tools require `"params"` even when empty: `"params": {}`.
   - Each param accepts only `type` and `description` — not `default` or `optional`. Hard-code defaults in the query.
   - PUT on tools accepts only `description`, `configuration`, and `tags`. `id` and `type` are immutable.

   **Index search example** (scoped pattern):

   ```json
   {
     "id": "customer_feedback_search",
     "type": "index_search",
     "description": "Searches customer feedback and support tickets in the customer-feedback indices.",
     "configuration": {
       "pattern": "customer-feedback-*"
     }
   }
   ```

   **ES|QL example** (parameterized, with LIMIT):

   ```json
   {
     "id": "feedback_sentiment_trend",
     "type": "esql",
     "description": "Returns positive vs negative feedback counts by product category over a lookback window.",
     "configuration": {
       "query": "FROM customer-feedback-* | WHERE @timestamp >= NOW() - ?lookback_days::integer * 1d | STATS positive = COUNT(*) WHERE sentiment == \"positive\", negative = COUNT(*) WHERE sentiment == \"negative\" BY product_category | SORT negative DESC | LIMIT 20",
       "params": {
         "lookback_days": {
           "type": "integer",
           "description": "Number of days to look back, e.g. 7, 30, 90"
         }
       }
     }
   }
   ```

5. **Create and verify the tool.** Call `POST kbn:/api/agent_builder/tools` with the payload. Confirm success by calling
   `GET kbn:/api/agent_builder/tools/{toolId}` and reporting the created id, type, description, and configuration back
   to the user — do not claim success without a live API response.

   Optionally validate ES|QL tools with `POST kbn:/api/agent_builder/tools/_execute`, passing `tool_id` and
   `tool_params`. Always include `| LIMIT N` in ES|QL queries to control token use.

6. **Build the agent payload (for agent tasks).** Required fields: `id`, `name`, `description`, `configuration`.
   Configuration must include `instructions` and a `tools` array with `tool_ids` drawn from Step 2 — only IDs returned
   by `GET kbn:/api/agent_builder/tools`.

   Derive a stable `id` from the name (lowercase, hyphens, alphanumeric). Check Step 2's agent list for conflicts before
   posting.

   ```json
   {
     "id": "customer-feedback-agent",
     "name": "Customer Feedback Analyst",
     "description": "Analyzes customer sentiment and feedback trends.",
     "configuration": {
       "instructions": "Always use tools to retrieve data. Never answer data questions from memory.",
       "tools": [
         {
           "tool_ids": ["customer_feedback_search", "platform.core.search"]
         }
       ]
     }
   }
   ```

   **Agent update constraints:** PUT accepts only `description`, `configuration`, and `tags` (plus avatar/labels when
   applicable). Do not send immutable fields like `id`, `name`, or `type` on update — they cause 400 errors.

7. **Create and verify the agent.** Call `POST kbn:/api/agent_builder/agents`. Confirm with
   `GET kbn:/api/agent_builder/agents` or `GET kbn:/api/agent_builder/agents/{agentId}`. Report the live response.

8. **Update or delete (when requested).** Confirm destructive actions with the user first.
   - Update tool: `PUT kbn:/api/agent_builder/tools/{toolId}`
   - Delete tool: `DELETE kbn:/api/agent_builder/tools/{toolId}`
   - Update agent: `PUT kbn:/api/agent_builder/agents/{agentId}`
   - Delete agent: `DELETE kbn:/api/agent_builder/agents/{agentId}`

9. **Chat (when requested).** Chat is not agent or tool creation. Use `POST kbn:/api/agent_builder/converse/async` with
   an existing `agent_id` and user input. Expect multi-step reasoning and tool calls; allow sufficient time for
   streaming completion.

## Guidelines

- **Discover before create.** Always list agents (and tools when relevant) before creating resources. When asked "what
  agents exist?", answer that question first — read-only — even if the user also mentions wanting a new agent later.
- **Scope index search narrowly.** Prefer `customer-feedback-*` over `*`. Broad patterns increase noise, token cost, and
  RBAC surface area.
- **Write descriptive tool descriptions.** The agent selects tools based on descriptions alone — include when to use
  each tool and example trigger phrases.
- **Minimize toolsets.** Every assigned tool adds tokens to the agent system prompt on every turn.
- **Validate ES|QL before deployment.** Execute the tool after creation when parameters or query shape are non-trivial.
- **Use aggregations and KEEP.** Prefer summary stats over raw document dumps for analytics questions.

## Examples

### Create an index search tool (eval pattern)

User: "Create a custom Agent Builder tool that searches the customer-feedback-\* index. Use the tool id
'eval-feedback-search'."

1. List tools — confirm `eval-feedback-search` does not already exist.
2. Choose `index_search` scoped to `customer-feedback-*` (not `*`).
3. POST the tool with id, description, and `configuration.pattern`.
4. GET the tool by id and confirm creation to the user.

### Answer "what agents already exist?" before creating

User: "I want to create a new agent in Kibana Agent Builder. What agents already exist?"

1. Call `GET kbn:/api/agent_builder/agents` — read-only.
2. Enumerate existing agent ids and names (or state that none exist).
3. Do **not** create, update, or delete anything in this step.
4. Only if the user then asks to create, pick an unused id informed by the list above.

### Create an agent after discovery

User: "Create a sales-helper agent using the esql-sales-data tool."

1. List tools — confirm `esql-sales-data` exists.
2. List agents — confirm no conflicting id.
3. POST agent with instructions and selected tool IDs.
4. GET agent to verify and report back.

## References

- [architecture-guide.md](references/architecture-guide.md) — Built-in tools, context engineering, token optimization,
  MCP/A2A integration, permissions
- [use-cases.md](references/use-cases.md) — Playbooks for customer feedback, marketing campaign, and contract analysis
  agents with example tool and agent payloads

## Operations

| HTTP API (shorthand)                             | `elastic` CLI command                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET kbn:/api/agent_builder/tools`               | `elastic kb agent-builder get-agent-builder-tools`                                                                                 |
| `POST kbn:/api/agent_builder/tools`              | `elastic kb agent-builder post-agent-builder-tools --id '<id>' --type '<type>' --description '<desc>' --configuration '<json>'`    |
| `GET kbn:/api/agent_builder/tools/{toolId}`      | `elastic kb agent-builder get-agent-builder-tools-toolid --tool-id '<toolId>'`                                                     |
| `PUT kbn:/api/agent_builder/tools/{toolId}`      | `elastic kb agent-builder put-agent-builder-tools-toolid --tool-id '<toolId>' [--description '<desc>'] [--configuration '<json>']` |
| `DELETE kbn:/api/agent_builder/tools/{toolId}`   | `elastic kb agent-builder delete-agent-builder-tools-toolid --tool-id '<toolId>' [--force]`                                        |
| `POST kbn:/api/agent_builder/tools/_execute`     | `elastic kb agent-builder post-agent-builder-tools-execute --tool-id '<toolId>' --tool-params '<json>'`                            |
| `GET kbn:/api/agent_builder/agents`              | `elastic kb agent-builder get-agent-builder-agents`                                                                                |
| `POST kbn:/api/agent_builder/agents`             | `elastic kb agent-builder post-agent-builder-agents --id '<id>' --name '<name>' --description '<desc>' --configuration '<json>'`   |
| `GET kbn:/api/agent_builder/agents/{agentId}`    | `elastic kb agent-builder get-agent-builder-agents-id --id '<agentId>'`                                                            |
| `PUT kbn:/api/agent_builder/agents/{agentId}`    | `elastic kb agent-builder put-agent-builder-agents-id --id '<agentId>' [--description '<desc>'] [--configuration '<json>']`        |
| `DELETE kbn:/api/agent_builder/agents/{agentId}` | `elastic kb agent-builder delete-agent-builder-agents-id --id '<agentId>'`                                                         |
| `POST kbn:/api/agent_builder/converse/async`     | `elastic kb agent-builder post-agent-builder-converse-async --agent-id '<agentId>' --input '<message>'`                            |
