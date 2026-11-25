---
name: observability-llm-obs
description: >
  Answer questions about LLM and agentic-application behavior from data already ingested
  into Elastic: latency and error rate, token and cost utilization, response quality
  and guardrail events, and agentic call-chain orchestration. Use when the user asks
  about LLM monitoring, GenAI observability, token spend or AI cost, model latency,
  prompt or guardrail failures, or how an agent's tool-call chain executed.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with `es` and `kb` support, and an Elasticsearch
  deployment holding LLM telemetry from APM/OTLP traces or an Elastic LLM integration.
  Base floor is Elasticsearch 8.11+ or Serverless. The time-series path for integration
  metrics needs `TS` (Stack GA 9.4) and `TRANGE` (Stack GA 9.3); both are GA on Serverless.
  Below Stack 9.4 fall back to `FROM` with `BUCKET`. SLO and alerting lookups require
  Kibana. No Kibana UI is required.
metadata:
  author: elastic
  version: 0.3.1
  universal: true
---

# LLM and Agentic Observability

Answer questions about monitoring LLMs and agentic components using **data actually ingested into Elastic** — nothing
else. The four questions this skill answers are LLM performance, cost and token utilization, response quality, and call
chaining or agentic workflow orchestration.

A given deployment typically uses **one or more** ingestion paths: APM/OTLP traces, and/or integration metrics and logs.
Which one exists is a discovery result, not an assumption — never assume both are present. For ES|QL syntax, commands,
and query patterns, use the **elasticsearch-esql** skill. For service-level latency and error triage that is not
LLM-specific, use the **observability-sre-triage** skill.

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

### Analysis without cluster access

The CLI check above gates _querying the cluster_ — it does not gate analysis. When the user has already supplied the
evidence in their question (metric values, counts, status reasons, log lines, alert payloads, configuration), reason
from that evidence and deliver the conclusion.

When you genuinely do need data the user has not provided, still say what you would check and how — name the specific
query, index, and field that would settle the question — and then ask for CLI setup. An answer that names the check is
useful without a cluster; one that only asks for setup is not.

## Jobs to be done

- Discover which LLM ingestion path a deployment actually uses before querying anything
- Discover the real LLM field names in this deployment, because GenAI attribute naming is not consistent
- Report LLM latency, throughput, and error rate by model, service, or time
- Report token utilization, and report cost only when a cost field genuinely exists
- Investigate response quality: failures, timeouts, finish reasons, content filters, and guardrail events
- Reconstruct agentic call chains and find the bottleneck span in a multi-step workflow
- Correlate findings with SLOs and alerting rules defined on LLM-related data

## Output discipline

Applies to every response produced under this skill.

- **Commit to the best-supported conclusion.** When the evidence points one way, say so. Do not downgrade confidence to
  sound cautious — hedging on unambiguous evidence is a defect, not humility.
- **State confidence once**, in the conclusion. Do not restate it per bullet.
- **Do not speculate past the evidence.** If a cause was not observed, it does not go in the answer. Say what is unknown
  and stop.
- **Report absence as absence.** Zero rows means the data is missing or not collected; it never means the underlying
  condition is healthy. In particular, **if no cost field exists, say cost is not instrumented** — do not multiply token
  counts by a guessed per-token price and present the product as a cost figure.
- **Report the numbers actually found.** Quote the token counts, latencies, and error rates the query returned. Do not
  round them into vague characterizations, and do not carry forward a number from an example in this skill.
- **Do not pad.** No restating the question, no narrating which queries were run unless the result mattered, no
  summarizing the summary.
- **End on the finding.** No trailing offers such as "want me to dig deeper?". Actionable follow-ups belong in a
  recommendations list, phrased as recommendations, not as questions.

## Where the data lives

