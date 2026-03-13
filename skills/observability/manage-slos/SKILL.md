---
name: observability-manage-slos
description: >
  Create and manage SLOs in Elastic Observability using the Kibana API. Use when defining
  SLIs, setting error budgets, or managing SLO lifecycle.
metadata:
  author: elastic
  version: 0.2.0
---

# Service-Level Objectives (SLOs)

Create and manage SLOs in Elastic Observability. SLOs track service performance against measurable targets using
service-level indicators (SLIs) computed from Elasticsearch data.

## Authentication

SLO operations go through the Kibana API. Authenticate with either an API key or basic auth:

```bash
# API key
curl -H "Authorization: ApiKey <base64-encoded-key>" -H "kbn-xsrf: true" <KIBANA_URL>/api/observability/slos

# Basic auth
curl -u "$KIBANA_USER:$KIBANA_PASSWORD" -H "kbn-xsrf: true" <KIBANA_URL>/api/observability/slos
```

For non-default spaces, prefix the path: `/s/<space_id>/api/observability/slos`.

Include `kbn-xsrf: true` on all POST, PUT, and DELETE requests.

## SLI Types

| Type                    | API value                      | Use case                                    |
| ----------------------- | ------------------------------ | ------------------------------------------- |
| Custom KQL              | `sli.kql.custom`               | Raw logs — good/total using KQL queries     |
| Custom metric           | `sli.metric.custom`            | Metric fields — equations with aggregations |
| Timeslice metric        | `sli.metric.timeslice`         | Metric fields — per-slice threshold check   |
| Histogram metric        | `sli.histogram.custom`         | Histogram fields — range/value_count        |
| APM latency             | `sli.apm.transactionDuration`  | APM — latency threshold                     |
| APM availability        | `sli.apm.transactionErrorRate` | APM — success rate                          |
| Synthetics availability | `sli.synthetics.availability`  | Synthetics monitors — uptime percentage     |

## Guidelines

- `objective.target` is a decimal between 0 and 1 (for example `0.995` for 99.5%).
- Timeslice metric indicators require `budgetingMethod: "timeslices"`.
- Updating an SLO resets the underlying transform — historical data is recomputed.
- The cluster needs nodes with both `transform` and `ingest` roles.
- Use `POST .../slos/{id}/_reset` when an SLO is stuck or after index mapping changes.
- Group-by SLOs create one instance per unique value — avoid high-cardinality fields.
- Synthetics SLOs are auto-grouped by monitor and location; do not set `groupBy` manually.
- Burn rate alert rules are not auto-created using the API — set them up separately.
