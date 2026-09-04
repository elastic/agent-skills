# Elastic LLM integrations

When telemetry arrives through an
[Elastic LLM integration](https://www.elastic.co/docs/solutions/observability/applications/llm-observability) rather
than through OTLP traces, metrics and logs land in integration-owned data streams. Each integration package defines its
own data stream names and field names — discover them from the package reference or from the data stream mapping. Do not
transfer field names from one integration to another.

## What the integration path can and cannot answer

Integration metrics are polled from the provider's own accounting, so they are typically **more authoritative for
aggregate token and cost totals** than client-side trace attributes, and they capture usage from callers that are not
instrumented at all.

They cannot answer per-request or orchestration questions. There is no `trace.id`, no parent/child relationship, and no
individual request. If the question is about a call chain, a specific slow request, or which tool the agent invoked, the
integration path cannot answer it — say so rather than approximating from aggregates.

Integration **logs**, where the integration supports them, are the exception that carries per-event detail: prompt and
response records, guardrail decisions, content-filter events, and policy violations.

## Integration catalog

| Provider          | Typical data                                                      | Reference                                                                                         |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| OpenAI            | Token usage, request counts, latency, per-model dimensions        | [openai](https://www.elastic.co/docs/reference/integrations/openai)                               |
| Azure OpenAI      | Token usage, request/error counts, latency, content-filter events | [azure_openai](https://www.elastic.co/docs/reference/integrations/azure_openai)                   |
| Azure AI Foundry  | Model invocation metrics and logs                                 | [azure_ai_foundry](https://www.elastic.co/docs/reference/integrations/azure_ai_foundry)           |
| Amazon Bedrock    | Invocation counts, token counts, latency, guardrail events        | [aws_bedrock](https://www.elastic.co/docs/reference/integrations/aws_bedrock)                     |
| Bedrock AgentCore | Agent runtime invocations, token counts, latency, per-agent dims  | [aws_bedrock_agentcore](https://www.elastic.co/docs/reference/integrations/aws_bedrock_agentcore) |
| GCP Vertex AI     | Model invocation metrics, token counts, latency                   | [gcp_vertexai](https://www.elastic.co/docs/reference/integrations/gcp_vertexai)                   |

Bedrock guardrail analysis is written up in
[LLM observability with Amazon Bedrock Guardrails](https://www.elastic.co/observability-labs/blog/llm-observability-amazon-bedrock-guardrails).

## Cost on the integration path

Some integrations expose cost-related fields and some do not, and this varies by package version and by what the
provider's own API reports. Look for a cost field explicitly with `GET /_field_caps` using a `*cost*` fields pattern
against the integration's metrics data stream.

If no cost field is present, the deployment does not have cost data. Report token counts and name the gap. Do not derive
a cost figure by multiplying tokens against a price list — provider pricing is tiered, varies by region and commitment,
and differs between cached and uncached input tokens, so a derived figure is not a measurement.

## Discovering an integration's fields

Given a candidate data stream, the sequence is:

1. Confirm it exists and is receiving data with `GET /_data_stream/<name>`.
2. Enumerate metric and dimension fields with `GET /_field_caps` (fields pattern
   `*token*,*cost*,*latency*,*invocation*`) or read the full `GET /<index>/_mapping`.
3. Determine whether the data stream is a time-series index. Integration metrics data streams usually are, which means
   counter fields must be wrapped in `RATE(...)` and the `TS` source command applies. See
   [esql-recipes.md](esql-recipes.md) for the query shape.
4. Sample a document to confirm the dimensions you intend to group by are actually populated.

Integration packages also ship
[alerting rule templates](https://github.com/elastic/integrations/tree/main/packages/aws_bedrock_agentcore/kibana/alerting_rule_template)
and dashboards. The rule templates are a useful source of correct, package-maintained field names and query shapes —
read them rather than inventing an aggregation.
