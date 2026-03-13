---
name: elasticsearch-file-ingest
description: >
  Ingest and transform data files (CSV/JSON/Parquet/Arrow IPC) into Elasticsearch
  with stream processing, custom transforms, and cross-version reindexing. Use when
  loading files, batch importing data, or migrating indices across versions — not
  for general ingest pipeline design or bulk API patterns.
metadata:
  author: elastic
  version: 0.1.0
---

# Elasticsearch File Ingest

Stream-based ingestion and transformation of large data files (NDJSON, CSV, Parquet, Arrow IPC) into Elasticsearch.

## Features & Use Cases

- **Stream-based**: Handle large files without running out of memory
- **High throughput**: 50k+ documents/second on commodity hardware
- **Cross-version**: Seamlessly migrate between ES 8.x and 9.x, or replicate across clusters
- **Formats**: NDJSON, CSV, Parquet, Arrow IPC
- **Transformations**: Apply custom JavaScript transforms during ingestion (enrich, split, filter)
- **Reindexing**: Copy and transform existing indices (rename fields, restructure documents)
- **Batch processing**: Ingest multiple files matching a pattern (e.g., `logs/*.json`)
- **Document splitting**: Transform one source document into multiple targets

## Prerequisites

- **Elasticsearch 8.x or 9.x** accessible (local or remote)
- **Node.js 22+** installed

## Setup

This skill is self-contained. The `scripts/` folder and `package.json` live in this skill's directory. Run all commands
from this directory. Use absolute paths when referencing data files located elsewhere.

Before first use, install dependencies:

```bash
npm install
```

### Environment Configuration

Elasticsearch connection is configured via environment variables. The CLI flags `--node`, `--api-key`, `--username`, and
`--password` override environment variables when provided.

#### Option 1: Elastic Cloud (recommended for production)

```bash
export ELASTICSEARCH_CLOUD_ID="deployment-name:base64encodedcloudid"
export ELASTICSEARCH_API_KEY="base64encodedapikey"
```

#### Option 2: Direct URL with API Key

```bash
export ELASTICSEARCH_URL="https://elasticsearch:9200"
export ELASTICSEARCH_API_KEY="base64encodedapikey"
```

#### Option 3: Basic Authentication

```bash
export ELASTICSEARCH_URL="https://elasticsearch:9200"
export ELASTICSEARCH_USERNAME="elastic"
export ELASTICSEARCH_PASSWORD="changeme"
```

#### Option 4: Local Development with start-local

