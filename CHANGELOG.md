# Changelog

## v0.6.0

### New Skills

- `skills/cloud/onboarding` (v0.3.0)
- `skills/cloud/provisioning` (v0.3.0)
- `skills/elasticsearch/elasticsearch-anomaly-detection` (v1.1.0)
- `skills/elasticsearch/elasticsearch-anomaly-detection-explainer` (v0.3.0)
- `skills/elasticsearch/elasticsearch-cluster-health` (v0.1.0)
- `skills/elasticsearch/elasticsearch-index-design` (v0.1.0)
- `skills/elasticsearch/elasticsearch-ingest` (v0.1.0)
- `skills/elasticsearch/elasticsearch-query-optimization` (v0.1.0)
- `skills/elasticsearch/elasticsearch-reindex` (v0.2.0)
- `skills/elasticsearch/elasticsearch-search-relevance` (v0.1.0)
- `skills/kibana/kibana-agent-builder` (v0.3.0)
- `skills/observability/onboarding` (v0.3.0)
- `skills/observability/service-reliability` (v0.4.1)
- `skills/observability/sre-triage` (v0.5.1)

### Updated Skills

- `skills/elasticsearch/elasticsearch-esql` (v0.5.0 → v0.7.0)
- `skills/elasticsearch/elasticsearch-onboarding` (v0.1.0)
- `skills/kibana/kibana-alerting-rules` (v0.1.0 → v0.3.0)
- `skills/kibana/kibana-anomaly-detection` (v0.2.0 → v0.3.0)
- `skills/kibana/kibana-dashboards` (v0.1.2 → v0.3.0)
- `skills/kibana/kibana-workflows` (v0.5.0)
- `skills/observability/k8s-investigation` (v0.2.0 → v0.5.1)
- `skills/observability/llm-obs` (v0.1.0 → v0.3.1)

### Removed Skills

- `skills/cloud/access-management`
- `skills/cloud/create-project`
- `skills/cloud/manage-project`
- `skills/cloud/network-security`
- `skills/cloud/setup`
- `skills/elasticsearch/elasticsearch-audit`
- `skills/elasticsearch/elasticsearch-authn`
- `skills/elasticsearch/elasticsearch-authz`
- `skills/elasticsearch/elasticsearch-file-ingest`
- `skills/elasticsearch/elasticsearch-security-troubleshooting`
- `skills/kibana/agent-builder`
- `skills/kibana/kibana-audit`
- `skills/kibana/kibana-connectors`
- `skills/kibana/kibana-vega`
- `skills/kibana/streams`
- `skills/observability/edot-dotnet-instrument`
- `skills/observability/edot-dotnet-migrate`
- `skills/observability/edot-java-instrument`
- `skills/observability/edot-java-migrate`
- `skills/observability/edot-python-instrument`
- `skills/observability/edot-python-migrate`
- `skills/observability/logs-search`
- `skills/observability/manage-slos`
- `skills/observability/service-health`

### Generated Artifacts

- Regenerated README skill table

## v0.4.0

### New Skills

- `skills/kibana/kibana-workflows` (v0.5.0)

### Updated Skills

- `skills/elasticsearch/elasticsearch-esql` (v0.3.0 → v0.5.0)
- `skills/elasticsearch/elasticsearch-onboarding` (v0.1.0)
- `skills/kibana/agent-builder` (v0.2.0)
- `skills/kibana/kibana-dashboards` (v0.1.2)
- `skills/kibana/streams` (v0.1.0 → v0.2.0)

### Generated Artifacts

- Regenerated README skill table

## v0.3.0

### New Skills

- `skills/kibana/kibana-anomaly-detection` (v0.2.0)
- `skills/observability/k8s-investigation` (v0.2.0)

### Updated Skills

- `skills/elasticsearch/elasticsearch-esql` (v0.1.1 → v0.3.0)
- `skills/elasticsearch/elasticsearch-onboarding` (v0.1.0)
- `skills/kibana/kibana-dashboards` (v0.1.1 → v0.1.2)

### Generated Artifacts

- Regenerated README skill table

## v0.2.4

### Updated Skills

- `skills/elasticsearch/elasticsearch-onboarding` (v0.1.0)

