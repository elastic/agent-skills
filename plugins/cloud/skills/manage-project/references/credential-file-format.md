# Credential file format

Each section in `.elastic-credentials` starts with a header containing the **project name** and **project ID**. The
`load-credentials` command uses these headers to retrieve credentials for a specific project.

**Project section** (written automatically by `create-project` and `reset-credentials`):

```text
# Project: <project-name> | id=<project-id> | <timestamp>
ELASTICSEARCH_URL=https://...
KIBANA_URL=https://...
ELASTICSEARCH_USERNAME=admin
ELASTICSEARCH_PASSWORD=<password>
```

**API key section** (append when creating Elasticsearch API keys):

```text
# API Key: <key-name> | project=<project-name> | id=<project-id> | <details>
ELASTICSEARCH_API_KEY=<base64-encoded-key>
```

Sections for the same project are merged by `load-credentials`. Later entries overwrite earlier ones.
`ELASTICSEARCH_USERNAME` and `ELASTICSEARCH_PASSWORD` are saved to the file but **not exported** by `load-credentials`
unless `--include-admin` is passed. Use `--include-admin` only when creating an API key, then reload without it.
