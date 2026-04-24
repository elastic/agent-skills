---
name: observability-edot-java-migrate
description: >
  Migrate a Java application from the classic Elastic APM Java agent to the EDOT Java
  agent. Use when switching from elastic-apm-agent.jar to elastic-otel-javaagent.jar.
metadata:
  author: elastic
  version: 0.1.1
---

# EDOT Java Migration

Read the migration guide before making changes:

- [Migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/migration)
- [EDOT Java setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/setup)
- [EDOT Java configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/configuration)

## Guidelines

1. Remove ALL classic APM references: `elastic-apm-agent.jar`, `elasticapm.properties`, all `ELASTIC_APM_*` env vars,
   and any `co.elastic.apm` Maven/Gradle dependencies
1. Use `elastic-otel-javaagent.jar` (download from
   [Maven Central](https://mvnrepository.com/artifact/co.elastic.otel/elastic-otel-javaagent/latest), not a Maven/Gradle
   compile dependency)
1. Attach via `-javaagent:/path/to/elastic-otel-javaagent.jar` or
   `JAVA_TOOL_OPTIONS="-javaagent:/path/to/elastic-otel-javaagent.jar"` — without this the agent does nothing
1. Set exactly three required environment variables:
   - `OTEL_SERVICE_NAME` (replaces `ELASTIC_APM_SERVICE_NAME`)
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — must be the **managed OTLP endpoint** or **EDOT Collector** URL. Do NOT reuse the
     old `ELASTIC_APM_SERVER_URL` value. Never use an APM Server URL (no `apm-server`, no `:8200`, no
     `/intake/v2/events`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — `"Authorization=ApiKey <key>"` or `"Authorization=Bearer <token>"` (replaces
     `ELASTIC_APM_SECRET_TOKEN` / `API_KEY`)
1. Do NOT set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` — the defaults are already
   correct
1. Never run both classic Elastic APM agent and EDOT agent on the same JVM

## Examples

See the [EDOT Java migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/migration) for
complete examples.
