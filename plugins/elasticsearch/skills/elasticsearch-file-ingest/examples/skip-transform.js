/**
 * Example transform that conditionally skips documents.
 *
 * This validates documents and only indexes valid ones.
 *
 * Usage:
 *   node scripts/ingest.js ingest --file data.json --target validated --transform examples/skip-transform.js
 */

export default function transform(doc) {
  // Skip documents without required fields
  if (!doc.email || !doc.name) {
    console.warn(`Skipping document without email or name:`, doc.id);
    return null;
  }

  // Skip invalid email addresses
  if (!doc.email.includes("@")) {
    console.warn(`Skipping document with invalid email:`, doc.email);
    return null;
  }

  // Skip test data
  if (doc.email.endsWith("@test.com") || doc.email.endsWith("@example.com")) {
    return null;
  }

  // Return the document if all validations pass
  return {
    ...doc,
    validated_at: new Date().toISOString(),
  };
}
