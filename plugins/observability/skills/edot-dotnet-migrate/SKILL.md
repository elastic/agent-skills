---
name: observability-edot-dotnet-migrate
description: >
  Migrate a .NET application from the classic Elastic APM .NET agent to the EDOT .NET
  SDK. Use when switching from Elastic.Apm.* packages to Elastic.OpenTelemetry.
metadata:
  author: elastic
  version: 0.1.0
---

# EDOT .NET Migration

Read the migration guide before making changes:

- [Migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/migration)
- [EDOT .NET setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/setup)
- [EDOT .NET configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/configuration)

## Guidelines

1. Remove ALL classic APM references: `Elastic.Apm.*` NuGet packages (including `Elastic.Apm.NetCoreAll`),
   `UseAllElasticApm()` / `AddAllElasticApm()` calls, the `ElasticApm` section from `appsettings.json`, and all
   `ELASTIC_APM_*` env vars
1. Add NuGet packages: `Elastic.OpenTelemetry` and `OpenTelemetry.Instrumentation.AspNetCore` (for ASP.NET Core apps)
1. Register EDOT in startup: call `builder.AddElasticOpenTelemetry()` on the `IHostApplicationBuilder` (in `Program.cs`
   or equivalent). Without this, no telemetry is collected
1. Set exactly three required environment variables:
   - `OTEL_SERVICE_NAME` (replaces `ELASTIC_APM_SERVICE_NAME` / `ElasticApm:ServiceName`)
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — must be the **managed OTLP endpoint** or **EDOT Collector** URL. Do NOT reuse the
     old `ELASTIC_APM_SERVER_URLS` value. Never use an APM Server URL (no `apm-server`, no `:8200`, no
     `/intake/v2/events`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — `"Authorization=ApiKey <key>"` or `"Authorization=Bearer <token>"` (replaces
     `ELASTIC_APM_SECRET_TOKEN`)
1. Do NOT set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` — the defaults are already
   correct
1. Never run both classic Elastic APM agent (`Elastic.Apm.*`) and EDOT on the same application

## Examples

See the [EDOT .NET migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/migration) for
complete examples.
