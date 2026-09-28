# EDOT .NET

Covers both paths: instrumenting a .NET service that has no APM agent, and migrating one that still runs the classic
Elastic APM .NET agent. The shared configuration rules (the three required environment variables, the exporter variables
you must not set, and the never-run-both rule) are in `SKILL.md` and are not repeated here.

Official documentation:

- [EDOT .NET setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/setup)
- [EDOT .NET configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/configuration)
- [EDOT .NET migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/migration)
- [OpenTelemetry .NET instrumentation](https://opentelemetry.io/docs/zero-code/net/)

Read the setup guide (or the migration guide, on the migrate path) before making changes.

## Detecting a classic agent

The service is on the classic Elastic APM .NET agent if any of these are present:

- any `Elastic.Apm.*` NuGet package, including `Elastic.Apm.NetCoreAll`
- a `UseAllElasticApm()` or `AddAllElasticApm()` call in startup
- an `ElasticApm` section in `appsettings.json`
- `ELASTIC_APM_*` environment variables

Any one of these means take the migrate path.

## Instrument

1. Add the NuGet packages `Elastic.OpenTelemetry` and, for ASP.NET Core applications,
   `OpenTelemetry.Instrumentation.AspNetCore`.
2. Register EDOT in startup: call `builder.AddElasticOpenTelemetry()` on the `IHostApplicationBuilder`, in `Program.cs`
   or the equivalent. Without this call no telemetry is collected — referencing the package is not enough.
3. Set the three required environment variables from `SKILL.md`.

Do **not** manually configure `TracerProvider` or `MeterProvider`. `AddElasticOpenTelemetry()` handles both, and manual
provider setup competes with it.

## Migrate from the classic Elastic APM .NET agent

Do the removal and the addition in the same change. Running both agents in one application double-instruments and
produces inconsistent traces.

1. **Remove every classic reference:** all `Elastic.Apm.*` NuGet packages including `Elastic.Apm.NetCoreAll`, every
   `UseAllElasticApm()` and `AddAllElasticApm()` call, the `ElasticApm` section of `appsettings.json`, and all
   `ELASTIC_APM_*` environment variables.
2. **Add and register EDOT** exactly as in the instrument path above.
3. **Translate the configuration.** The mapping is not a rename — the endpoint semantics change:

   | Classic                                               | EDOT                                                                                    |
   | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
   | `ELASTIC_APM_SERVICE_NAME` / `ElasticApm:ServiceName` | `OTEL_SERVICE_NAME`                                                                     |
   | `ELASTIC_APM_SERVER_URLS`                             | `OTEL_EXPORTER_OTLP_ENDPOINT` — **do not reuse the old value**; it points at APM Server |
   | `ELASTIC_APM_SECRET_TOKEN`                            | `OTEL_EXPORTER_OTLP_HEADERS`                                                            |

4. Verify with the process in `SKILL.md`. On the migrate path, confirm the classic agent has actually stopped reporting
   — a stale deployment still sending to APM Server is the most common post-migration surprise.

## Common failure modes

| Symptom                                   | Cause                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| No telemetry at all                       | `builder.AddElasticOpenTelemetry()` was never called                     |
| HTTP spans missing on an ASP.NET Core app | `OpenTelemetry.Instrumentation.AspNetCore` was not added                 |
| Connection refused or 404 on export       | `OTEL_EXPORTER_OTLP_ENDPOINT` still points at an APM Server URL          |
| Duplicated or conflicting spans           | Both `Elastic.Apm.*` and EDOT are active in the same application         |
| Traces arrive, metrics and logs do not    | An `OTEL_*_EXPORTER` variable was set to `none` and overrode the default |
