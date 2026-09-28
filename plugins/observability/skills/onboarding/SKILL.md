---
name: observability-onboarding
description: >
  Onboard an application into Elastic Observability with the Elastic Distribution
  of OpenTelemetry (EDOT): route on language and runtime, detect and replace a classic
  Elastic APM agent, apply the required OTLP configuration, and then verify with ES|QL
  that traces, metrics, and logs actually arrive under the expected service name.
  Use when adding observability to a service, migrating off the classic Elastic APM
  agent, or debugging why an instrumented service is not showing up in Elastic.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with an Elasticsearch context for the verification
  step, and an OTLP destination reachable from the application — either the Elastic
  managed OTLP endpoint or an EDOT Collector. ES|QL verification requires Elasticsearch
  8.11 or later. Covers Java, Python, .NET, and PHP runtimes.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
---

# Observability Onboarding

Instrument an application with the Elastic Distribution of OpenTelemetry (EDOT) and prove the telemetry arrived. The
instrumentation change is only half the job: an application can be configured perfectly and still emit nothing, so this
skill ends by querying Elasticsearch for the service's data rather than declaring success from a config diff.

The scope is application instrumentation with the EDOT SDKs. Deploying an EDOT Collector, collecting logs from files or
infrastructure, and onboarding data through Elastic Agent, Fleet, or integration packages are separate ingest paths that
this skill does not cover.

Once telemetry is flowing, use the **observability-sre-triage** skill to assess service health,
**observability-k8s-investigation** for Kubernetes-layer failures, **observability-service-reliability** to define SLOs
and alerts on the new signals, and **observability-llm-obs** for GenAI and agentic workloads.

<!-- begin-partial: preamble -->

## Environment Configuration

This skill executes Elasticsearch operations through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, call the HTTP API directly, or attempt other workarounds.

