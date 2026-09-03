---
name: observability-edot-python-instrument
description: >
  Instrument a Python application with the Elastic Distribution of OpenTelemetry (EDOT)
  Python agent for automatic tracing, metrics, and logs. Use when adding observability
  to a Python service that has no existing APM agent.
metadata:
  author: elastic
  version: 0.1.0
---

# EDOT Python Instrumentation

Read the setup guide before making changes:

- [EDOT Python setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/setup)
- [EDOT Python configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/configuration)
- [OpenTelemetry Python auto-instrumentation](https://opentelemetry.io/docs/zero-code/python/)

## Guidelines

1. Install `elastic-opentelemetry` via pip (add to `requirements.txt` or equivalent)
1. Run `edot-bootstrap --action=install` during image build to install auto-instrumentation packages for detected
   libraries
1. Wrap the application entrypoint with `opentelemetry-instrument` — e.g. `opentelemetry-instrument gunicorn app:app` or
   `opentelemetry-instrument python app.py`. Without this, no telemetry is collected
1. Set exactly three required environment variables:
   - `OTEL_SERVICE_NAME`
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — must be the **managed OTLP endpoint** or **EDOT Collector** URL. Never use an APM
     Server URL (no `apm-server`, no `:8200`, no `/intake/v2/events`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — `"Authorization=ApiKey <key>"` or `"Authorization=Bearer <token>"`
1. Do NOT set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` — the defaults are already
   correct
1. Do NOT add code-level SDK setup (no `TracerProvider`, no `configure_azure_monitor`, etc.) —
   `opentelemetry-instrument` handles everything
1. Never run both classic `elastic-apm` and EDOT on the same application

## Examples

See the [EDOT Python setup guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/setup) for
complete examples.
