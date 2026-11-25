# Official documentation

Curated links, carried forward from the previous `observability-manage-slos` skill and extended with the alerting and
synthetics material this skill now covers. Prefer these over general search when a schema or behavior needs
confirmation.

## SLO concepts and workflow

- [Service-level objectives (SLOs)](https://www.elastic.co/docs/solutions/observability/incident-management/service-level-objectives-slos)
  — concepts, SLI types, budgeting methods, and dashboard panels.
- [Create an SLO](https://www.elastic.co/docs/solutions/observability/incident-management/create-an-slo) — step-by-step
  guide for creating SLOs in the Kibana UI.
- [View and manage SLOs](https://www.elastic.co/docs/solutions/observability/incident-management/slo-management) —
  searching, filtering, and managing existing SLOs.

## Kibana SLO API

- [Create an SLO](https://www.elastic.co/docs/api/doc/kibana/operation/operation-createsloop) — full request body schema
  with all SLI type payloads. This is the authority for anything in [slo-api-schemas.md](slo-api-schemas.md).
- [Get an SLO](https://www.elastic.co/docs/api/doc/kibana/operation/operation-getsloop) |
  [Update](https://www.elastic.co/docs/api/doc/kibana/operation/operation-updatesloop) |
  [Delete](https://www.elastic.co/docs/api/doc/kibana/operation/operation-deletesloop) |
  [Reset](https://www.elastic.co/docs/api/doc/kibana/operation/operation-resetsloop)
- [Enable](https://www.elastic.co/docs/api/doc/kibana/operation/operation-enablesloop) |
  [Disable](https://www.elastic.co/docs/api/doc/kibana/operation/operation-disablesloop) |
  [Get definitions](https://www.elastic.co/docs/api/doc/kibana/operation/operation-getdefinitionsop)

## Burn-rate alerting

- [Create an SLO burn rate rule](https://www.elastic.co/docs/solutions/observability/incident-management/create-an-slo-burn-rate-rule)
  — window semantics and the defaults reproduced in [burn-rate-rules.md](burn-rate-rules.md).
- [Kibana Alerting API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting) — rule create, update,
  lifecycle, and snooze endpoints.
- [Alerting concepts](https://www.elastic.co/docs/explore-analyze/alerting/alerts) — rules, alerts, actions, and
  connectors.
- [Maintenance windows](https://www.elastic.co/docs/explore-analyze/alerting/alerts/maintenance-windows) — suppressing
  notifications across many rules during planned change.

## Synthetics

- [Synthetic monitoring](https://www.elastic.co/docs/solutions/observability/synthetics) — monitor types, locations, and
  scheduling.
- [Synthetics API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-synthetics) — monitor management endpoints.
  There is no `elastic` CLI binding for these as of CLI 0.2.0.

## Anomaly detection

- [Anomaly detection](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection) — for reliability
  concerns with no fixed threshold.

## Troubleshooting and access

- [Troubleshoot SLOs](https://www.elastic.co/docs/troubleshoot/observability/troubleshoot-service-level-objectives-slos)
  — stuck transforms, missing rollup data, and outdated definitions.
- [Configure SLO access](https://www.elastic.co/docs/solutions/observability/incident-management/configure-service-level-objective-slo-access)
  — the privileges required to read and manage SLOs.
