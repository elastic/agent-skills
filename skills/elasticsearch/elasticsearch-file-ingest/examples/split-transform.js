/**
 * Example transform that splits one document into multiple documents.
 *
 * This example takes a tweet and creates a separate document for each hashtag.
 *
 * Usage:
 *   ./scripts/ingest.js --file tweets.json --target hashtags --transform examples/split-transform.js
 */

export default function transform(doc) {
  // Extract hashtags from tweet text
  const hashtags = (doc.text || "").match(/#\w+/g) || [];

  // If no hashtags, skip this document
  if (hashtags.length === 0) {
    return null;
  }

  // Create one document per hashtag
  return hashtags.map((tag) => ({
    hashtag: tag.toLowerCase(),
    tweet_id: doc.id,
    user_id: doc.user_id,
    created_at: doc.created_at,
    original_text: doc.text,
  }));
}