### Generated Artifacts

- Regenerated README skill table

## v0.2.3

### Updated Skills

- `skills/elasticsearch/elasticsearch-esql` (v0.1.1)
- `skills/elasticsearch/elasticsearch-onboarding` (v0.1.0)
- `skills/kibana/kibana-dashboards` (v0.1.0 → v0.1.1)

### Generated Artifacts

- Regenerated README skill table

## v0.2.2

### Fixes

- Worked around Claude Code validation error on `"skills": "./"` in plugin.json by moving plugin metadata to `plugins/` with symlinked skills directories
- Fixed CI workflow paths (`version-sync`, `release-check`) to match new `plugins/` layout

## v0.2.1

### Updated Skills

- `skills/cloud/access-management` (v0.1.0)
- `skills/cloud/network-security` (v0.1.0)
- `skills/elasticsearch/elasticsearch-esql` (v0.1.1)
- `skills/elasticsearch/elasticsearch-file-ingest` (v0.1.0 → v0.2.0)
- `skills/kibana/kibana-vega` (v0.1.0)

### Generated Artifacts

- Regenerated README skill table

## v0.2.0

### New Skills

- `skills/elasticsearch/elasticsearch-onboarding` (v0.1.0)

### Updated Skills

- `skills/cloud/create-project` (v0.1.0)
- `skills/cloud/setup` (v0.1.0)
- `skills/elasticsearch/elasticsearch-authz` (v0.1.0 → v0.1.1)
- `skills/elasticsearch/elasticsearch-esql` (v0.1.0 → v0.1.1)
- `skills/kibana/streams` (v0.1.0)
- `skills/observability/edot-java-instrument` (v0.1.0 → v0.1.1)
- `skills/observability/edot-java-migrate` (v0.1.0 → v0.1.1)
- `skills/observability/manage-slos` (v0.2.0)

### Generated Artifacts

- Regenerated README skill table

## v0.1.1

### New Skills

- `skills/observability/edot-dotnet-instrument` (v0.1.0)
- `skills/observability/edot-dotnet-migrate` (v0.1.0)
- `skills/observability/edot-java-instrument` (v0.1.0)
- `skills/observability/edot-java-migrate` (v0.1.0)
- `skills/observability/edot-python-instrument` (v0.1.0)
- `skills/observability/edot-python-migrate` (v0.1.0)

### Generated Artifacts

- Regenerated README skill table

## v0.1.0

### New Skills

- `skills/cloud/access-management` (v0.1.0)
- `skills/cloud/create-project` (v0.1.0)
- `skills/cloud/manage-project` (v0.1.0)
- `skills/cloud/network-security` (v0.1.0)
- `skills/cloud/setup` (v0.1.0)
- `skills/elasticsearch/elasticsearch-audit` (v0.1.0)
- `skills/elasticsearch/elasticsearch-authn` (v0.1.0)
- `skills/elasticsearch/elasticsearch-authz` (v0.1.0)
- `skills/elasticsearch/elasticsearch-esql` (v0.1.0)
- `skills/elasticsearch/elasticsearch-file-ingest` (v0.1.0)
- `skills/elasticsearch/elasticsearch-security-troubleshooting` (v0.1.0)
- `skills/kibana/agent-builder` (v0.2.0)
- `skills/kibana/kibana-alerting-rules` (v0.1.0)
- `skills/kibana/kibana-audit` (v0.1.0)
- `skills/kibana/kibana-connectors` (v0.1.1)
- `skills/kibana/kibana-dashboards` (v0.1.0)
- `skills/kibana/kibana-vega` (v0.1.0)
- `skills/kibana/streams` (v0.1.0)
- `skills/observability/llm-obs` (v0.1.0)
- `skills/observability/logs-search` (v0.2.0)
- `skills/observability/manage-slos` (v0.2.0)
- `skills/observability/service-health` (v0.1.0)
- `skills/security/alert-triage` (v0.1.0)
- `skills/security/case-management` (v0.1.0)
- `skills/security/detection-rule-management` (v0.1.0)
- `skills/security/generate-security-sample-data` (v0.1.0)

### Generated Artifacts

- Regenerated README skill table
