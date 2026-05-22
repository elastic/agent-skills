# Elastic Agent Builder Architecture Guide

Elastic Agent Builder is a framework built into Elasticsearch/Kibana that creates AI agents grounded in your
Elasticsearch data. It combines LLMs with Elasticsearch's search, analytics, and relevance capabilities into a unified
platform — no separate vector database, RAG pipeline, or tool orchestrator needed.

**Docs**: [Elastic Agent Builder](https://www.elastic.co/docs/explore-analyze/ai-features/elastic-agent-builder)

## Core Concepts

### Three Building Blocks

**1. Chat UI** — A real-time conversational interface (in Kibana or via API) to interact with agents.

**2. Agents** — LLM-powered entities that follow custom instructions and use tools to answer questions, run analytics,
or drive workflows. Two flavors:

- **Built-in agents** — Pre-configured, ready to chat with your data immediately
- **Custom agents** — User-defined system prompt + curated toolset + security profile

**3. Tools** — Modular, reusable functions agents invoke to retrieve or manipulate data. Two flavors:

- **Built-in tools** (prefixed `platform.core.*`) — Ship out of the box
- **Custom tools** — ES|QL tools, index search tools, or workflow tools you define

## Built-in Tools Reference

| Tool ID                               | Purpose                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `platform.core.search`                | Translates natural language into hybrid/semantic/structured queries |
| `platform.core.list_indices`          | Lists available indices                                             |
| `platform.core.get_index_mapping`     | Retrieves field mappings for an index                               |
| `platform.core.get_document_by_id`    | Fetches a specific document by ID                                   |
| `platform.core.execute_esql`          | Generates and executes ES\|QL from natural language                 |
| `platform.core.generate_esql`         | Generates ES\|QL without executing it                               |
| `platform.core.index_explorer`        | Selects the most relevant index from multiple candidates            |
| `platform.core.create_visualization`  | Creates Kibana visualizations from ES\|QL                           |
| `platform.core.integration_knowledge` | Retrieves knowledge from Fleet-installed integrations               |
| `platform.core.product_documentation` | Searches Elastic product documentation                              |

`platform.core.search` is the primary context retrieval tool — it handles hybrid search automatically (lexical +
semantic via ELSER/dense vectors), selecting the right index and query type.

## Elasticsearch as a Context Engine

Agent Builder leverages Elasticsearch natively for three context engineering patterns:

### 1. Improving Context Management

- `platform.core.search` auto-selects the best index and translates natural language into optimized queries, preventing
  context window overflow
- Use **index search tools** scoped to specific indices to restrict the agent's surface area and reduce noise
- Use `platform.core.index_explorer` in multi-index environments to route queries to the right data source
- Instruct agents explicitly in their system prompt to use tools rather than rely on training knowledge

### 2. Persistent Memory Layer

Elasticsearch naturally acts as long-term memory:

- **Short-term memory**: Agent Builder's built-in chat session tracks conversation history automatically
- **Long-term memory**: Store agent outputs back to Elasticsearch indices for retrieval in future sessions
- **Cross-session context**: Index tool outputs to a dedicated memory index, then give the agent an index search tool
  scoped to that index to retrieve past reasoning
- Elastic Workflows can automate the write-back of outputs to memory indices

### 3. Hybrid Search for Relevance

`platform.core.search` and custom index search tools use Elasticsearch's full hybrid search stack:

- **Lexical** (BM25) for keyword precision
- **Semantic/vector** (ELSER sparse vectors or dense embeddings) for conceptual matching
- **FORK/FUSE** in ES|QL combines multiple search strategies using Reciprocal Rank Fusion (RRF)
- **Reranking** with Elastic Rerank or third-party models (Cohere, Vertex) for final relevance scoring
- Use `semantic_text` field type to enable out-of-the-box semantic search without managing embeddings manually

## Best Practices

### Tool Design

- **Write descriptive tool descriptions** — The agent decides which tool to call based solely on the description. Be
  explicit about when to use each tool and include example trigger phrases.
- **Scope index search tools narrowly** — Prefer `customer-feedback-*` over `*` to reduce noise and limit token
  consumption from oversized result sets.
- **Include LIMIT in every ES|QL query** — The implicit default is 1000 rows, which consumes tokens rapidly and can
  trigger `context_length_exceeded` errors.
- **Validate ES|QL before deploying** — Use the "Infer parameters from query" button in Kibana UI to auto-detect
  parameters and test with sample values.
- **Add `_meta.description` to index mappings** — Helps `platform.core.search` and `platform.core.index_explorer` select
  the right index without calling `list_indices` first.

### Agent Prompt Design

- **Explicitly instruct tool use** — LLMs sometimes answer from training data instead of calling tools. Add: "Always use
  tools to retrieve data. Never answer data questions from memory."
- **Name which tool to use for which intent** — Vague instructions lead to wrong tool selection. Be specific: "For
  sentiment trends, use `feedback_sentiment_trend`. For individual feedback, use `customer_feedback_search`."
- **Instruct the agent to ask for clarification** — Prevents broad queries when a targeted tool would suffice: "If the
  user's question is ambiguous about time range, ask for clarification before querying."

### Token Optimization

Token costs accumulate from conversation history, tool response payloads, and the number of tool calls per turn.

- **Replace broad built-in tools with focused custom tools** — Custom tools pre-define the query logic and scope, so the
  LLM only controls parameters, not the query shape. This produces smaller, more relevant result sets.
- **Limit the toolset assigned to each agent** — Every tool in an agent's toolset is included in the system prompt as a
  function definition, consuming input tokens on every call — even unused tools. Design agents with the minimum viable
  toolset.
- **Use agent instructions to enforce tool discipline** — Even with a focused toolset, an agent may call tools
  redundantly. Use the system prompt to create explicit call rules: "For trend questions, ALWAYS use
  billing_complaint_summary. Do NOT call more than one tool per user question unless the question explicitly asks for
  two things."
- **Keep tool responses small** — Use `KEEP` to return only needed columns. Prefer aggregations over raw document
  retrieval for summary questions.
- **Monitor token usage** — Agent Builder displays input and output token counts after each response in the Chat UI. Use
  the "View JSON" button to inspect the raw usage breakdown per tool call.

> **Docs**: [Monitor usage](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/monitor-usage)
> **Troubleshooting**:
> [Context length exceeded](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/troubleshooting/context-length-exceeded)

## Programmatic Access

### REST API Base Path

```text
/api/agent_builder/
```

For Kibana Spaces: `/s/<space_name>/api/agent_builder/`

### Key Endpoints

| Action                 | Method | Path                                  |
| ---------------------- | ------ | ------------------------------------- |
| List tools             | GET    | `/api/agent_builder/tools`            |
| Create tool            | POST   | `/api/agent_builder/tools`            |
| Update tool            | PUT    | `/api/agent_builder/tools/{toolId}`   |
| Delete tool            | DELETE | `/api/agent_builder/tools/{toolId}`   |
| Execute tool (testing) | POST   | `/api/agent_builder/tools/_execute`   |
| List agents            | GET    | `/api/agent_builder/agents`           |
| Create agent           | POST   | `/api/agent_builder/agents`           |
| Get agent              | GET    | `/api/agent_builder/agents/{agentId}` |
| Update agent           | PUT    | `/api/agent_builder/agents/{agentId}` |
| Delete agent           | DELETE | `/api/agent_builder/agents/{agentId}` |
| Chat with agent        | POST   | `/api/agent_builder/converse/async`   |

### MCP & A2A Integration

- **MCP server**: Exposes all built-in and custom tools to any MCP client (Claude Desktop, Cursor, VS Code). Provide
  your Kibana URL + API key in the client config.
- **A2A server**: Exposes agents to external agent frameworks, services, and apps — enabling reuse of your Elastic
  context engineering logic across integrations.

## Permissions & Security

- Tools and agents respect Elasticsearch RBAC — the API key used scopes what data is accessible
- MCP and A2A support OAuth and custom authentication mechanisms
- Custom ES|QL tools provide guardrails by pre-defining query structure — only parameters are LLM-controlled, not query
  logic