This skill references operations in HTTP-shorthand form (e.g., `GET /`, `GET /_cat/indices`, `GET /{index}/_mapping`,
`GET /{index}/_settings/index.mode`, `POST /_query`). The [Operations](#operations) table at the end of this document
maps each shorthand to the equivalent `elastic` CLI command — always use the CLI rather than calling the HTTP API
directly.

<!-- end-partial: preamble -->

### Analysis without cluster access

The CLI check above gates _querying the cluster_ — it does not gate analysis. When the user has already supplied the
evidence in their question (metric values, counts, status reasons, log lines, alert payloads, configuration), reason
from that evidence and deliver the conclusion.

When you genuinely do need data the user has not provided, still say what you would check and how — name the specific
query, index, and field that would settle the question — and then ask for CLI setup. An answer that names the check is
useful without a cluster; one that only asks for setup is not.

Only the verification step in this skill talks to Elasticsearch; it runs through `POST /_query`. Everything else edits
application code and configuration in the user's workspace.

## Jobs to be done

- Decide whether a service needs fresh instrumentation or a migration off the classic Elastic APM agent
- Apply the EDOT configuration for the service's language and runtime
- Point telemetry at the correct OTLP destination and reject APM Server URLs
- Verify that traces, metrics, and logs land in Elasticsearch under the expected `service.name`
- Diagnose an instrumented service that is reporting nothing, or reporting from the wrong agent

## Output discipline

Applies to every response produced under this skill.

- **Make the edit.** When the language, the current agent, and the destination are known, apply the change. Do not
  narrate a plan and ask for approval on each file; ask only when a decision genuinely cannot be inferred.
- **Do not dump documentation.** Link the relevant page and state the two or three rules that apply to this service.
  Pasting a whole setup guide into the reply is a defect.
- **Verify before reporting success.** "Configured correctly" is not the finding; "telemetry is arriving" is. If
  verification returns no rows, say the service is not reporting and give the most likely cause.
- **Do not speculate past the evidence.** If the verification query is empty, that is one fact with several possible
  causes — name the likeliest and how to distinguish it, rather than asserting one.
- **End on the result.** No trailing offers such as "want me to set up dashboards next?". Follow-up work belongs in a
  recommendations list, phrased as a recommendation.

## Process: route the request

1. **Identify the language and runtime.** Read the project's dependency manifest — `pom.xml` or `build.gradle`,
   `requirements.txt` or `pyproject.toml`, `*.csproj`, `composer.json`. The decision: which language reference to open.
   Also note how the process starts (a Dockerfile `ENTRYPOINT`, a Kubernetes pod spec, a systemd unit), because that is
   where the agent attaches and where the environment variables must be set.

   | Runtime | Reference                                    | How EDOT attaches                                          |
   | ------- | -------------------------------------------- | ---------------------------------------------------------- |
   | Java    | [references/java.md](references/java.md)     | `-javaagent:` flag or `JAVA_TOOL_OPTIONS`                  |
   | Python  | [references/python.md](references/python.md) | `opentelemetry-instrument` entrypoint wrapper              |
   | .NET    | [references/dotnet.md](references/dotnet.md) | `builder.AddElasticOpenTelemetry()` in startup             |
   | PHP     | [references/php.md](references/php.md)       | native extension via OS package, then full process restart |

   For a language not listed, follow the same shape — the required configuration and the following verification step are
   language-independent — and use the upstream EDOT SDK documentation for the attach mechanism.

2. **Detect a classic Elastic APM agent.** The decision: instrument path or migrate path. Each language reference lists
   the markers; the common ones are `ELASTIC_APM_*` environment variables and a language-specific Elastic APM package.
   If any marker is present, take the migrate path — do not layer EDOT on top.

3. **Resolve the telemetry destination.** The decision: which URL goes in `OTEL_EXPORTER_OTLP_ENDPOINT`. Two valid
   answers, and one common wrong one:
   - The **Elastic managed OTLP endpoint** for the deployment or Serverless project. Correct default.
   - An **EDOT Collector** the user already runs, when telemetry must be enriched, sampled, or fanned out before it
     reaches Elastic.
   - **Never an APM Server URL.** If the candidate contains `apm-server`, ends in port 8200, or has an
     `/intake/v2/events` path, it is the classic ingest endpoint and EDOT cannot use it. On the migrate path this is the
     single most common mistake — the old `ELASTIC_APM_SERVER_URL` value must not be carried over.

4. **Apply the shared configuration below, then the language reference.** The shared rules are the same for every
   runtime; the reference covers only what is language-specific.

5. **Verify.** Do not report success from the configuration alone — run the verification process.

## Required configuration

Identical across every EDOT SDK. Set exactly three environment variables:

| Variable                      | Value                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OTEL_SERVICE_NAME`           | The service's name. This becomes `service.name` in Elasticsearch and is how every other Observability skill finds it. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The managed OTLP endpoint or EDOT Collector URL resolved in step 3.                                                   |
| `OTEL_EXPORTER_OTLP_HEADERS`  | The credential, in `Authorization=ApiKey <key>` or `Authorization=Bearer <token>` form.                               |

Two rules that hold for every language:

- **Do not set `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER`.** The defaults are already
  correct. Setting them is the usual reason a service reports traces but no metrics or logs.
- **Never run a classic Elastic APM agent and EDOT together** on the same process. They double-instrument and produce
  inconsistent traces. Removal and replacement belong in the same change.

## Process: verify telemetry arrives

Run this after every instrument or migrate change, and as the entry point when a user reports that an instrumented
service is missing. Give the pipeline a minute or two after the deployment restarts before concluding anything.

1. **Confirm documents are landing for the service.** Query `POST /_query`, scoping to the service name that was set in
   `OTEL_SERVICE_NAME`. The decision: is anything arriving at all, and across which signals.

   ```esql
   FROM traces-*,metrics-*,logs-* METADATA _index
   | WHERE @timestamp > NOW() - 15 minutes AND service.name == "<service>"
   | STATS docs = COUNT(*), last_seen = MAX(@timestamp) BY _index
   | SORT docs DESC
   | LIMIT 20
   ```

   A healthy result has rows from a traces data stream, a metrics data stream, and a logs data stream, with `last_seen`
   inside the last minute or two. Missing signals are diagnostic, not cosmetic: traces only, with no metrics or logs,
   usually means an `OTEL_*_EXPORTER` variable was set.

2. **If nothing came back, find out what name the service is reporting under.** An empty result is ambiguous between "no
   telemetry at all" and "telemetry arriving under a different name" — a typo in `OTEL_SERVICE_NAME`, or the SDK default
   of `unknown_service`. Drop the service filter and look at what is actually arriving.

   ```esql
   FROM traces-*,metrics-*,logs-*
   | WHERE @timestamp > NOW() - 15 minutes
   | STATS docs = COUNT(*), last_seen = MAX(@timestamp) BY service.name
   | SORT docs DESC
   | LIMIT 25
   ```

   The decision: if the service appears under an unexpected name, fix `OTEL_SERVICE_NAME`. If it does not appear at all,
   the exporter is not reaching the destination — go back to step 3 of the routing process and re-check the endpoint and
   credential.

3. **Confirm EDOT is the reporter, not something else.** This is what distinguishes a correct migration from a
   half-finished one, and vanilla OpenTelemetry from EDOT.

   ```esql
   FROM traces-*
   | WHERE @timestamp > NOW() - 15 minutes AND service.name == "<service>"
   | STATS spans = COUNT(*) BY telemetry.sdk.language, telemetry.sdk.name, telemetry.distro.name, telemetry.distro.version
   | SORT spans DESC
   | LIMIT 10
   ```

   `telemetry.distro.name` is `elastic` when an EDOT SDK is reporting. A null distro with
   `telemetry.sdk.name == "opentelemetry"` means the application is on the upstream OpenTelemetry SDK rather than EDOT.
   Two rows for one service — one with the Elastic distro and one without, or two different `telemetry.sdk.language`
   values — means more than one agent is attached, or an old deployment is still running.

4. **Diagnose from the shape of the result.**

   | Verification result                                        | Most likely cause                                                         |
   | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
   | No rows for the service, and the name is absent everywhere | Exporter never reached the destination — wrong endpoint or bad credential |
   | Service appears under a different name                     | `OTEL_SERVICE_NAME` unset or misspelled; SDK fell back to its default     |
   | Traces only, no metrics or logs                            | An `OTEL_*_EXPORTER` variable was set and overrode the default            |
   | Rows present but `last_seen` is stale                      | The process exited, or the deployment was rolled back                     |
   | Two distro values for one service                          | Classic agent and EDOT both attached, or an old replica still running     |

   If the field names above are absent from the mapping, confirm what is available with `GET /<index>/_mapping` before
   concluding the telemetry is wrong.

## Examples

**"Add observability to my Spring Boot service"** — read `pom.xml` to confirm Java, check for `co.elastic.apm` and
`ELASTIC_APM_*` markers, and finding none, take the instrument path in `references/java.md`. Add the `-javaagent` flag
to the container entrypoint, set the three environment variables against the managed OTLP endpoint, then run the
verification query and report which signals arrived.

**"We're moving off the Elastic APM agent to EDOT, we're on .NET"** — this is the migrate path. Remove the
`Elastic.Apm.*` packages, the `AddAllElasticApm()` call, and the `ElasticApm` block from `appsettings.json` in the same
change that adds `Elastic.OpenTelemetry` and `builder.AddElasticOpenTelemetry()`. Translate the configuration rather
than copying it — in particular do not reuse `ELASTIC_APM_SERVER_URLS` as the OTLP endpoint. Verify with step 3 and
confirm exactly one distro is reporting.

**"I instrumented my Python app but nothing shows up in Elastic"** — start at the verification process, not at the
configuration. Run step 1; if it is empty, run step 2 to see whether the service is reporting under a different name. If
the service is absent entirely, the two candidates are an unwrapped entrypoint (`opentelemetry-instrument` missing) and
an endpoint still pointing at APM Server. Check the entrypoint first — it is the more common of the two.

**"Our service sends traces but we have no logs or metrics"** — this is the `OTEL_*_EXPORTER` signature. Confirm it with
step 1, which will show a traces data stream and nothing else, then remove the `OTEL_TRACES_EXPORTER`,
`OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` variable from the deployment and re-verify.

## Guidelines

- **Read the setup or migration guide for the language before editing.** The per-language references link the
  authoritative page; the attach mechanism differs enough between runtimes that pattern-matching from another language
  produces broken configurations.
- **Removal and replacement go in one change.** A window where both the classic agent and EDOT are attached produces
  double-instrumented traces that are worse than either alone.
- **Never carry the classic server URL forward.** `ELASTIC_APM_SERVER_URL` points at APM Server;
  `OTEL_EXPORTER_OTLP_ENDPOINT` must point at the managed OTLP endpoint or an EDOT Collector.
- **Set the three variables and no more.** Additional `OTEL_*` tuning is occasionally justified, but the exporter
  variables specifically should be left at their defaults.
- **Treat an empty verification result as unknown, not as failure of a specific component.** Distinguish the causes with
  step 2 before recommending a fix.
- **Never place a credential in the skill's output or in a committed file.** `OTEL_EXPORTER_OTLP_HEADERS` belongs in the
  deployment's secret mechanism.
- Attribution: the per-language EDOT guidance consolidated here originates with the `apm-agent-devs` team.

## Operations

| HTTP API (shorthand)    | `elastic` CLI command                                 |
| ----------------------- | ----------------------------------------------------- |
| `GET /`                 | `elastic es info`                                     |
| `POST /_query`          | `elastic es esql query --format tsv --query '<esql>'` |
| `GET /<index>/_mapping` | `elastic es indices get-mapping --index '<index>'`    |
