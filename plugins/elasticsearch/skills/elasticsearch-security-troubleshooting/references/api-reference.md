# Elasticsearch Security Troubleshooting API Reference

Quick reference for diagnostic APIs used during security troubleshooting. For authentication and authorization APIs, see
the **elasticsearch-authn** and **elasticsearch-authz** API references.

## Has Privileges

```text
POST /_security/user/_has_privileges
```

Test whether the authenticated user holds specific privileges. Does not require `manage_security` — any authenticated
user can check their own privileges.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-has-privileges)

### Request body

```json
{
  "cluster": ["monitor", "manage_ingest_pipelines"],
  "index": [
    {
      "names": ["logs-*", "metrics-*"],
      "privileges": ["read", "view_index_metadata"],
      "allow_restricted_indices": false
    }
  ],
  "application": [
    {
      "application": "kibana-.kibana",
      "privileges": ["feature_discover.read"],
      "resources": ["space:default"]
    }
  ]
}
```

| Field                              | Type          | Description                                   |
| ---------------------------------- | ------------- | --------------------------------------------- |
| `cluster`                          | array[string] | Cluster privileges to test                    |
| `index`                            | array[object] | Index privilege checks                        |
| `index[].names`                    | array[string] | Index names or patterns                       |
| `index[].privileges`               | array[string] | Named index privileges to test                |
| `index[].allow_restricted_indices` | boolean       | Include restricted indices (default: `false`) |
| `application`                      | array[object] | Application privilege checks (e.g. Kibana)    |
| `application[].application`        | string        | Application name                              |
| `application[].privileges`         | array[string] | Application privileges to test                |
| `application[].resources`          | array[string] | Resources to test against                     |

### Response

```json
{
  "username": "joe",
  "has_all_requested": false,
  "cluster": {
    "monitor": true,
    "manage_ingest_pipelines": false
  },
  "index": {
    "logs-*": {
      "read": true,
      "view_index_metadata": true
    },
    "metrics-*": {
      "read": false,
      "view_index_metadata": false
    }
  },
  "application": {}
}
```

| Field               | Type    | Description                                             |
| ------------------- | ------- | ------------------------------------------------------- |
| `has_all_requested` | boolean | `true` only if every requested privilege is granted     |
| `cluster`           | object  | Per-privilege boolean for each cluster privilege tested |
| `index`             | object  | Per-index, per-privilege boolean for each index tested  |
| `application`       | object  | Per-application, per-resource, per-privilege boolean    |

## XPack Info

```text
GET /_xpack
```

Returns information about installed features and their status.

### Key response fields

| Field                         | Type    | Description                             |
| ----------------------------- | ------- | --------------------------------------- |
| `features.security.available` | boolean | Whether security is available (license) |
| `features.security.enabled`   | boolean | Whether security is currently enabled   |

If `features.security.enabled` is `false`, all `_security` APIs return errors. Enable security in `elasticsearch.yml`
with `xpack.security.enabled: true`.

## API Key — Get

```text
GET /_security/api_key
```

Retrieve API key information. Use query parameters to filter results.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-get-api-key)

### Query parameters

| Parameter    | Type    | Description                                     |
| ------------ | ------- | ----------------------------------------------- |
| `id`         | string  | Filter by API key ID                            |
| `name`       | string  | Filter by API key name (supports wildcards)     |
| `username`   | string  | Filter by the user who created the key          |
| `realm_name` | string  | Filter by the realm of the key creator          |
| `owner`      | boolean | If `true`, return only keys owned by the caller |

### Response fields

| Field              | Type    | Description                                               |
| ------------------ | ------- | --------------------------------------------------------- |
| `id`               | string  | API key ID                                                |
| `name`             | string  | API key name                                              |
| `creation`         | long    | Creation timestamp in milliseconds                        |
| `expiration`       | long    | Expiry timestamp in milliseconds; absent if no expiration |
| `invalidated`      | boolean | Whether the key has been invalidated                      |
| `username`         | string  | User who created the key                                  |
| `realm`            | string  | Realm of the user who created the key                     |
| `role_descriptors` | object  | Scoped privileges assigned to the key                     |

## TLS Diagnostics with openssl

For self-managed clusters, use `openssl s_client` to inspect the server certificate chain.

### View the certificate chain

```bash
openssl s_client -connect "${ELASTICSEARCH_HOST}:9200" -showcerts </dev/null 2>&1
```

Key output to inspect:

| Output section       | What to check                                                     |
| -------------------- | ----------------------------------------------------------------- |
| `subject`            | Certificate subject — should match the expected CN                |
| `issuer`             | CA that issued the certificate                                    |
| `Not Before / After` | Validity period — check if the certificate has expired            |
| `Verify return code` | `0 (ok)` means the chain is trusted; non-zero indicates a problem |

### Check certificate expiry

```bash
openssl s_client -connect "${ELASTICSEARCH_HOST}:9200" </dev/null 2>&1 \
  | openssl x509 -noout -dates
```

Returns `notBefore` and `notAfter` dates.

### Check subject alternative names

```bash
openssl s_client -connect "${ELASTICSEARCH_HOST}:9200" </dev/null 2>&1 \
  | openssl x509 -noout -ext subjectAltName
```

Verify that the SAN list includes the hostname or IP used to connect.

## Common Error Response Structures

### authentication_exception (401)

```json
{
  "error": {
    "root_cause": [
      {
        "type": "security_exception",
        "reason": "unable to authenticate user [joe] for REST request [/_security/_authenticate]",
        "header": {
          "WWW-Authenticate": "..."
        }
      }
    ],
    "type": "security_exception",
    "reason": "unable to authenticate user [joe] for REST request [/_security/_authenticate]"
  },
  "status": 401
}
```

The `reason` field identifies the user and the request path. The `WWW-Authenticate` header (when present) lists the
authentication schemes the cluster accepts.

### security_exception (403)

```json
{
  "error": {
    "root_cause": [
      {
        "type": "security_exception",
        "reason": "action [indices:data/read/search] is unauthorized for user [joe] with effective roles [viewer], this action is granted by the index privileges [read,all]"
      }
    ],
    "type": "security_exception",
    "reason": "action [indices:data/read/search] is unauthorized for user [joe] with effective roles [viewer], this action is granted by the index privileges [read,all]"
  },
  "status": 403
}
```

The `reason` field lists the user, their effective roles, the denied action, and which privileges would grant it. Use
this to identify the exact missing privilege.
