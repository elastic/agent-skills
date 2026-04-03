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
node scripts/ingest.js ingest \
  --file events.csv \
  --target events \
  --mappings mappings.json \
  --skip-header
```

## Pattern 2: Batch Ingest Multiple Files

```bash
# Ingest all JSON files in a directory
node scripts/ingest.js ingest \
  --file "logs/*.json" \
  --target combined-logs \
  --mappings mappings.json
```

## Pattern 3: Document Enrichment During Ingestion

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
node scripts/ingest.js ingest \
  --file data.json \
  --target enriched-data \
  --transform enrich.js
```

## Pattern 4: Performance Tuning

### For Large Files (>5GB)

```bash
# Increase buffer size for better throughput
node scripts/ingest.js ingest \
  --file huge-file.json \
  --target my-index \
  --buffer-size 10240  # 10 MB buffer
```

### Quiet Mode (for scripts)

```bash
# Disable progress bars for automated scripts
node scripts/ingest.js ingest \
  --file data.json \
  --target my-index \
  --quiet
```
