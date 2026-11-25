# EDOT Python

Covers both paths: instrumenting a Python service that has no APM agent, and migrating one that still runs the classic
`elastic-apm` agent. The shared configuration rules (the three required environment variables, the exporter variables
you must not set, and the never-run-both rule) are in `SKILL.md` and are not repeated here.

Official documentation:

- [EDOT Python setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/setup)
- [EDOT Python configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/configuration)
- [EDOT Python migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/python/migration)
- [OpenTelemetry Python auto-instrumentation](https://opentelemetry.io/docs/zero-code/python/)

Read the setup guide (or the migration guide, on the migrate path) before making changes.

## Detecting a classic agent

The service is on the classic Elastic APM Python agent if any of these are present:

- `elastic-apm` in `requirements.txt`, `pyproject.toml`, or an equivalent dependency file
- `ElasticAPM(app)` or any `elasticapm.contrib.*` import in application code
- an `app.config['ELASTIC_APM']` block
- `ELASTIC_APM_*` environment variables

Any one of these means take the migrate path.

## Instrument

1. Install `elastic-opentelemetry` via pip and add it to `requirements.txt` or the equivalent dependency file.
2. Run `edot-bootstrap --action=install` during the image build. This inspects the installed libraries and pulls the
   matching auto-instrumentation packages; skipping it leaves most libraries uninstrumented.
3. Wrap the application entrypoint with `opentelemetry-instrument` — for example
   `opentelemetry-instrument gunicorn app:app` or `opentelemetry-instrument python app.py`. Without the wrapper no
   telemetry is collected.
4. Set the three required environment variables from `SKILL.md`.

Do **not** add code-level SDK setup. No `TracerProvider`, no `configure_azure_monitor`, no manual exporter wiring —
`opentelemetry-instrument` handles all of it, and hand-rolled setup competes with it.

## Migrate from the classic Elastic APM Python agent

Do the removal and the addition in the same change. Running both agents in one process double-instruments and produces
inconsistent traces.

1. **Remove every classic reference:** `elastic-apm` from the dependency file, `ElasticAPM(app)` and every
   `elasticapm.contrib.*` import from application code, the `app.config['ELASTIC_APM']` block, and all `ELASTIC_APM_*`
   environment variables.
2. **Install and wire EDOT** exactly as in the instrument path above.
3. **Translate the configuration.** The mapping is not a rename — the endpoint semantics change:

   | Classic                    | EDOT                                                                                    |
   | -------------------------- | --------------------------------------------------------------------------------------- |
   | `ELASTIC_APM_SERVICE_NAME` | `OTEL_SERVICE_NAME`                                                                     |
   | `ELASTIC_APM_SERVER_URL`   | `OTEL_EXPORTER_OTLP_ENDPOINT` — **do not reuse the old value**; it points at APM Server |
   | `ELASTIC_APM_SECRET_TOKEN` | `OTEL_EXPORTER_OTLP_HEADERS`                                                            |

4. Verify with the process in `SKILL.md`. On the migrate path, confirm the classic agent has actually stopped reporting
   — a stale deployment still sending to APM Server is the most common post-migration surprise.

## Common failure modes

| Symptom                                | Cause                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------ |
| No telemetry at all                    | The entrypoint is not wrapped with `opentelemetry-instrument`            |
| Only a few libraries produce spans     | `edot-bootstrap --action=install` was never run during the build         |
| Connection refused or 404 on export    | `OTEL_EXPORTER_OTLP_ENDPOINT` still points at an APM Server URL          |
| Duplicated or conflicting spans        | Both `elastic-apm` and EDOT are active in the same process               |
| Traces arrive, metrics and logs do not | An `OTEL_*_EXPORTER` variable was set to `none` and overrode the default |
