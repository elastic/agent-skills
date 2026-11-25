# EDOT Java

Covers both paths: instrumenting a Java service that has no APM agent, and migrating one that still runs the classic
Elastic APM Java agent. The shared configuration rules (the three required environment variables, the exporter variables
you must not set, and the never-run-both rule) are in `SKILL.md` and are not repeated here.

Official documentation:

- [EDOT Java setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/setup)
- [EDOT Java configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/configuration)
- [EDOT Java migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/migration)
- [OpenTelemetry Java agent](https://opentelemetry.io/docs/zero-code/java/agent/)

Read the setup guide (or the migration guide, on the migrate path) before making changes.

## Detecting a classic agent

The service is on the classic Elastic APM Java agent if any of these are present:

- `elastic-apm-agent.jar` on the command line or in `JAVA_TOOL_OPTIONS`
- an `elasticapm.properties` file
- `ELASTIC_APM_*` environment variables
- a `co.elastic.apm` Maven or Gradle dependency

Any one of these means take the migrate path.

## Instrument

1. Obtain `elastic-otel-javaagent.jar` from
   [Maven Central](https://mvnrepository.com/artifact/co.elastic.otel/elastic-otel-javaagent/latest). Download it as an
   artifact — it is **not** a Maven or Gradle compile dependency.
2. Attach it to the JVM with `-javaagent:/path/to/elastic-otel-javaagent.jar`, or set
   `JAVA_TOOL_OPTIONS="-javaagent:/path/to/elastic-otel-javaagent.jar"`. Without the attach flag the agent does nothing
   — the jar being present on disk or on the classpath has no effect.
3. Set the three required environment variables from `SKILL.md`.

## Migrate from the classic Elastic APM Java agent

Do the removal and the addition in the same change. A JVM running both agents double-instruments and produces
inconsistent traces.

1. **Remove every classic reference:** `elastic-apm-agent.jar` from the command line and from `JAVA_TOOL_OPTIONS`, the
   `elasticapm.properties` file, all `ELASTIC_APM_*` environment variables, and any `co.elastic.apm` Maven or Gradle
   dependency.
2. **Attach the EDOT agent** exactly as in the instrument path above.
3. **Translate the configuration.** The mapping is not a rename — the endpoint semantics change:

   | Classic                                 | EDOT                                                                                    |
   | --------------------------------------- | --------------------------------------------------------------------------------------- |
   | `ELASTIC_APM_SERVICE_NAME`              | `OTEL_SERVICE_NAME`                                                                     |
   | `ELASTIC_APM_SERVER_URL`                | `OTEL_EXPORTER_OTLP_ENDPOINT` — **do not reuse the old value**; it points at APM Server |
   | `ELASTIC_APM_SECRET_TOKEN` or `API_KEY` | `OTEL_EXPORTER_OTLP_HEADERS`                                                            |

4. Verify with the process in `SKILL.md`. On the migrate path, confirm the classic agent has actually stopped reporting
   — a stale deployment still sending to APM Server is the most common post-migration surprise.

## Common failure modes

| Symptom                                  | Cause                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| No telemetry at all, no agent log output | The `-javaagent` flag was never applied to the running process           |
| Connection refused or 404 on export      | `OTEL_EXPORTER_OTLP_ENDPOINT` still points at an APM Server URL          |
| Duplicated or conflicting spans          | Both the classic agent and EDOT are attached to the same JVM             |
| Traces arrive, metrics and logs do not   | An `OTEL_*_EXPORTER` variable was set to `none` and overrode the default |
