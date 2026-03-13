---
name: observability-llm-obs
description: >
  Monitor LLMs and agentic apps: performance, token/cost, response quality, and workflow
  orchestration. Use when the user asks about LLM monitoring, GenAI observability,
  or AI cost/quality.
metadata:
  author: elastic
  version: 0.1.0
---

# LLM and Agentic Observability

Answer user questions about monitoring LLMs and agentic components using **data ingested into Elastic** only. Focus on
LLM performance, cost and token utilization, response quality, and call chaining or agentic workflow orchestration. Use
**ES|QL**, Elasticsearch APIs, and (where needed) Kibana APIs. Do not rely on Kibana UI; the skill works without it. A
given deployment typically uses **one or more** ingestion paths (APM/OTLP traces **and/or** integration metrics/logs)—
discover what is available before querying.

## Where to look

- **Trace and metrics data (APM / OTel):** Trace data in Elastic is stored in **`traces*`** when collected by the
  Elastic APM Agent, and in **`traces-generic.otel-default`** (and similar) when collected by OpenTelemetry. Use the
  generic pattern **`traces*`** to find all trace data regardless of source. When the application is instrumented with
  OpenTelemetry (e.g. Elastic
  [Distributions of OpenTelemetry (EDOT)](https://www.elastic.co/docs/solutions/observability/get-started/opentelemetry/use-cases/llms),
  OpenLLMetry, OpenLIT, Langtrace exporting to OTLP), LLM and agent spans land in these trace data streams; metrics may
  land in **`metrics-apm*`** or metrics-generic. Query **`traces*`** and **`metrics*`** data streams for per-request and
  aggregated LLM signals.
- **Integration metrics and logs:** When the user collects data via
  [Elastic LLM integrations](https://www.elastic.co/docs/solutions/observability/applications/llm-observability)
  (OpenAI, Azure OpenAI, Azure AI Foundry, Amazon Bedrock, Bedrock AgentCore, GCP Vertex AI, etc.), metrics and logs go
  to **integration data streams** (e.g. `metrics*`, `logs*` with dataset/namespace per integration). Check which data
  streams exist.
- **Discover first:** Use Elasticsearch to list data streams or indices (e.g. `GET _data_stream`, or
  `GET traces*/_mapping`, `GET metrics*/_mapping`) and optionally sample a document to see which LLM-related fields are
  present. Do not assume both APM and integration data exist.
- **ES|QL:** Use the **elasticsearch-esql** skill for ES|QL syntax, commands, and query patterns when building queries
  against `traces*` or metrics data streams.
- **Alerts and SLOs:** Use the [Observability APIs](https://www.elastic.co/docs/solutions/observability/apis) **SLOs
  API** ([Stack](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-slo) |
  [Serverless](https://www.elastic.co/docs/api/doc/serverless/group/endpoint-slo)) and **Alerting API**
  ([Stack](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting) |
  [Serverless](https://www.elastic.co/docs/api/doc/serverless/group/endpoint-alerting)) to find SLOs and alerting rules
  that target LLM-related data (e.g. services backed by `traces*`, or integration metrics). Firing alerts or
  violated/degrading SLOs point to potential degraded performance.

## Data available in Elastic

### From traces and metrics (traces*, metrics-apm* / metrics-generic)

Spans from OTel/EDOT (and compatible SDKs) carry **span attributes** that may follow
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) or
provider-specific names. In Elasticsearch, attributes typically appear under `span.attributes` (exact key names depend
on ingestion). Common attributes:

| Purpose              | Example attribute names (OTel GenAI)                      |
| -------------------- | --------------------------------------------------------- |
| Operation / provider | `gen_ai.operation.name`, `gen_ai.provider.name`           |
| Model                | `gen_ai.request.model`, `gen_ai.response.model`           |
| Token usage          | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` |
| Request config       | `gen_ai.request.temperature`, `gen_ai.request.max_tokens` |
| Errors               | `error.type`                                              |
| Conversation / agent | `gen_ai.conversation.id`; tool/agent spans as child spans |

Cost is **not** in the OTel spec; some instrumentations add custom attributes (e.g. `llm.response.cost.usd_estimate`).
Discover actual field names from the index mapping or a sample document (e.g. `span.attributes.*` or flattened keys).

Use **duration** and **event.outcome** on spans for latency and success/failure. Use **trace.id**, **span.id**, and
parent/child span relationships to analyze **call chaining** and agentic workflows (e.g. one root span, multiple LLM or
tool-call child spans).

### From LLM integrations

Integrations (OpenAI, Azure OpenAI, Azure AI Foundry, Bedrock, Bedrock AgentCore, Vertex AI, etc.) ship **metrics** (and
where supported **logs**) to Elastic. Metrics typically include token usage, request counts, latency, and—where the
integration supports it—cost-related fields. Logs may include prompt/response or guardrail events. Exact field names and
data streams are defined by each integration package; discover them from the integration docs or from the target data
stream mapping.

## Determine what data is available

1. **List data streams:** `GET _data_stream` and filter for `traces*`, `metrics-apm*` (or `metrics*`), and `metrics-*` /
   `logs-*` that match known LLM integration datasets (e.g. from
   [Elastic LLM observability](https://www.elastic.co/docs/solutions/observability/applications/llm-observability)).
2. **Inspect trace indices:** For `traces*`, run a small search or use mapping to see if spans contain `gen_ai.*` or
   `llm.*` (or similar) attributes. Confirm presence of token, model, and duration fields.
3. **Inspect integration indices:** For metrics/logs data streams, check mapping or one document to see token, cost,
   latency, and model dimensions.
4. **Use one source per use case:** If both APM and integration data exist, prefer one consistent source for a given
   question (e.g. use traces for per-request chain analysis, integration metrics for aggregate token/cost).
5. **Check alerts and SLOs:** Use the SLOs API and Alerting API to list SLOs and alerting rules that target LLM-related
   services or integration metrics, and to get open or recently fired alerts. Firing alerts or SLOs in
   degrading/violated status point to potential degraded performance.

## Use cases and query patterns

### LLM performance (latency, throughput, errors)

- **Traces:** ES|QL on `traces*` filtered by span attributes (e.g. `gen_ai.operation.name` or `gen_ai.provider.name`
  when present). Compute throughput (count per time bucket), latency (e.g. `duration.us` or span duration), and error
  rate (`event.outcome == "failure"`) by model, service, or time.
- **Integrations:** Query integration metrics for request rate, latency, and error metrics by model/dimension as exposed
  by the integration.

### Cost and token utilization

- **Traces:** Aggregate from spans in `traces*`: sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` (or
  equivalent attribute names) by time, model, or service. If a cost attribute exists (e.g. custom
  `llm.response.cost.*`), sum it for cost views.
- **Integrations:** Use integration metrics that expose token counts and/or cost; aggregate by time and model.

### Response quality and safety

- **Traces:** Use `event.outcome`, `error.type`, and span attributes (e.g. `gen_ai.response.finish_reasons`) in
  `traces*` to identify failures, timeouts, or content filters. Correlate with prompts/responses if captured in
  attributes (e.g. `gen_ai.input.messages`, `gen_ai.output.messages`) and not redacted.
- **Integrations:** Query integration logs for guardrail blocks, content filter events, or policy violations (e.g.
  [Bedrock Guardrails](https://www.elastic.co/observability-labs/blog/llm-observability-amazon-bedrock-guardrails))
  using the fields defined by that integration.

### Call chaining and agentic workflow orchestration

- **Traces only:** Use **trace hierarchy** in `traces*`. Filter by root service or trace attributes; group by `trace.id`
  and use parent/child span relationships (e.g. `parent.id`, `span.id`) to reconstruct chains (e.g. orchestration span →
  multiple LLM or tool-call spans). Aggregate by span name or `gen_ai.operation.name` to see distribution of steps (e.g.
  retrieval, LLM, tool use). Duration per span and per trace gives bottleneck and end-to-end latency.

## Using ES|QL for LLM data

- **Availability:** ES|QL is available in Elasticsearch 8.11+ (GA in 8.14) and in Elastic Observability Serverless.
- **Scoping:** Always restrict by time range (`@timestamp`). When present, add `service.name` and optionally
  `service.environment`. For LLM-specific spans, filter by span attributes once you know the field names (e.g. a keyword
  field for `gen_ai.provider.name` or `gen_ai.operation.name`).
- **Performance:** Use `LIMIT`, coarse time buckets when only trends are needed, and avoid full scans over large
  windows.

## Workflow

```text
LLM observability progress:
- [ ] Step 1: Determine available data (traces*, metrics-apm* or metrics*, or integration data streams)
- [ ] Step 2: Discover LLM-related field names (mapping or sample doc)
- [ ] Step 3: Run ES|QL or Elasticsearch queries for the user's question (performance, cost, quality, orchestration)
- [ ] Step 4: Check for active alerts or SLOs defined on LLM-related data (Alerting API, SLOs API); field names from
        Step 2 help identify related rules; firing alerts or violated/degrading SLOs indicate potential degraded performance
- [ ] Step 5: Summarize findings from ingested data only; include alert/SLO status when relevant
```

## Examples

### Example: Token usage over time from traces

Assume span attributes are available as `span.attributes.gen_ai.usage.input_tokens` and
`span.attributes.gen_ai.usage.output_tokens` (adjust to actual field names from mapping):

```esql
FROM traces*
| WHERE @timestamp >= "2025-03-01T00:00:00Z" AND @timestamp <= "2025-03-01T23:59:59Z"
  AND span.attributes.gen_ai.provider.name IS NOT NULL
| STATS
    input_tokens = SUM(span.attributes.gen_ai.usage.input_tokens),
    output_tokens = SUM(span.attributes.gen_ai.usage.output_tokens)
  BY BUCKET(@timestamp, 1 hour), span.attributes.gen_ai.request.model
| SORT @timestamp
| LIMIT 500
```

### Example: Latency and error rate by model

```esql
FROM traces*
| WHERE @timestamp >= "2025-03-01T00:00:00Z" AND @timestamp <= "2025-03-01T23:59:59Z"
  AND span.attributes.gen_ai.request.model IS NOT NULL
| STATS
    request_count = COUNT(*),
    failures = COUNT(*) WHERE event.outcome == "failure",
    avg_duration_us = AVG(span.duration.us)
  BY span.attributes.gen_ai.request.model
| EVAL error_rate = failures / request_count
| LIMIT 100
```

### Example: Agentic workflow (trace-level view)

Get trace IDs that contain at least one LLM span and count spans per trace to see chain length:

```esql
FROM traces*
| WHERE @timestamp >= "2025-03-01T00:00:00Z" AND @timestamp <= "2025-03-01T23:59:59Z"
  AND span.attributes.gen_ai.operation.name IS NOT NULL
| STATS span_count = COUNT(*), total_duration_us = SUM(span.duration.us) BY trace.id
| WHERE span_count > 1
| SORT total_duration_us DESC
| LIMIT 50
```

### Example: Integration metrics (Amazon Bedrock AgentCore)

The [Amazon Bedrock AgentCore integration](https://www.elastic.co/docs/reference/integrations/aws_bedrock_agentcore)
ships metrics to the `metrics-aws_bedrock_agentcore.metrics-*` data stream (time series index). Use **`TS`** for
aggregations on time series data streams (Elasticsearch 9.2+); use a time range with **`TRANGE`** (9.3+). The
integration’s dashboards and
[alerting rule templates](https://github.com/elastic/integrations/tree/main/packages/aws_bedrock_agentcore/kibana/alerting_rule_template)
Example: token usage (counter), invocations (counter), and average latency (gauge) by hour and agent:

```esql
TS metrics-aws_bedrock_agentcore.metrics-*
| WHERE TRANGE(7 days)
  AND aws.dimensions.Operation == "InvokeAgentRuntime"
| STATS
    total_tokens = SUM(RATE(aws.bedrock_agentcore.metrics.TokenCount.sum)),
    total_invocations = SUM(RATE(aws.bedrock_agentcore.metrics.Invocations.sum)),
    avg_latency_ms = AVG(AVG_OVER_TIME(aws.bedrock_agentcore.metrics.Latency.avg))
  BY TBUCKET(1 hour), aws.bedrock_agentcore.agent_name
| SORT TBUCKET(1 hour) DESC
```

For Elasticsearch 8.x or when `TS` is not available, use `FROM` with `BUCKET(@timestamp, 1 hour)` and `SUM`/`AVG` over
the metric fields (as in the integration's alert rule templates). For other LLM integrations (OpenAI, Azure OpenAI,
Vertex AI, etc.), use that integration’s data stream index pattern and field names from its package (see
[Elastic LLM observability](https://www.elastic.co/docs/solutions/observability/applications/llm-observability)).

## Guidelines

- **Data only in Elastic:** Use only data collected and stored in Elastic (traces in `traces*`, metrics, or integration
  metrics/logs). Do not describe or rely on other vendors’ UIs or products.
- **One technology per customer:** Assume a single ingestion path per deployment when answering; discover which (traces
  vs integration) exists and use it consistently for the question.
- **Discover field names:** Before writing ES|QL or Query DSL, confirm LLM-related attribute or metric names from
  `_mapping` or a sample document; naming may differ (e.g. `gen_ai.*` vs `llm.*` or integration-specific fields).
- **No Kibana UI dependency:** Prefer ES|QL and Elasticsearch APIs; use Kibana APIs only when needed (e.g. SLO,
  alerting). Do not instruct the user to open Kibana UI.
- **References:**
  [LLM and agentic AI observability](https://www.elastic.co/docs/solutions/observability/applications/llm-observability),
  [Observability Labs – LLM Observability](https://www.elastic.co/observability-labs/blog/tag/llmobs),
  [OpenTelemetry GenAI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/). For ES|QL syntax and
  query patterns, use the **elasticsearch-esql** skill, or look through
  [ES|QL TS command reference](https://www.elastic.co/docs/reference/query-languages/esql/commands/ts) for Elastic v9.3
  or higher and for Serverless, and look through
  [ES|QL FROM command reference](https://www.elastic.co/docs/reference/query-languages/esql/commands/from) for other
  Elastic versions.