For local development and testing, use [start-local](https://github.com/elastic/start-local) to quickly spin up
Elasticsearch and Kibana using Docker or Podman:

```bash
curl -fsSL https://elastic.co/start-local | sh
```

After installation completes, source the generated `.env` file:

```bash
source elastic-start-local/.env
export ELASTICSEARCH_URL="$ES_LOCAL_URL"
export ELASTICSEARCH_API_KEY="$ES_LOCAL_API_KEY"
```

#### Optional: Skip TLS verification (development only)

```bash
export ELASTICSEARCH_INSECURE="true"
```

## Examples

### Ingest a JSON file

```bash
node scripts/ingest.js --file /absolute/path/to/data.json --target my-index
```

### Stream NDJSON/CSV via stdin

```bash
# NDJSON
cat /absolute/path/to/data.ndjson | node scripts/ingest.js --stdin --target my-index

# CSV
cat /absolute/path/to/data.csv | node scripts/ingest.js --stdin --source-format csv --target my-index
```

### Ingest CSV directly

```bash
node scripts/ingest.js --file /absolute/path/to/users.csv --source-format csv --target users
```

### Ingest Parquet directly

```bash
node scripts/ingest.js --file /absolute/path/to/users.parquet --source-format parquet --target users
```

### Ingest Arrow IPC directly

```bash
node scripts/ingest.js --file /absolute/path/to/users.arrow --source-format arrow --target users
```

### Ingest CSV with parser options

```bash
# csv-options.json
# {
#   "columns": true,
#   "delimiter": ";",
#   "trim": true
# }

node scripts/ingest.js --file /absolute/path/to/users.csv --source-format csv --csv-options csv-options.json --target users
```

### Infer mappings/pipeline from CSV

When using `--infer-mappings`, do **not** combine it with `--source-format csv`. Inference sends a raw sample to
Elasticsearch's `_text_structure/find_structure` endpoint, which returns both mappings and an ingest pipeline with a CSV
processor. If `--source-format csv` is also set, CSV is parsed client-side **and** server-side, resulting in an empty
index. Let `--infer-mappings` handle everything:

```bash
node scripts/ingest.js --file /absolute/path/to/users.csv --infer-mappings --target users
```

### Infer mappings with options

```bash
# infer-options.json
# {
#   "sampleBytes": 200000,
#   "lines_to_sample": 2000
# }

node scripts/ingest.js --file /absolute/path/to/users.csv --infer-mappings --infer-mappings-options infer-options.json --target users
```

### Ingest with custom mappings

```bash
node scripts/ingest.js --file /absolute/path/to/data.json --target my-index --mappings mappings.json
```

### Ingest with transformation

```bash
node scripts/ingest.js --file /absolute/path/to/data.json --target my-index --transform transform.js
```

### Reindex from another index

```bash
node scripts/ingest.js --source-index old-index --target new-index
```

### Cross-cluster reindex (ES 8.x → 9.x)

```bash
node scripts/ingest.js --source-index logs \
  --node https://es8.example.com:9200 --api-key es8-key \
  --target new-logs \
  --target-node https://es9.example.com:9200 --target-api-key es9-key
```

## Command Reference

### Required Options

```bash
--target <index>         # Target index name
```

### Source Options (choose one)

```bash
--file <path>            # Source file (supports wildcards, e.g., logs/*.json)
--source-index <name>    # Source Elasticsearch index
--stdin                  # Read NDJSON/CSV from stdin
```

### Elasticsearch Connection

```bash
--node <url>             # ES node URL (default: http://localhost:9200)
--api-key <key>          # API key authentication
--username <user>        # Basic auth username
--password <pass>        # Basic auth password
```

### Target Connection (for cross-cluster)

```bash
--target-node <url>      # Target ES node URL (uses --node if not specified)
--target-api-key <key>   # Target API key
--target-username <user> # Target username
--target-password <pass> # Target password
```

### Index Configuration

```bash
--mappings <file.json>          # Mappings file (auto-copy from source if reindexing)
--infer-mappings                # Infer mappings/pipeline from file/stream (do NOT combine with --source-format)
--infer-mappings-options <file> # Options for inference (JSON file)
--delete-index                  # Delete target index if exists
--pipeline <name>               # Ingest pipeline name
```

### Processing

```bash
--transform <file.js>    # Transform function (export as default or module.exports)
--query <file.json>      # Query file to filter source documents
--source-format <fmt>    # Source format: ndjson|csv|parquet|arrow (default: ndjson)
--csv-options <file>     # CSV parser options (JSON file)
--skip-header            # Skip first line (e.g., CSV header)
```

### Performance

```bash
--buffer-size <kb>       # Buffer size in KB (default: 5120)
--search-size <n>        # Docs per search when reindexing (default: 100)
--total-docs <n>         # Total docs for progress bar (file/stream)
--stall-warn-seconds <n> # Stall warning threshold (default: 30)
--progress-mode <mode>   # Progress output: auto|line|newline (default: auto)
--debug-events           # Log pause/resume/stall events
--quiet                  # Disable progress bars
```

## Transform Functions

Transform functions let you modify documents during ingestion. Create a JavaScript file that exports a transform
function:

### Basic Transform (transform.js)

```javascript
// ES modules (default)
export default function transform(doc) {
  return {
    ...doc,
    full_name: `${doc.first_name} ${doc.last_name}`,
    timestamp: new Date().toISOString(),
  };
}

// Or CommonJS
module.exports = function transform(doc) {
  return {
    ...doc,
    full_name: `${doc.first_name} ${doc.last_name}`,
  };
};
```

### Skip Documents

Return `null` or `undefined` to skip a document:

```javascript
export default function transform(doc) {
  // Skip invalid documents
  if (!doc.email || !doc.email.includes("@")) {
    return null;
  }
  return doc;
}
```

### Split Documents

Return an array to create multiple target documents from one source:

```javascript
export default function transform(doc) {
  // Split a tweet into multiple hashtag documents
  const hashtags = doc.text.match(/#\w+/g) || [];
  return hashtags.map((tag) => ({
    hashtag: tag,
    tweet_id: doc.id,
    created_at: doc.created_at,
  }));
}
```

## Mappings

### Auto-Copy Mappings (Reindexing)

When reindexing, mappings are automatically copied from the source index:

```bash
node scripts/ingest.js --source-index old-logs --target new-logs
```

### Custom Mappings (mappings.json)

```json
{
  "properties": {
    "@timestamp": { "type": "date" },
    "message": { "type": "text" },
    "user": {
      "properties": {
        "name": { "type": "keyword" },
        "email": { "type": "keyword" }
      }
    }
  }
}
```

```bash
node scripts/ingest.js --file /absolute/path/to/data.json --target my-index --mappings mappings.json
```

## Query Filters

Filter source documents during reindexing with a query file:

### Query File (filter.json)

```json
{
  "range": {
    "@timestamp": {
      "gte": "2024-01-01",
      "lt": "2024-02-01"
    }
  }
}
```

```bash
node scripts/ingest.js \
  --source-index logs \
  --target filtered-logs \
  --query filter.json
```

## Boundaries

- **Never** run destructive commands (such as using the `--delete-index` flag or deleting existing indices and data)
  without explicit user confirmation.

## Guidelines

- **Never combine `--infer-mappings` with `--source-format`**. Inference creates a server-side ingest pipeline that
  handles parsing (e.g., CSV processor). Using `--source-format csv` parses client-side as well, causing double-parsing
  and an empty index. Use `--infer-mappings` alone for automatic detection, or `--source-format` with explicit
  `--mappings` for manual control.
- **Use `--source-format csv` with `--mappings`** when you want client-side CSV parsing with known field types.
- **Use `--infer-mappings` alone** when you want Elasticsearch to detect the format, infer field types, and create an
  ingest pipeline automatically.

## When NOT to Use

Consider alternatives for:

- **Real-time ingestion**: Use [Filebeat](https://www.elastic.co/beats/filebeat) or
  [Elastic Agent](https://www.elastic.co/guide/en/fleet/current/fleet-overview.html)
- **Enterprise pipelines**: Use [Logstash](https://www.elastic.co/products/logstash)
- **Built-in transforms**: Use
  [Elasticsearch Transforms](https://www.elastic.co/guide/en/elasticsearch/reference/current/transforms.html)

## Additional Resources

- [Common Patterns](references/patterns.md) - Detailed examples for CSV loading, migrations, filtering, and more
- [Troubleshooting](references/troubleshooting.md) - Solutions for common issues

## References

- [Elasticsearch Mappings](https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html)
- [Elasticsearch Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html)
