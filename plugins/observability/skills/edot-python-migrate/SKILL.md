---
name: observability-edot-python-migrate
description: >
  Migrate a Python application from the classic Elastic APM Python agent to the EDOT
  Python agent. Use when switching from elastic-apm to elastic-opentelemetry.
metadata:
  author: elastic
  version: 0.1.0
---

# EDOT Python Migration

Read the migration guide before making changes:

- [Migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/migration)
- [EDOT Python setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/setup)
- [EDOT Python configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/configuration)

## Guidelines

1. Remove ALL classic APM references: `elastic-apm` from requirements, `ElasticAPM(app)` / `elasticapm.contrib.*` from
   application code, `app.config['ELASTIC_APM']` blocks, and all `ELASTIC_APM_*` env vars
1. Install `elastic-opentelemetry` via pip (add to `requirements.txt` or equivalent)
1. Run `edot-bootstrap --action=install` during image build to install auto-instrumentation packages for detected
   libraries
1. Wrap the application entrypoint with `opentelemetry-instrument` — e.g. `opentelemetry-instrument gunicorn app:app`.
   Without this, no telemetry is collected
1. Set exactly three required environment variables:
   - `OTEL_SERVICE_NAME` (replaces `ELASTIC_APM_SERVICE_NAME`)
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — must be the **managed OTLP endpoint** or **EDOT Collector** URL. Do NOT reuse the
     old `ELASTIC_APM_SERVER_URL` value. Never use an APM Server URL (no `apm-server`, no `:8200`, no
     `/intake/v2/events`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — `"Authorization=ApiKey <key>"` or `"Authorization=Bearer <token>"` (replaces
     `ELASTIC_APM_SECRET_TOKEN`)
1. Do NOT set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` — the defaults are already
   correct
1. Never run both classic `elastic-apm` and EDOT on the same application

## Examples

See the [EDOT Python migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/migration)
for complete examples.
