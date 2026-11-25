# Worked ES|QL queries for LLM telemetry

Every field path below is illustrative. Resolve the real paths first — see [genai-fields.md](genai-fields.md). For
general ES|QL syntax use the **elasticsearch-esql** skill.

Run these with `POST /_query`.

## Scoping rules that apply to all of them

- Always bound the time range. Use `WHERE @timestamp > NOW() - <duration>` on `FROM`, or `WHERE TRANGE(<duration>)` on
  `TS` (Serverless, or Stack 9.4+ — see the time-series section below).
- Add `service.name`, and `service.environment` where it exists, once you know which service emits the LLM spans.
- Filter to LLM spans by a GenAI attribute that you have confirmed resolves — the operation or model attribute is the
  most reliable, since a provider attribute might be under either of two names.
- Use coarse buckets when only a trend is needed. Bucketing at one minute over seven days scans far more than the
  question requires.
- End with `LIMIT`.

**Read `Unknown column` carefully — it means two different things.** When the index pattern matches at least one
concrete index, `Unknown column [attributes.gen_ai.request.model]` means what it says: that field is not mapped, so this
deployment is not capturing that attribute. But when the pattern matches **no** index at all, ES|QL still reports an
unknown-column error naming the first field referenced rather than an index-not-found error. Executed against a Stack
9.4.4 cluster with no Bedrock integration installed, `FROM metrics-aws_bedrock_agentcore.metrics-*` returned
`Unknown column [@timestamp]` — which reads like a mapping problem on a data stream that does not exist. Before treating
an unknown-column error as evidence about a field, confirm the pattern resolves with `GET /_resolve/index/<pattern>`; if
it returns no indices, no data streams and no aliases, the integration is simply not installed.

## Token utilization over time, by model

The `TO_LONG` casts are not cosmetic; see the integer/long conflict in [genai-fields.md](genai-fields.md).

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 7 days AND attributes.gen_ai.request.model IS NOT NULL
| EVAL in_tok = TO_LONG(attributes.gen_ai.usage.input_tokens),
       out_tok = TO_LONG(attributes.gen_ai.usage.output_tokens)
| STATS input_tokens = SUM(in_tok),
        output_tokens = SUM(out_tok),
        requests = COUNT(*)
    BY hour = BUCKET(@timestamp, 1 hour), attributes.gen_ai.request.model
| SORT hour
| LIMIT 500
```

To add cost, and **only** if a cost attribute was found in discovery, add it to the same `STATS`:

```esql
| STATS cost_usd = SUM(attributes.llm.response.cost.usd_estimate) BY attributes.gen_ai.request.model
```

## Latency and error rate by model

`COUNT(*) WHERE <predicate>` is a per-aggregation filter, which computes the failure count and the total count in a
single pass. Cast the numerator before dividing, otherwise integer division truncates the rate to zero.

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 24 hours AND attributes.gen_ai.request.model IS NOT NULL
| STATS request_count = COUNT(*),
        failures = COUNT(*) WHERE event.outcome == "failure",
        avg_duration_us = AVG(span.duration.us),
        p95_duration_us = PERCENTILE(span.duration.us, 95)
    BY attributes.gen_ai.request.model
| EVAL error_rate = failures::double / request_count
| SORT p95_duration_us DESC
| LIMIT 100
```

## Response quality: finish reasons and error types

A finish reason distribution separates normal completions from truncation, tool-calling turns, and content filtering.
These are different problems with different fixes, so do not collapse them into one "error" number.

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 24 hours AND attributes.gen_ai.operation.name IS NOT NULL
| STATS n = COUNT(*)
    BY attributes.gen_ai.response.finish_reasons, attributes.gen_ai.request.model
| SORT n DESC
| LIMIT 50
```

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 24 hours AND error.type IS NOT NULL
| STATS n = COUNT(*) BY error.type, service.name
| SORT n DESC
| LIMIT 50
```

## Agentic call chains

Traces only. Three queries, run in order: find the expensive chains, inspect one, then characterize step types.

