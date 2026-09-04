# GenAI attributes and how to resolve their real field paths

Spans emitted by OTel/EDOT and compatible SDKs (OpenLLMetry, OpenLIT, Langtrace) carry span attributes that can follow
the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) or
provider-specific names. Treat everything in this file as a catalog of names to **look for**, not names to assume.

## Attribute catalog (OTel GenAI semconv)

| Purpose               | Attribute names                                                                     |
| --------------------- | ----------------------------------------------------------------------------------- |
| Operation             | `gen_ai.operation.name` (for example `chat`, `embeddings`, `execute_tool`)          |
| Provider              | `gen_ai.provider.name` (current spec) or `gen_ai.system` (older instrumentation)    |
| Model                 | `gen_ai.request.model`, `gen_ai.response.model`                                     |
| Token usage           | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`                           |
| Request config        | `gen_ai.request.temperature`, `gen_ai.request.max_tokens`, `gen_ai.request.top_p`   |
| Response identity     | `gen_ai.response.id`                                                                |
| Quality / termination | `gen_ai.response.finish_reasons` (for example `stop`, `tool_calls`, content filter) |
| Errors                | `error.type`                                                                        |
| Conversation / agent  | `gen_ai.conversation.id`; tool and agent spans appear as child spans                |
| Message content       | `gen_ai.input.messages`, `gen_ai.output.messages` — often disabled or redacted      |
| Cost                  | **Not in the spec.** Custom only, for example `llm.response.cost.usd_estimate`      |

The provider attribute is the most common naming trap: the convention was renamed, so older instrumentation emits
`gen_ai.system` while newer emits `gen_ai.provider.name`. A query filtering on the wrong one silently returns zero rows.
Resolve it before filtering on it.

## Attribute nesting differs by ingestion path

This is the difference that most often makes an otherwise-correct query fail to parse.

| Ingestion path                               | How to reference a span attribute in ES\|QL                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| OTel-native data streams (`traces-*.otel-*`) | `attributes.gen_ai.request.model`, or the bare passthrough `gen_ai.request.model` |
| Elastic APM agent data (`traces-apm*`)       | Can use a `span.attributes.`-style path or ECS-mapped fields                      |

On OTel-native trace data streams, `span.attributes.<name>` does **not** resolve — the attribute lives under
`attributes.<name>`, and the OTel mappings also expose it as a bare top-level passthrough (`gen_ai.request.model`). Span
duration is the exception: `span.duration.us` does resolve on OTel-native traces.

Resolve the correct form empirically rather than reasoning about it:

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 1 hour
| KEEP trace.id, span.id, parent.id, span.name, service.name, span.duration.us, event.outcome
| LIMIT 5
```

Then widen with `GET /_field_caps` against `traces-*` using a fields pattern of `*gen_ai*,*llm*,*token*,*cost*`. Field
caps is better than `_mapping` for this because it reports the resolved type per backing index, which surfaces the
conflict described next.

## The integer/long conflict on token fields

Token attributes are usually dynamically mapped. When a data stream rolls over and the mapping is re-derived, the same
attribute is often `integer` in older backing indices and `long` in newer ones. ES|QL then refuses the field outright:

```text
Cannot use field [attributes.gen_ai.usage.input_tokens] due to ambiguities being mapped as
[2] incompatible types: [integer] in [...], [long] in [...]
```

This is not a bad query — the field genuinely has two types across the pattern. Cast it in an `EVAL` before aggregating:

```esql
FROM traces-*
| WHERE @timestamp > NOW() - 24 hours AND attributes.gen_ai.request.model IS NOT NULL
| EVAL in_tok = TO_LONG(attributes.gen_ai.usage.input_tokens),
       out_tok = TO_LONG(attributes.gen_ai.usage.output_tokens)
| STATS input_tokens = SUM(in_tok), output_tokens = SUM(out_tok) BY attributes.gen_ai.request.model
```

Narrowing the index pattern to a single backing index also works but silently drops data, so prefer the cast.

## Latency, outcome, and hierarchy fields

These are ordinary trace fields, not GenAI attributes, and they are what makes the trace path able to answer questions
the metrics path cannot.

| Field                   | Use                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `duration`              | Per-span latency in **nanoseconds**; populated on every OTel-native span            |
| `span.duration.us`      | Per-span latency in **microseconds**; APM-compatibility field, not always populated |
| `event.outcome`         | `"failure"` marks a failed span — the basis for error rate                          |
| `trace.id`              | Groups all spans of one request; the unit of a call chain                           |
| `span.id` / `parent.id` | Parent/child edges — the only way to reconstruct chain shape                        |
| `span.name`             | Step identity, for example `chat astronomy-llm`                                     |
| `service.name`          | Populated on traces, metrics, and logs                                              |

**The two duration fields are not interchangeable.** On OTel-native trace data streams, `duration` is present on all
spans, while `span.duration.us` is populated only on transaction-like spans and is `null` on the rest. Aggregating or
sorting on `span.duration.us` across a whole trace therefore silently drops spans, which will hide the real bottleneck
in a call-chain walk. Confirm which is populated on the spans you care about, and prefer `duration` when walking a full
hierarchy. Watch the units: `duration` is nanoseconds, `span.duration.us` is microseconds.

Note that `service.name` is the service that **emitted** the span, which is the calling application — not the model. The
model is in `gen_ai.request.model` / `gen_ai.response.model`. Reporting the emitting service as "the model" is a common
misread.
