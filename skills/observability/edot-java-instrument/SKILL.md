---
name: observability-edot-java-instrument
description: >
  Instrument a Java application with the Elastic Distribution of OpenTelemetry (EDOT)
  Java agent for automatic tracing, metrics, and logs. Use when adding observability
  to a Java service that has no existing APM agent.
metadata:
  author: elastic
  version: 0.1.1
---

# EDOT Java Instrumentation

Read the setup guide before making changes:

- [EDOT Java setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/setup)
- [OpenTelemetry Java agent](https://opentelemetry.io/docs/zero-code/java/agent/)
- [EDOT Java configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/configuration)

## Guidelines

1. Use `elastic-otel-javaagent.jar` (download from
   [Maven Central](https://mvnrepository.com/artifact/co.elastic.otel/elastic-otel-javaagent/latest), not a Maven/Gradle
   compile dependency)
1. Attach via `-javaagent:/path/to/elastic-otel-javaagent.jar` or
   `JAVA_TOOL_OPTIONS="-javaagent:/path/to/elastic-otel-javaagent.jar"` — without this the agent does nothing
1. Set exactly three required environment variables:
   - `OTEL_SERVICE_NAME`
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — must be the **managed OTLP endpoint** or **EDOT Collector** URL. Never use an APM
     Server URL (no `apm-server`, no `:8200`, no `/intake/v2/events`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — `"Authorization=ApiKey <key>"` or `"Authorization=Bearer <token>"`
1. Do NOT set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` — the defaults are already
   correct
1. Never run both classic Elastic APM agent and EDOT agent on the same JVM

## Examples

See the [EDOT Java setup guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/setup) for complete
Dockerfile and docker-compose examples.