**1. Rank chains by LLM time and chain length.** Note what this measures: because the `WHERE` restricts to LLM spans,
the sum is time spent in LLM calls, **not** end-to-end trace duration. Name the column accordingly so the number is not
later misread as wall-clock latency.

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 3 hours AND attributes.gen_ai.operation.name IS NOT NULL
| STATS llm_span_count = COUNT(*), llm_duration_us = SUM(span.duration.us) BY trace.id
| WHERE llm_span_count > 1
| SORT llm_duration_us DESC
| LIMIT 50
```

**2. Walk the hierarchy of one trace to find the bottleneck.** Take a `trace.id` from the previous result. Keeping
`parent.id` alongside `span.id` is what lets you rebuild the tree — a flat list of spans sorted by duration tells you
which span is slow but not whether it is slow because of its own work or because it is waiting on a child.

Use `duration` (nanoseconds) rather than `span.duration.us` here: on OTel-native traces `span.duration.us` is `null` on
many spans, so sorting on it drops exactly the spans you are hunting for. See
[genai-fields.md](genai-fields.md#latency-outcome-and-hierarchy-fields).

```esql
FROM traces-*
| WHERE trace.id == "<trace-id-from-step-1>"
| KEEP @timestamp, span.id, parent.id, span.name, service.name, duration, event.outcome
| SORT duration DESC
| LIMIT 200
```

A root span has no `parent.id`. Total trace duration is the root's duration; the sum of child durations can exceed it
when steps run in parallel, so do not treat a duration sum as wall-clock time for concurrent chains.

**3. Characterize the step mix across many chains.** Shows whether the workflow is dominated by retrieval, model calls,
or tool use.

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 3 hours AND attributes.gen_ai.operation.name IS NOT NULL
| STATS n = COUNT(*), avg_us = AVG(span.duration.us)
    BY attributes.gen_ai.operation.name, span.name
| SORT n DESC
| LIMIT 50
```

## Integration metrics on a time-series data stream

Integration metrics data streams are usually time-series indices, which changes the query shape: use the `TS` source
command instead of `FROM`, `TRANGE` instead of a `@timestamp` comparison, `TBUCKET` instead of `BUCKET`, and wrap
counter fields in `RATE(...)`. Alias the bucket and sort on the alias rather than repeating the `TBUCKET(...)`
expression.

This whole shape needs **Serverless, or Stack 9.4+**. On Stack, `TS` is preview in 9.2 and GA in 9.4, and `TRANGE` is GA
in 9.3.0, so 9.4 is the first version where the pair is GA together. Below that, query the same data stream with `FROM`,
a `@timestamp` predicate and `BUCKET`; you lose the counter-rate handling that `RATE(...)` gives you, so read counter
fields as cumulative and difference them yourself rather than summing them.

Example against the
[Amazon Bedrock AgentCore integration](https://www.elastic.co/docs/reference/integrations/aws_bedrock_agentcore), whose
metrics land in `metrics-aws_bedrock_agentcore.metrics-*` — token count and invocations are counters, latency is a
gauge:

```esql
TS metrics-aws_bedrock_agentcore.metrics-*
| WHERE TRANGE(7 days) AND aws.dimensions.Operation == "InvokeAgentRuntime"
| STATS total_tokens = SUM(RATE(aws.bedrock_agentcore.metrics.TokenCount.sum)),
        total_invocations = SUM(RATE(aws.bedrock_agentcore.metrics.Invocations.sum)),
        avg_latency_ms = AVG(AVG_OVER_TIME(aws.bedrock_agentcore.metrics.Latency.avg))
    BY bucket = TBUCKET(1 hour), aws.bedrock_agentcore.agent_name
| SORT bucket DESC
| LIMIT 200
```

`COUNT(*)` is rejected under `TS` — count a specific field instead.

**Fallback for 8.x, or any cluster without `TS`:** use `FROM` with `BUCKET(@timestamp, ...)` and plain `SUM`/`AVG` over
the metric fields, which is the shape the integration's own alerting rule templates use.

```esql
FROM metrics-aws_bedrock_agentcore.metrics-*
| WHERE @timestamp > NOW() - 7 days AND aws.dimensions.Operation == "InvokeAgentRuntime"
| STATS total_tokens = SUM(aws.bedrock_agentcore.metrics.TokenCount.sum),
        total_invocations = SUM(aws.bedrock_agentcore.metrics.Invocations.sum),
        avg_latency_ms = AVG(aws.bedrock_agentcore.metrics.Latency.avg)
    BY bucket = BUCKET(@timestamp, 1 hour), aws.bedrock_agentcore.agent_name
| SORT bucket DESC
| LIMIT 200
```

For other integrations, substitute that package's data stream pattern and field names — see
[integrations.md](integrations.md).