| Ingestion path                  | Index patterns                                                            | What it can answer                                                       |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| OTel / EDOT traces via OTLP     | `traces-*.otel-*`, or the generic `traces-*`                              | Per-request latency, tokens, models, finish reasons, **and call chains** |
| Elastic APM agent traces        | `traces-apm*`, or the generic `traces-*`                                  | Per-request latency and outcome; GenAI attributes if the SDK adds them   |
| APM/OTel metrics                | `metrics-apm*`, `metrics-*.otel-*`                                        | Aggregated service-level rates and latencies                             |
| Elastic LLM integration metrics | `metrics-<integration>.*` (for example `metrics-aws_bedrock_agentcore.*`) | Aggregate token counts, invocations, latency, sometimes cost             |
| Elastic LLM integration logs    | `logs-<integration>.*`                                                    | Prompt/response records, guardrail and content-filter events             |

Use the generic `traces-*` pattern to find trace data regardless of whether an Elastic APM agent or OpenTelemetry
collected it. Instrumentation can come from EDOT, OpenLLMetry, OpenLIT, or Langtrace exporting to OTLP — all of them
land LLM and agent spans in the trace data streams.

**Only traces can reconstruct a call chain.** `trace.id`, `span.id`, and `parent.id` are the only way to rebuild an
agentic call chain. Integration metrics are pre-aggregated and cannot do it — if the question is about orchestration and
only integration metrics exist, say the chain cannot be reconstructed from the available data.

