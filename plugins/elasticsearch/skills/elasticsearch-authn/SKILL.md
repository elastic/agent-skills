---
name: elasticsearch-authn
description: >
  Authenticate to Elasticsearch using native, file-based, LDAP/AD, SAML, OIDC, Kerberos,
  JWT, or certificate realms. Use when connecting with credentials, choosing a realm,
  or managing API keys. Assumes the target realms are already configured.
compatibility: >
  Requires curl or an HTTP client and network access to the target Elasticsearch cluster
  endpoint. Environment variables: ELASTICSEARCH_URL (required), plus one of ELASTICSEARCH_API_KEY,
  ELASTICSEARCH_USERNAME/ELASTICSEARCH_PASSWORD, or realm-specific credentials depending
  on the authentication method.
metadata:
  author: elastic
  version: 0.1.0
---

# Elasticsearch Authentication

Authenticate to an Elasticsearch cluster using any supported authentication realm that is already configured. This skill
covers all built-in realms, credential verification, and the full API key lifecycle.

For roles, users, role assignment, and role mappings, see the **elasticsearch-authz** skill.

For detailed API endpoints, see [references/api-reference.md](references/api-reference.md).

> **Deployment note:** Not all realms are available on every deployment type. See
> [Deployment Compatibility](#deployment-compatibility) for self-managed vs. ECH vs. Serverless details.

## Critical principles

- **Never ask for credentials in chat.** Do not ask the user to paste passwords, API keys, tokens, or any secret into
  the conversation. Secrets must not appear in conversation history.
- **Always use environment variables.** All code examples in this skill reference environment variables (e.g.
  `ELASTICSEARCH_PASSWORD`, `ELASTICSEARCH_API_KEY`). When a required variable is missing, instruct the user to set it
  in a `.env` file in the project root — never prompt for the value directly.
- **Prefer `.env` over terminal exports.** Agents may run commands in a sandboxed shell session that does not inherit
  the user's terminal environment. A `.env` file in the working directory is reliable across all execution contexts.
  Only suggest `export` as a fallback when the user explicitly prefers it.

## Jobs to Be Done

- Authenticate to a cluster using username and password (native realm)
- Connect using an API key (bearer token)
- Verify who is currently authenticated (`_authenticate`)
- Choose the right authentication realm for a deployment
- Create an API key with scoped privileges for automation or service access
- Rotate or invalidate an existing API key
- Set up service account tokens for Elastic stack components
- Authenticate with PKI / mutual TLS certificate-based authentication after PKI/TLS setup
- Authenticate with configured external identity providers (SAML, OIDC, LDAP, AD, Kerberos)
- Grant API keys on behalf of other users

## Prerequisites

| Item                  | Description                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Elasticsearch URL** | Cluster endpoint (e.g. `https://localhost:9200` or a Cloud deployment URL)                                                  |
| **Credentials**       | Depends on the realm — see the methods below                                                                                |
| **Realms configured** | Authentication realms and their identity backends must already be configured (realm chain, IdP, LDAP/AD, Kerberos, PKI/TLS) |

If any required value is missing, instruct the user to add it to a `.env` file in the project root. Terminal exports may
not be visible to agents running in a separate shell session — the `.env` file is the reliable default. **Never ask the
user to paste credentials into the chat** — secrets must not appear in conversation history.

## Authentication Realms

Elasticsearch evaluates realms in a configured order (the **realm chain**). The first realm that can authenticate the
request wins. Internal realms are managed by Elasticsearch; external realms delegate to enterprise identity systems.

### Internal realms

#### Native (username and password)

Users stored in a dedicated Elasticsearch index. Simplest method for interactive use. Managed via Kibana or the user
management APIs (see the elasticsearch-authz skill).

```bash
curl -u "${ELASTICSEARCH_USERNAME}:${ELASTICSEARCH_PASSWORD}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

#### File

Users defined in flat files on each cluster node (`elasticsearch-users` CLI). Always active regardless of license state,
making it the fallback for disaster recovery when paid realms are disabled. Only available on self-managed deployments.

```bash
curl -u "${FILE_USER}:${FILE_PASSWORD}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

### External realms

#### LDAP

Authenticates against an external LDAP directory using username and password. Self-managed only — not available on ECH
or Serverless. Typically combined with role mappings to translate LDAP groups to Elasticsearch roles.

```bash
curl -u "${LDAP_USER}:${LDAP_PASSWORD}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

The request is identical to native — Elasticsearch routes it to the LDAP realm via the realm chain.

#### Active Directory

Authenticates against an Active Directory domain. Self-managed only — not available on ECH or Serverless. Similar to
LDAP but uses AD-specific defaults (user principal name, `sAMAccountName`). Typically combined with role mappings for AD
group-to-role translation.

```bash
curl -u "${AD_USER}:${AD_PASSWORD}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

#### PKI (TLS client certificates)

Authenticates using X.509 client certificates presented during the TLS handshake. Requires a PKI realm and TLS on the
HTTP layer. On ECH, PKI support is limited — check deployment settings. Not available on Serverless. Best for
service-to-service communication in mutual TLS environments.

```bash
curl --cert "${CLIENT_CERT}" --key "${CLIENT_KEY}" --cacert "${CA_CERT}" \
  "${ELASTICSEARCH_URL}/_security/_authenticate"
```

#### SAML

Enables SAML 2.0 Web Browser SSO, primarily for Kibana authentication. On self-managed, configure in
`elasticsearch.yml`. On ECH, configure through the Cloud deployment settings UI. On Serverless, SAML is handled at the
organization level and not configurable per project. Not usable by standard REST clients — the browser-based redirect
flow is handled by Kibana. Configure another realm (e.g. native or API keys) alongside SAML for programmatic API access.

#### OIDC (OpenID Connect)

Enables OpenID Connect SSO, primarily for Kibana authentication. On self-managed, configure in `elasticsearch.yml`. On
ECH, configure through the Cloud deployment settings UI. Not available on Serverless. Like SAML, it relies on browser
redirects and is not suited for direct REST client use. For programmatic access alongside OIDC, use API keys or native
users.

Custom applications can exchange OIDC tokens for Elasticsearch access tokens via `POST /_security/oidc/authenticate`,
but this requires implementing the full OIDC redirect flow.

#### JWT (JSON Web Tokens)

Accepts JWTs issued by an external identity provider as bearer tokens. On self-managed, configure in
`elasticsearch.yml`. On ECH, configure through the Cloud deployment settings UI. Not available on Serverless. Supports
two token types:

- **`id_token`** (default) — OpenID Connect ID tokens for user-on-behalf-of flows.
- **`access_token`** — OAuth2 client credentials for application identity flows.

```bash
curl -H "Authorization: Bearer ${JWT_TOKEN}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Each JWT realm handles one token type. Configure separate realms for `id_token` and `access_token` if both are needed.

#### Kerberos

Authenticates using Kerberos tickets via the SPNEGO mechanism. Self-managed only — not available on ECH or Serverless.
Requires a working KDC infrastructure, proper DNS, and time synchronization.

```bash
kinit "${KERBEROS_PRINCIPAL}"
curl --negotiate -u : "${ELASTICSEARCH_URL}/_security/_authenticate"
```

The `--negotiate` flag enables SPNEGO. The `-u :` is required by curl but the username is ignored — the principal from
`kinit` is used. Requires curl 7.49+ with GSS-API/SPNEGO support.

### API keys

Not a realm, but a distinct authentication mechanism. Pass a Base64-encoded API key in the `Authorization` header.
Preferred for programmatic and automated access.

```bash
curl -H "Authorization: ApiKey ${ELASTICSEARCH_API_KEY}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

`ELASTICSEARCH_API_KEY` is the `encoded` value (Base64 of `id:api_key`) returned when the key was created.

### Verify authentication

Always verify credentials before proceeding:

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Check `username`, `roles`, and `authentication_realm.type` to confirm identity and method:

| `authentication_realm.type` | Realm            |
| --------------------------- | ---------------- |
| `native`                    | Native           |
| `file`                      | File             |
| `ldap`                      | LDAP             |
| `active_directory`          | Active Directory |
| `pki`                       | PKI              |
| `saml`                      | SAML             |
| `oidc`                      | OpenID Connect   |
| `jwt`                       | JWT              |
| `kerberos`                  | Kerberos         |

For API keys, `authentication_type` is `"api_key"` (not a realm type).

## Manage API Keys

### Create an API key

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/api_key" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${KEY_NAME}"'",
    "expiration": "30d",
    "role_descriptors": {
      "'"${ROLE_NAME}"'": {
        "cluster": [],
        "indices": [
          {
            "names": ["'"${INDEX_PATTERN}"'"],
            "privileges": ["read"]
          }
        ]
      }
    }
  }'
