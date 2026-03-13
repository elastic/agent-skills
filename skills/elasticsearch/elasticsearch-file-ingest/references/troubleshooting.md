# Troubleshooting

Common issues and solutions for the ingest tool.

## Connection Refused

Elasticsearch is not running or URL is incorrect:

```bash
# Test connection
curl http://localhost:9200

# Or with auth
curl -H "Authorization: ApiKey $API_KEY" https://es.example.com:9200
```

## Out of Memory Errors

Reduce buffer size:

```bash
{baseDir}/scripts/ingest.js --file data.json --target my-index --buffer-size 2048
```

## Transform Function Not Loading

Ensure the transform file exports correctly:

```javascript
// ✓ Correct (ES modules)
export default function transform(doc) {
  /* ... */
}

// ✓ Correct (CommonJS)
module.exports = function transform(doc) {
  /* ... */
};

// ✗ Wrong
function transform(doc) {
  /* ... */
}
```

## Mapping Conflicts

Delete and recreate the index:

```bash
{baseDir}/scripts/ingest.js \
  --file data.json \
  --target my-index \
  --mappings mappings.json \
  --delete-index
```

## Slow Ingestion

Check these common causes:

1. **Network latency**: Use `--search-size 50` for smaller batches
2. **Large documents**: Reduce `--buffer-size`
3. **Complex transforms**: Simplify transform logic
4. **Elasticsearch load**: Check cluster health and indexing queue

## Stall Warnings

If you see stall warnings, the ingestion is pausing due to backpressure:

```bash
# Increase stall warning threshold
{baseDir}/scripts/ingest.js \
  --file data.json \
  --target my-index \
  --stall-warn-seconds 60

# Debug pause/resume events
{baseDir}/scripts/ingest.js \
  --file data.json \
  --target my-index \
  --debug-events
```

## CSV Parsing Issues

For CSV files with non-standard formatting:

```bash
# Create csv-options.json
cat > csv-options.json << 'EOF'
{
  "columns": true,
  "delimiter": ";",
  "trim": true,
  "skip_empty_lines": true
}
EOF

{baseDir}/scripts/ingest.js \
  --file data.csv \
  --source-format csv \
  --csv-options csv-options.json \
  --target my-index
```

## Authentication Errors

Verify credentials:

```bash
# Test API key
curl -H "Authorization: ApiKey $API_KEY" https://es.example.com:9200/_cluster/health

# Test basic auth
curl -u "username:password" https://es.example.com:9200/_cluster/health
```
