/**
 * Elasticsearch client factory for SOC skills.
 * Supports Cloud ID, direct URL, API key, and basic auth.
 */

import { Client } from "@elastic/elasticsearch";

try {
  process.loadEnvFile();
} catch {}

/**
 * Create and return an Elasticsearch client using environment variables.
 */
export function createClient() {
  const cloudId = process.env.ELASTICSEARCH_CLOUD_ID;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const url = process.env.ELASTICSEARCH_URL;
  const username = process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.ELASTICSEARCH_PASSWORD;
  const insecure = process.env.ELASTICSEARCH_INSECURE === "true";

  const config = {};

  if (cloudId) {
    config.cloud = { id: cloudId };
  } else if (url) {
    config.node = url;
  } else {
    console.error("Error: No Elasticsearch connection configured.");
    console.error("Set ELASTICSEARCH_CLOUD_ID or ELASTICSEARCH_URL environment variable.");
    process.exit(1);
  }

  if (apiKey) {
    config.auth = { apiKey };
  } else if (username && password) {
    config.auth = { username, password };
  } else if (username || password) {
    console.error("Error: Both ELASTICSEARCH_USERNAME and ELASTICSEARCH_PASSWORD must be set for basic auth.");
    process.exit(1);
  }

  if (insecure) {
    config.tls = { rejectUnauthorized: false };
  }

  config.headers = { "User-Agent": "elastic-agentic" };

  return new Client(config);
}

export async function testConnection() {
  try {
    const client = createClient();
    const info = await client.info();
    console.log(`Connected to Elasticsearch cluster: ${info.cluster_name}`);
    console.log(`Version: ${info.version.number}`);
    await client.close();
    return true;
  } catch (error) {
    console.error(`Connection failed: ${error.message}`);
    return false;
  }
}
