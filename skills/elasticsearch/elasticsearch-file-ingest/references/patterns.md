# Common Ingestion Patterns

Detailed examples for common data ingestion scenarios.

## Pattern 1: Load CSV with Custom Mappings

```bash
# 1. Create mappings.json with your schema
cat > mappings.json << 'EOF'
{
  "properties": {
    "timestamp": { "type": "date" },
    "user_id": { "type": "keyword" },
    "action": { "type": "keyword" },
    "value": { "type": "double" }
  }
}
EOF

# 2. Ingest CSV (skip header row)
{baseDir}/scripts/ingest.js \
  --file events.csv \
  --target events \
  --mappings mappings.json \
  --skip-header
```

## Pattern 2: Migrate ES 8.x → 9.x with Transforms

```bash
# 1. Create transform.js to update document structure
cat > transform.js << 'EOF'
export default function transform(doc) {
  // Update field names for ES 9.x compatibility
  return {
    ...doc,
    '@timestamp': doc.timestamp,  // Rename field
    user: {
      id: doc.user_id,
      name: doc.user_name,
    },
  };
}
EOF

# 2. Migrate with transform
{baseDir}/scripts/ingest.js \
  --source-index logs \
  --node https://es8-cluster.example.com:9200 \
  --api-key $ES8_API_KEY \
  --target logs-v2 \
  --target-node https://es9-cluster.example.com:9200 \
  --target-api-key $ES9_API_KEY \
  --transform transform.js
```

## Pattern 3: Reindex with Filtering and Deletion

```bash
# 1. Create filter query
cat > filter.json << 'EOF'
{
  "bool": {
    "must": [
      { "range": { "@timestamp": { "gte": "now-30d" } } }
    ],
    "must_not": [
      { "term": { "status": "deleted" } }
    ]
  }
}
EOF

# 2. Reindex with filter (delete old index first)
{baseDir}/scripts/ingest.js \
  --source-index logs-raw \
  --target logs-filtered \
  --query filter.json \
  --delete-index
```

## Pattern 4: Batch Ingest Multiple Files

```bash
# Ingest all JSON files in a directory
{baseDir}/scripts/ingest.js \
  --file "logs/*.json" \
  --target combined-logs \
  --mappings mappings.json
```

## Pattern 5: Document Enrichment During Ingestion

```bash
# 1. Create enrichment transform
cat > enrich.js << 'EOF'
export default function transform(doc) {
  return {
    ...doc,
    enriched_at: new Date().toISOString(),
    source: 'batch-import',
    year: new Date(doc.timestamp).getFullYear(),
  };
}
EOF

# 2. Ingest with enrichment
{baseDir}/scripts/ingest.js \
  --file data.json \
  --target enriched-data \
  --transform enrich.js
```

## Pattern 6: Performance Tuning

### For Large Files (>5GB)

```bash
# Increase buffer size for better throughput
{baseDir}/scripts/ingest.js \
  --file huge-file.json \
  --target my-index \
  --buffer-size 10240  # 10 MB buffer
```

### For Slow Networks

```bash
# Reduce batch size to avoid timeouts
{baseDir}/scripts/ingest.js \
  --source-index remote-logs \
  --target local-logs \
  --search-size 50  # Smaller batches
```

### Quiet Mode (for scripts)

```bash
# Disable progress bars for automated scripts
{baseDir}/scripts/ingest.js \
  --file data.json \
  --target my-index \
  --quiet
```
