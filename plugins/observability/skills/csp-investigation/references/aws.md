# AWS reference (OTel schema via EDOT awscloudwatch)

Provider-specific facts for AWS investigations. The investigation doctrine lives in the parent SKILL.md — this file is
the schema and the failure-mode signatures. Every query here is ES|QL and runs via `POST /_query`; confirm which data
streams a deployment actually has with `GET /_resolve/index/metrics-aws.*.otel-*` before assuming a service is covered.

**In scope:** `metrics-aws.*.otel-*` data streams (OTel semconv AWS CloudWatch shape). **Out of scope:** the legacy
Elastic AWS integration shape (`metrics-aws.*` without `.otel`, `aws.*` ECS fields) — do not author queries against it.

## Schema (unguessable — use exactly this)

**Logs** (when shipped): the classic AWS-integration shape is `logs-aws_logs.*` (per-service datasets, e.g.
`logs-aws_logs.lambda_fis-*`; the log line is the `message` field, ECS-shaped). The OTel shape is `logs-*.otel-*`
(filter by `service.name`; line in `body.text`). A given environment may have one, both, or neither.

Data streams, one per service: `metrics-aws.rds.otel-*`, `metrics-aws.lambda.otel-*`, `metrics-aws.sqs.otel-*`,
`metrics-aws.elb.otel-*`, `metrics-aws.ec2.otel-*`.

**Metric value fields are the CloudWatch names flattened under `metrics.`** with dots and slashes — they MUST be
backticked in ES|QL: `` `metrics.amazonaws.com/AWS/RDS/DatabaseConnections` ``,
`` `metrics.amazonaws.com/AWS/Lambda/Errors` ``,
`` `metrics.amazonaws.com/AWS/SQS/ApproximateNumberOfMessagesVisible` ``,
`` `metrics.amazonaws.com/AWS/ApplicationELB/HTTPCode_Target_5XX_Count` ``.

**Filter rows by CloudWatch dimensions as `attributes.<Dimension>`:** `attributes.DBInstanceIdentifier`,
`attributes.FunctionName`, `attributes.QueueName`, `attributes.LoadBalancer` (full `app/<name>/<id>` form),
`attributes.TargetGroup`, `attributes.InstanceId`, plus `attributes.MetricName` and `attributes.Namespace`.

**Every metric arrives as up to three parallel stat streams** distinguished by `attributes.stat` (`Average` | `Sum` |
`Maximum`). Aggregating without a stat filter mixes the streams and corrupts the number (error counts come out
fractional). Use a per-aggregation filter and pick the stat that matches the semantic:

```esql
FROM metrics-aws.lambda.otel-*
| WHERE attributes.FunctionName == "<fn>" AND @timestamp >= <start> AND @timestamp <= <end>
| STATS errors      = SUM(`metrics.amazonaws.com/AWS/Lambda/Errors`)      WHERE attributes.stat == "Sum",
        invocations = SUM(`metrics.amazonaws.com/AWS/Lambda/Invocations`) WHERE attributes.stat == "Sum",
        p_duration  = MAX(`metrics.amazonaws.com/AWS/Lambda/Duration`)    WHERE attributes.stat == "Maximum"
| EVAL error_rate = CASE(invocations > 0, TO_DOUBLE(errors) / invocations, null)
```

Counters (Errors, RequestCount, 5xx counts, MessagesSent/Deleted) → `Sum`. Peaks (Duration, ConcurrentExecutions,
connection peaks, backlog peaks) → `Maximum`. Levels (FreeableMemory, CPUUtilization averages) → `Average`. Guard every
ratio with `CASE(denominator > 0, …, null)` — a null rate means zero volume, not 0%.

**Sparse counters are unmapped until their first non-zero event.** `Errors`, `Throttles`, per-code
`HTTPCode_*_5XX_Count` and similar only exist as fields once such an event has been recorded, and ES|QL fails the whole
query on an unknown column. Check with `GET /_field_caps` (or a separate small query) before adding them to a larger
statement.

**Ingest lag:** CloudWatch → Elastic is typically ~4 minutes (collector delay + scrape interval). A window ending at
"now" has an unpopulated tail.

## Failure-mode signatures

| Resource | Mode                        | Pivotal signature                                                                                                                                                                    |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RDS      | connection exhaustion       | DatabaseConnections climbs far above baseline and plateaus at a ceiling while CPU/memory/storage/IO stay nominal (RDS emits no max_connections — infer the ceiling from the plateau) |
| RDS      | cpu / memory / io / storage | the corresponding resource metric is the outlier; connections near baseline                                                                                                          |
| Lambda   | throttling                  | Throttles > 0, invocations rejected; concurrency pinned                                                                                                                              |
| Lambda   | elevated error rate         | error rate materially above ITS OWN baseline rate at comparable volume → the function's code/dependency; check sibling functions to confirm scope                                    |
| Lambda   | load surge                  | invocations ≫ baseline with rate ≈ baseline — absolute errors rise, nothing is broken                                                                                                |
| Lambda   | duration degradation        | rate ≈ baseline, Duration materially up (≥1.5×)                                                                                                                                      |
| SQS      | consumer lag                | backlog + oldest-age climb; deleted > 0 but < sent                                                                                                                                   |
| SQS      | consumer stalled            | backlog climbs; deleted ≈ 0                                                                                                                                                          |
| SQS      | producer spike              | sent ≫ baseline and exceeds deleted                                                                                                                                                  |
| ALB      | target vs ELB 5xx           | Target_5XX = the backend answered errors; ELB per-code: 502 can't keep target connections, 503 no healthy target/capacity, 504 target timeout, 500 ALB internal                      |
| ALB      | no healthy targets          | ELB 503 storm while host-count metrics go ABSENT (deregistered targets emit no HealthyHostCount datapoints at all — scale-to-zero removes the metric rather than reading 0)          |

**Lambda co-symptom trap (co-locate this with the guideline):** a worker/queue-consumer function does not call the
application database. If a Lambda's error rate jumps while a database or other resource is _also_ alerting in the same
window, that other incident is a co-symptom of shared load or coincidence — NOT the cause — unless the function
demonstrably calls it. Name the failure in the function's own code path; do not attribute it to the concurrent resource
without a proven dependency.

Ambient error rates are normal (many real workloads idle at several percent). Materiality bar: roughly ≥2× the
resource's own baseline rate, or a shift of many percentage points — not a drift of one or two.