```

The response contains `id`, `api_key`, and `encoded`. Store `encoded` securely — it cannot be retrieved again.

Omit `role_descriptors` to inherit a snapshot of the authenticated user's current privileges.

> **Limitation:** An API key **cannot** create another API key with privileges. The derived key is created with no
> effective access. Use `POST /_security/api_key/grant` with user credentials instead.

### Get and invalidate API keys

```bash
curl "${ELASTICSEARCH_URL}/_security/api_key?name=${KEY_NAME}" <auth_flags>
curl -X DELETE "${ELASTICSEARCH_URL}/_security/api_key" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{"name": "'"${KEY_NAME}"'"}'
```

## Examples

### Create a scoped API key

**Request:** "Create an API key that can only read from `metrics-*`."

```json
POST /_security/api_key
{
  "name": "metrics-reader-key",
  "expiration": "90d",
  "role_descriptors": {
    "metrics-reader": {
      "indices": [
        {
          "names": ["metrics-*"],
          "privileges": ["read", "view_index_metadata"]
        }
      ]
    }
  }
}
```

### Verify which realm authenticated the user

```json
GET /_security/_authenticate
```

```json
{
  "username": "joe",
  "authentication_realm": { "name": "ldap1", "type": "ldap" },
  "authentication_type": "realm"
}
```

### Authenticate with a JWT bearer token

```bash
curl -H "Authorization: Bearer ${JWT_TOKEN}" "https://my-cluster:9200/_security/_authenticate"
```

Confirm the response shows `authentication_realm.type` as `"jwt"`.

## Guidelines

### Choosing an authentication method

| Method          | Best for                                    | Trade-offs                                      |
| --------------- | ------------------------------------------- | ----------------------------------------------- |
| Native user     | Interactive use, simple setups              | Password must be stored or prompted             |
| File user       | Disaster recovery, bootstrap                | Must be configured on every node                |
| API key         | Programmatic access, CI/CD, scoped access   | Cannot be retrieved after creation              |
| LDAP / AD       | Enterprise directory integration            | Requires network access to directory server     |
| PKI certificate | Service-to-service, mutual TLS environments | Requires PKI infrastructure and PKI realm       |
| SAML            | Kibana SSO via enterprise IdP               | Browser-only; not for REST clients              |
| OIDC            | Kibana SSO via OpenID Connect provider      | Browser-only; not for REST clients              |
| JWT             | Token-based service and user authentication | Requires external token issuer and realm config |
| Kerberos        | Windows/enterprise Kerberos environments    | Requires KDC, DNS, time sync infrastructure     |

Prefer API keys for automated workflows — they support fine-grained scoping and independent expiration. For Kibana SSO,
use SAML or OIDC. For enterprise directory integration, use LDAP or AD with role mappings (see elasticsearch-authz).

### Avoid superuser credentials

Never use the built-in `elastic` superuser or any `superuser`-role account for day-to-day operations, automation, or
application access. Instead, create a dedicated user or API key with only the privileges the task requires. The
`elastic` user should be reserved for initial cluster setup and emergency recovery only.

### Security

- An API key **cannot** create another API key with privileges. Use user credentials or `POST /_security/api_key/grant`
  for programmatic key creation.
- Always set `expiration` on API keys. Avoid indefinite keys in production.
- Scope API keys via `role_descriptors`. Never create unscoped keys for automated systems.
- Never receive, echo, or log passwords, API keys, tokens, or any credentials in the chat. Instruct the user to manage
  secrets in their terminal, environment variables, or files directly.
- Never store secrets in code, scripts, or version control. Load from environment variables.
- Use `GET /_security/_authenticate` to verify credentials before running management operations.
- When generating passwords for native users, use at least 16 characters mixing uppercase, lowercase, digits, and
  symbols. Never use placeholder values like `changeme` or `password123`.
- SAML and OIDC are for browser-based SSO only. Always configure a companion realm (native, file, or API keys) for REST
  API access alongside them.

## Deployment Compatibility

Not all authentication realms are available on every deployment type. **Self-managed** clusters support all realms.
**Elastic Cloud Hosted (ECH)** is managed by Elastic with no node-level access. **Serverless** is fully managed SaaS.

| Realm            | Self-managed | ECH                     | Serverless         |
| ---------------- | ------------ | ----------------------- | ------------------ |
| Native           | Yes          | Yes                     | Not available      |
| File             | Yes          | Not available           | Not available      |
| LDAP             | Yes          | Not available           | Not available      |
| Active Directory | Yes          | Not available           | Not available      |
| PKI              | Yes          | Limited                 | Not available      |
| SAML             | Yes          | Yes (deployment config) | Organization-level |
| OIDC             | Yes          | Yes (deployment config) | Not available      |
| JWT              | Yes          | Yes (deployment config) | Not available      |
| Kerberos         | Yes          | Not available           | Not available      |
| API keys         | Yes          | Yes                     | Yes                |

**ECH notes:**

- No node access, so the file realm and `elasticsearch-users` CLI are not available.
- LDAP, Active Directory, and Kerberos cannot be configured on ECH.
- SAML, OIDC, and JWT are configurable via the Cloud deployment settings UI.
- The `elastic` superuser is available but should still be avoided for routine use.

**Serverless notes:**

- API keys are the primary authentication method.
- Native users do not exist — users are managed at the Elastic Cloud organization level.
- SAML SSO is configured at the organization level, not per project.
