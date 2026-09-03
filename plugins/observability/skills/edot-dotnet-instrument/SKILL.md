---
name: observability-edot-dotnet-instrument
description: >
  Instrument a .NET application with the Elastic Distribution of OpenTelemetry (EDOT)
  .NET SDK for automatic tracing, metrics, and logs. Use when adding observability
  to a .NET service that has no existing APM agent.
metadata:
  author: elastic
  version: 0.1.0
---

# EDOT .NET Instrumentation

Read the setup guide before making changes:

- [EDOT .NET setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/setup)
- [EDOT .NET configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/configuration)
- [OpenTelemetry .NET instrumentation](https://opentelemetry.io/docs/zero-code/net/)

## Guidelines

1. Add NuGet packages: `Elastic.OpenTelemetry` and `OpenTelemetry.Instrumentation.AspNetCore` (for ASP.NET Core apps)
1. Register EDOT in startup: call `builder.AddElasticOpenTelemetry()` on the `IHostApplicationBuilder` (in `Program.cs`
   or equivalent). Without this, no telemetry is collected
1. Set exactly three required environment variables:
   - `OTEL_SERVICE_NAME`
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — must be the **managed OTLP endpoint** or **EDOT Collector** URL. Never use an APM
     Server URL (no `apm-server`, no `:8200`, no `/intake/v2/events`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — `"Authorization=ApiKey <key>"` or `"Authorization=Bearer <token>"`
1. Do NOT set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` — the defaults are already
   correct
1. Do NOT manually configure `TracerProvider` or `MeterProvider` — `AddElasticOpenTelemetry()` handles everything
1. Never run both classic Elastic APM agent (`Elastic.Apm.*`) and EDOT on the same application

## Examples

See the [EDOT .NET setup guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/dotnet/setup) for complete
examples.