Background reading:
[LLM and agentic AI observability](https://www.elastic.co/docs/solutions/observability/applications/llm-observability),
[EDOT LLM use cases](https://www.elastic.co/docs/solutions/observability/get-started/opentelemetry/use-cases/llms),
[Observability Labs — LLM Observability](https://www.elastic.co/observability-labs/blog/tag/llmobs).

## Process: determine what data is available

Run these in order. Do not skip to step 5.

1. **Verify the connection and detect the version.** Call `GET /`. The decision this drives is which query language
   surface is available: `build_flavor: "serverless"` means all ES|QL features including `TS`, `TRANGE`, and `TBUCKET`
   are available. Otherwise use `version.number`: on Stack, `TS` is preview in 9.2 and GA in 9.4, and `TRANGE` is GA in
   9.3.0, so treat **Stack 9.4** as the floor for the whole time-series path and fall back to `FROM` with
   `BUCKET(@timestamp, ...)` below it. Getting this wrong produces a query that fails to parse.

2. **Determine which ingestion paths exist.** The decision is whether this deployment has traces, integration data, or
   both — and it changes which questions are answerable at all. List data streams with `GET /_data_stream/<name>` (pass
   `traces-*`, `metrics-*`, `logs-*`) or resolve patterns with `GET /_resolve/index/<pattern>`. Look for trace data
   streams, `metrics-apm*`, and any `metrics-*` or `logs-*` matching a known LLM integration dataset. If neither path
   has LLM data, say so and stop — do not answer from general knowledge about the model provider.

3. **Discover the real LLM field names.** The decision is which exact field paths to write into ES|QL, and it cannot be
   guessed. Naming differs across instrumentations: `gen_ai.*` versus `llm.*` versus integration-specific names, and the
   semantic conventions themselves have shifted (older instrumentation emits `gen_ai.system`, newer emits
   `gen_ai.provider.name`). Use `GET /_field_caps` with a field pattern such as `*gen_ai*`, `*llm*`, `*token*`,
   `*cost*`, or read `GET /<index>/_mapping`, then sample a document to confirm the values are populated. **Attribute
   nesting differs by ingestion path** — OTel-native trace data streams expose span attributes as `attributes.<name>`
   (and often as a bare passthrough `<name>`), not as `span.attributes.<name>`. Confirm which form resolves before
   writing a query. See [references/genai-fields.md](references/genai-fields.md) for the attribute catalog and the
   resolution rules.

4. **Decide whether a cost field exists.** Cost is **not** part of the OpenTelemetry GenAI specification. Some
   instrumentations add a custom attribute such as `llm.response.cost.usd_estimate`, and some integrations expose a cost
   metric, but many deployments have neither. Look for it explicitly in step 3. If it is absent, the answer to a cost
   question is that cost is not instrumented — report token counts instead and name the gap.

5. **Choose ONE consistent source per question.** When both APM traces and integration metrics exist, pick one and use
   it for the whole answer. Mixing them double-counts and produces two different numbers for the same quantity, because
   the integration polls the provider's own accounting while the traces record what the client observed. Route by
   question type: **traces** for per-request analysis, call chains, and anything needing a trace hierarchy;
   **integration metrics** for aggregate token and cost totals over long windows. State which source the answer came
   from.

6. **Check alerts and SLOs when relevance is plausible.** The decision is whether a degradation is already known and
   tracked. Find rules with `GET kbn:/api/alerting/rules/_find` and SLOs with `GET kbn:/api/observability/slos`, then
   filter to those targeting LLM-related services or integration metrics — the field names from step 3 tell you which
   rules are related. Firing alerts, or SLOs in violated or degrading status, are evidence of degraded performance. Note
   that the SLO API's `sli.kql.custom` indicator takes KQL rather than ES|QL; that is an API contract, not a
   recommendation to use KQL elsewhere.

## Use cases and query patterns

Write queries with `POST /_query`. Always bound the time range, add `service.name` when present, and `LIMIT` results.
Use coarse buckets when only a trend is needed rather than scanning a wide window at fine granularity.

| Question                        | Traces path                                                                                                                                     | Integration path                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Latency, throughput, error rate | Filter on the GenAI operation or model attribute; `COUNT(*)` per bucket, `AVG(span.duration.us)`, and failures via `event.outcome == "failure"` | Request-rate, latency, and error metrics by model dimension    |
| Tokens and cost                 | `SUM` the input and output token attributes by time, model, or service; add a cost attribute only if one exists                                 | Token and cost metrics aggregated by time and model            |
| Response quality and safety     | `event.outcome`, `error.type`, and the finish-reason attribute; prompts and responses only if captured and not redacted                         | Guardrail blocks, content-filter events, and policy violations |
| Call chaining and orchestration | **Traces only** — group by `trace.id`, walk `parent.id` to `span.id`, aggregate by span name or GenAI operation                                 | Not answerable — metrics are pre-aggregated                    |

On the trace path, per-span latency comes from `duration` (nanoseconds, populated on every OTel-native span) or
`span.duration.us` (microseconds, an APM-compatibility field that is `null` on many spans — sorting on it can silently
drop the slowest step). Confirm which is populated before using it. The slowest child span is the bottleneck.
Aggregating by span name or the GenAI operation attribute shows the distribution of step types across a workflow —
retrieval, LLM call, tool use.

For integration-specific data streams and field names — OpenAI, Azure OpenAI, Azure AI Foundry, Amazon Bedrock, Bedrock
AgentCore, GCP Vertex AI — see [references/integrations.md](references/integrations.md). For longer worked queries
including the trace-hierarchy walk and the time-series integration pattern, see
[references/esql-recipes.md](references/esql-recipes.md).

## Examples

The field paths below are **illustrative**. Confirm the real paths from step 3 before running anything — this skill's
own method is to discover field names first, and the correct nesting depends on the ingestion path.

**"How many tokens are we burning per model?"** — confirm the token attributes exist and resolve, then sum them by model
and time bucket. Report the totals returned:

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 24 hours AND attributes.gen_ai.request.model IS NOT NULL
| EVAL in_tok = TO_LONG(attributes.gen_ai.usage.input_tokens),
       out_tok = TO_LONG(attributes.gen_ai.usage.output_tokens)
| STATS input_tokens = SUM(in_tok), output_tokens = SUM(out_tok)
    BY hour = BUCKET(@timestamp, 1 hour), attributes.gen_ai.request.model
| SORT hour
| LIMIT 500
```

**"What is our LLM spend?"** — look for a cost field with `GET /_field_caps` on `*cost*` before querying. If none
exists, report token utilization and state plainly that cost is not instrumented in this deployment; adding a cost
attribute at the instrumentation layer, or enabling an integration that reports cost, is the fix. Do not multiply tokens
by a price you assumed.

**"Which model is slowest, and is it failing?"** — latency and error rate in one pass, grouped by model:

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 24 hours AND attributes.gen_ai.request.model IS NOT NULL
| STATS request_count = COUNT(*),
        failures = COUNT(*) WHERE event.outcome == "failure",
        avg_duration_us = AVG(span.duration.us)
    BY attributes.gen_ai.request.model
| EVAL error_rate = failures::double / request_count
| SORT avg_duration_us DESC
| LIMIT 100
```

**"Why is our agent slow?"** — this needs the trace hierarchy, so it requires trace data. Find the traces containing
more than one LLM or tool span, ranked by time spent in those spans, then walk into the worst trace by `trace.id` to
find the bottleneck span. Because the `WHERE` restricts to LLM spans, the sum below is LLM time, not end-to-end trace
duration — name the column so it cannot be misread as wall-clock latency:

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 3 hours AND attributes.gen_ai.operation.name IS NOT NULL
| STATS llm_span_count = COUNT(*), llm_duration_us = SUM(span.duration.us) BY trace.id
| WHERE llm_span_count > 1
| SORT llm_duration_us DESC
| LIMIT 50
```

**"Are prompts getting blocked?"** — check the finish-reason attribute and `error.type` on the trace path, or the
integration's guardrail log events. A finish reason such as a content filter is a quality signal, not a transport error.

**"Is there anything already alerting on this?"** — `GET kbn:/api/alerting/rules/_find` and
`GET kbn:/api/observability/slos`, filtered to the LLM-related services or integration metrics identified in step 2.

## Guidelines

- **Answer only from data ingested into Elastic.** Do not describe or rely on other vendors' UIs, consoles, or products.
  If the data is not in Elastic, the answer is that it is not in Elastic.
- **Discover before querying.** Confirm the ingestion path (step 2) and the field names (step 3) from
  `GET /_field_caps`, `GET /<index>/_mapping`, or a sample document. Never guess an attribute path.
- **One consistent source per question.** Do not blend APM traces and integration metrics in a single answer.
- **Cost is not in the GenAI spec.** Treat a cost figure as available only when a cost field is present in the data.
- **Only traces reconstruct chains.** If the question is about agentic orchestration and only integration metrics exist,
  say the chain is not reconstructable rather than approximating it from aggregates.
- **Gate time-series syntax on the version.** Use `TS` with `TRANGE` and `TBUCKET` on Serverless or Stack 9.4+; fall
  back to `FROM` with `BUCKET(@timestamp, ...)` below that. Alias the bucket (`BY bucket = TBUCKET(1 hour)`) and sort on
  the alias.
- **Expect type conflicts on dynamically mapped attributes.** Token attributes are frequently mapped as `integer` in one
  backing index and `long` in another after a rollover, which makes ES|QL refuse the field. Cast with `TO_LONG(...)` in
  an `EVAL` before aggregating.
- **No Kibana UI dependency.** Prefer ES|QL and Elasticsearch APIs; use Kibana APIs only for SLOs and alerting. Never
  instruct the user to open the Kibana UI.
- For ES|QL syntax and query patterns use the **elasticsearch-esql** skill; the
  [`TS` command reference](https://www.elastic.co/docs/reference/query-languages/esql/commands/ts) applies on Stack 9.4+
  and Serverless, and the
  [`FROM` command reference](https://www.elastic.co/docs/reference/query-languages/esql/commands/from) applies
  elsewhere.

## Operations

| HTTP API (shorthand)                | `elastic` CLI command                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `GET /`                             | `elastic es info`                                                      |
| `GET /_data_stream/<name>`          | `elastic es indices get-data-stream --name '<name>'`                   |
| `GET /_resolve/index/<pattern>`     | `elastic es indices resolve-index --name '<pattern>'`                  |
| `GET /<index>/_mapping`             | `elastic es indices get-mapping --index '<index>'`                     |
| `GET /_field_caps`                  | `elastic es field-caps --index '<index>' --fields '<fields>'`          |
| `POST /_query`                      | `elastic es esql query --format tsv --query '<esql>'`                  |
| `GET kbn:/api/alerting/rules/_find` | `elastic kb alerting get-alerting-rules-find --filter '<filter>'`      |
| `GET kbn:/api/observability/slos`   | `elastic kb slo find-slos-op --space-id '<space>' --kql-query '<kql>'` |
