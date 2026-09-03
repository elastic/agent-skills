/**
 * Lightweight HTTP client for the Kibana REST API.
 * Uses native fetch() with auth, retry on 429, and space support.
 */

try {
  process.loadEnvFile();
} catch {}

const RETRY_DELAYS = [5, 10, 20];

export function getKibanaConfig() {
  const url = process.env.KIBANA_URL;
  const apiKey = process.env.KIBANA_API_KEY;
  const username = process.env.KIBANA_USERNAME || process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.KIBANA_PASSWORD || process.env.ELASTICSEARCH_PASSWORD;
  const spaceId = process.env.KIBANA_SPACE_ID;
  const insecure = process.env.KIBANA_INSECURE === "true";

  if (!url) {
    console.error("Error: No Kibana connection configured.");
    console.error("Set KIBANA_URL environment variable.");
    process.exit(1);
  }

  if (!apiKey && !username && !password && process.env.KIBANA_NO_AUTH !== "true") {
    console.error("Error: No Kibana authentication configured.");
    console.error("Set KIBANA_API_KEY or KIBANA_USERNAME + KIBANA_PASSWORD.");
    console.error("Or set KIBANA_NO_AUTH=true for clusters with security disabled.");
    process.exit(1);
  }

  if (!apiKey && ((username && !password) || (!username && password))) {
    console.error("Error: Both username and password must be set for basic auth.");
    console.error("Set KIBANA_USERNAME + KIBANA_PASSWORD (or ELASTICSEARCH_USERNAME + ELASTICSEARCH_PASSWORD).");
    process.exit(1);
  }

  return { url, apiKey, username, password, spaceId, insecure };
}

function getHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    "kbn-xsrf": "true",
    "User-Agent": "elastic-agentic",
  };

  if (config.apiKey) {
    headers["Authorization"] = `ApiKey ${config.apiKey}`;
  } else if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }

  return headers;
}

function getBasePath(config, space) {
  let basePath = config.url.replace(/\/$/, "");
  const effectiveSpace = space || config.spaceId;
  if (effectiveSpace && effectiveSpace !== "default") {
    basePath += `/s/${effectiveSpace}`;
  }
  return basePath;
}

/**
 * Make an HTTP request to the Kibana API with automatic 429 retry.
 *
 * @param {string} path - API path (e.g. "/api/cases")
 * @param {object} [options] - fetch options (method, body, headers, params)
 * @param {string} [options.space] - Override Kibana space for this request
 * @returns {{ success: boolean, data?: any, status?: number, error?: string }}
 */
export async function kibanaFetch(path, options = {}) {
  const config = getKibanaConfig();
  const { space, params, ...fetchOpts } = options;
  const basePath = getBasePath(config, space);

  let url = `${basePath}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const v of value) searchParams.append(key, v);
        } else {
          searchParams.append(key, String(value));
        }
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const requestOptions = {
    ...fetchOpts,
    headers: {
      ...getHeaders(config),
      ...fetchOpts.headers,
    },
  };

  if (config.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(url, requestOptions);

      if (response.status === 429 && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        console.error(`Rate limited, retrying in ${delay}s (attempt ${attempt + 1}/${RETRY_DELAYS.length + 1})...`);
        await new Promise((r) => setTimeout(r, delay * 1000));
        continue;
      }

      const contentType = response.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: data?.message || data?.error || `HTTP ${response.status}`,
          details: data,
        };
      }

      return { success: true, data };
    } catch (error) {
      if (attempt < RETRY_DELAYS.length && error.message?.includes("429")) {
        const delay = RETRY_DELAYS[attempt];
        console.error(`Rate limited, retrying in ${delay}s...`);
        await new Promise((r) => setTimeout(r, delay * 1000));
        continue;
      }
      return { success: false, error: error.message, details: error };
    }
  }
}

/**
 * Convenience wrappers matching the Python KibanaClient interface.
 * These throw on HTTP errors (matching the old behavior where scripts
 * relied on exceptions for error handling).
 */
export async function kibanaGet(path, params, space) {
  const result = await kibanaFetch(path, { method: "GET", params, space });
  if (!result.success) throw new Error(result.error || `HTTP ${result.status}`);
  return result.data;
}

export async function kibanaPost(path, body, space) {
  const result = await kibanaFetch(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    space,
  });
  if (!result.success) throw new Error(result.error || `HTTP ${result.status}`);
  return result.data;
}

export async function kibanaPatch(path, body, space) {
  const result = await kibanaFetch(path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    space,
  });
  if (!result.success) throw new Error(result.error || `HTTP ${result.status}`);
  return result.data;
}

export async function kibanaPut(path, body, space) {
  const result = await kibanaFetch(path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    space,
  });
  if (!result.success) throw new Error(result.error || `HTTP ${result.status}`);
  return result.data;
}

export async function kibanaDelete(path, space) {
  const result = await kibanaFetch(path, { method: "DELETE", space });
  if (!result.success) throw new Error(result.error || `HTTP ${result.status}`);
  return result.data;
}

export async function testConnection(space) {
  try {
    const status = await kibanaGet("/api/status", undefined, space);
    const version = status?.version;
    const versionStr = typeof version === "object" ? version?.number : version;
    console.log(`Connected to Kibana: ${status?.name || "unknown"}`);
    console.log(`Version: ${versionStr || "unknown"}`);
    return true;
  } catch (error) {
    console.error(`Connection failed: ${error.message}`);
    return false;
  }
}
