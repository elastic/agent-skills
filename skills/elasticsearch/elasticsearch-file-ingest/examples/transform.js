/**
 * Example transform function that enriches documents during ingestion.
 *
 * Usage:
 *   ./scripts/ingest.js --file data.json --target my-index --transform examples/transform.js
 */

export default function transform(doc) {
  // Add processing metadata
  const enriched = {
    ...doc,
    processed_at: new Date().toISOString(),
    source: "batch-import",
  };

  // Combine first and last name if present
  if (doc.first_name && doc.last_name) {
    enriched.full_name = `${doc.first_name} ${doc.last_name}`;
  }

  // Extract year from timestamp if present
  if (doc.timestamp || doc["@timestamp"]) {
    const timestamp = doc.timestamp || doc["@timestamp"];
    enriched.year = new Date(timestamp).getFullYear();
  }

  // Normalize email to lowercase
  if (doc.email) {
    enriched.email = doc.email.toLowerCase();
  }

  return enriched;
}

// For CommonJS compatibility
// module.exports = transform;
