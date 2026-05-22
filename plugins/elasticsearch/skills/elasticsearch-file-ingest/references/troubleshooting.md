# Troubleshooting

Common issues and solutions for the ingest tool.

## Connection Refused

Elasticsearch is not running or the URL is incorrect. Run the connection test:

```bash
node scripts/ingest.js test
```

If the test fails, ask the user to verify their Elasticsearch environment configuration.

## Out of Memory Errors

Reduce buffer size:

```bash
node scripts/ingest.js ingest --file data.json --target my-index --buffer-size 2048
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
node scripts/ingest.js ingest \
  --file data.json \
  --target my-index \
  --mappings mappings.json \
  --delete-index
```

## Slow Ingestion

Check these common causes:

1. **Large documents**: Reduce `--buffer-size`
2. **Complex transforms**: Simplify transform logic
3. **Elasticsearch load**: Check cluster health and indexing queue

## Stall Warnings

If you see stall warnings, the ingestion is pausing due to backpressure:

```bash
# Increase stall warning threshold
node scripts/ingest.js ingest \
  --file data.json \
  --target my-index \
  --stall-warn-seconds 60

# Debug pause/resume events
node scripts/ingest.js ingest \
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

node scripts/ingest.js ingest \
  --file data.csv \
  --source-format csv \
  --csv-options csv-options.json \
  --target my-index
```

## Authentication Errors

Run the built-in connection test to verify credentials and connectivity:

```bash
node scripts/ingest.js test
```

If the test fails, ask the user to verify their Elasticsearch credentials and environment configuration.
