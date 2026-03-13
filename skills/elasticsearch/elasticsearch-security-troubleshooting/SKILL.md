---
name: elasticsearch-security-troubleshooting
description: >
  Diagnose and resolve Elasticsearch security errors: 401/403 failures, TLS problems,
  expired API keys, role mapping mismatches, and Kibana login issues. Use when the
  user reports a security error.
metadata:
  author: elastic
  version: 0.1.0
---

# Elasticsearch Security Troubleshooting

Diagnose and resolve common Elasticsearch security issues. This skill provides a structured triage workflow for
authentication failures, authorization errors, TLS problems, API key issues, role mapping mismatches, Kibana login
failures, and license-expiry lockouts.

For authentication methods and API key management, see the **elasticsearch-authn** skill. For roles, users, and role
mappings, see the **elasticsearch-authz** skill. For license management, see the **elasticsearch-license** skill.

For diagnostic API endpoints, see [references/api-reference.md](references/api-reference.md).

> **Deployment note:** Diagnostic API availability differs between self-managed, ECH, and Serverless. See
> [Deployment Compatibility](#deployment-compatibility) for details.

## Jobs to Be Done

- Diagnose HTTP 401 authentication failures
- Diagnose HTTP 403 permission denied errors
- Troubleshoot TLS/SSL handshake or certificate errors
- Investigate expired or invalid API keys
- Debug role mappings that do not grant expected roles
- Fix Kibana login failures, redirect loops, or CORS errors
- Recover from a license-expiry lockout
- Determine why a user lacks access to a specific index

## Prerequisites

| Item                   | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| **Elasticsearch URL**  | Cluster endpoint (e.g. `https://localhost:9200` or a Cloud deployment URL) |
| **Authentication**     | Any valid credentials — even minimal — to reach the cluster                |
| **Cluster privileges** | `monitor` for read-only diagnostics; `manage_security` for fixes           |

Prompt the user for any missing values. If the user cannot authenticate at all, start with
[TLS and Certificate Errors](#tls-and-certificate-errors) or [License Expiry Recovery](#license-expiry-recovery).

## Diagnostic Workflow

Route the symptom to the correct section:

| Symptom                                        | Section                                                       |
| ---------------------------------------------- | ------------------------------------------------------------- |
| HTTP 401, `authentication_exception`           | [Authentication Failures](#authentication-failures-401)       |
| HTTP 403, `security_exception`, access denied  | [Authorization Failures](#authorization-failures-403)         |
| SSL/TLS handshake error, certificate rejected  | [TLS and Certificate Errors](#tls-and-certificate-errors)     |
| API key rejected, expired, or ineffective      | [API Key Issues](#api-key-issues)                             |
| Role mapping not granting expected roles       | [Role Mapping Issues](#role-mapping-issues)                   |
| Kibana login broken, redirect loop, CORS error | [Kibana Authentication Issues](#kibana-authentication-issues) |
| All users locked out, paid features disabled   | [License Expiry Recovery](#license-expiry-recovery)           |

Each section follows a **Gather - Diagnose - Resolve** pattern.

## Diagnostic Toolkit

Use these APIs at the start of any security investigation:

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Confirms identity, realm, and roles. If this fails with 401, the problem is authentication.

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_xpack"
```

Confirms whether security is enabled (`features.security.enabled`). If security is disabled, all security APIs return
errors.

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/user/_has_privileges" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "index": [
      { "names": ["'"${INDEX_PATTERN}"'"], "privileges": ["read"] }
    ]
  }'
```

Tests whether the authenticated user holds specific privileges without requiring `manage_security`.

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_license"
```

Check license type and status. An expired paid license disables paid realms and features.

## Authentication Failures (401)

A 401 response means Elasticsearch could not verify the caller's identity.

### Gather

```bash
curl -v <auth_flags> "${ELASTICSEARCH_URL}/_security/_authenticate" 2>&1
```

The `-v` flag shows headers and the response body. Look for:

- `WWW-Authenticate` header — indicates which auth schemes the cluster accepts.
- `authentication_exception` in the response body — the `reason` field describes what failed.

### Diagnose

| Symptom                                            | Likely cause                                    |
| -------------------------------------------------- | ----------------------------------------------- |
| `unable to authenticate user`                      | Wrong username or password                      |
| `unable to authenticate with provided credentials` | Credentials do not match any realm in the chain |
| `user is not enabled`                              | The native user account is disabled             |
| `token is expired`                                 | API key or bearer token has expired             |
| No `WWW-Authenticate` header                       | Security may be disabled; check `GET /_xpack`   |

If the user authenticates via an external realm (LDAP, AD, SAML, OIDC), the realm chain order matters. Elasticsearch
tries realms in configured order and stops at the first match. If a higher-priority realm rejects the credentials before
the intended realm is reached, authentication fails.

### Resolve

| Cause                   | Action                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| Wrong credentials       | Verify username/password or API key value. See **elasticsearch-authn**.    |
| Disabled user           | `PUT /_security/user/{name}/_enable`. See **elasticsearch-authz**.         |
| Expired API key         | Create a new API key. See [API Key Issues](#api-key-issues).               |
| Realm chain order       | Check `elasticsearch.yml` realm order (self-managed only).                 |
| Security disabled       | Enable `xpack.security.enabled: true` in `elasticsearch.yml` and restart.  |
| Paid realm after expiry | License expired — see [License Expiry Recovery](#license-expiry-recovery). |

## Authorization Failures (403)

A 403 response means the user is authenticated but lacks the required privileges.

### Gather

Test the specific privileges the operation requires:

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/user/_has_privileges" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "index": [
      { "names": ["logs-*"], "privileges": ["read", "view_index_metadata"] }
    ],
    "cluster": ["monitor"]
  }'
```

The response contains a `has_all_requested` boolean and per-resource breakdowns.

Also check the user's effective roles:

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Inspect the `roles` array and `authentication_realm` to confirm the user is who you expect.

### Diagnose

| Symptom                                   | Likely cause                                           |
| ----------------------------------------- | ------------------------------------------------------ |
| `has_all_requested: false` for an index   | Role is missing the required index privilege           |
| `has_all_requested: false` for a cluster  | Role is missing the required cluster privilege         |
| User has fewer roles than expected        | Roles array was replaced (not merged) on last update   |
| API key returns 403 on previously allowed | API key privileges are a snapshot — role changes after |
| operation                                 | creation do not propagate to existing keys             |

### Resolve

| Cause                     | Action                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Missing index privilege   | Add the privilege to the role or create a new role. See **elasticsearch-authz**.         |
| Missing cluster privilege | Add the cluster privilege. See **elasticsearch-authz**.                                  |
| Roles replaced on update  | Fetch current roles first, then update with the full array. See **elasticsearch-authz**. |
| Stale API key privileges  | Create a new API key with updated `role_descriptors`. See **elasticsearch-authn**.       |

## TLS and Certificate Errors

TLS errors prevent the client from establishing a connection at all.

### Gather

```bash
curl -v --cacert "${CA_CERT}" "https://${ELASTICSEARCH_HOST}:9200/" 2>&1 | head -30
```

Look for:

- `SSL certificate problem: unable to get local issuer certificate` — CA not trusted.
- `SSL certificate problem: certificate has expired` — certificate past its validity date.
- `SSL: no alternative certificate subject name matches target host name` — hostname mismatch.

For deeper inspection (self-managed only):

```bash
openssl s_client -connect "${ELASTICSEARCH_HOST}:9200" -showcerts </dev/null 2>&1
```

This displays the full certificate chain, expiry dates, and subject alternative names.

### Diagnose

| Error message                                     | Likely cause                                  |
| ------------------------------------------------- | --------------------------------------------- |
| `unable to get local issuer certificate`          | Missing or wrong CA certificate               |
| `certificate has expired`                         | Server or CA certificate past expiry          |
| `no alternative certificate subject name matches` | Certificate SAN does not include the hostname |
| `self-signed certificate`                         | Self-signed cert not in the trust store       |
| `SSLHandshakeException` (Java client)             | Truststore missing the CA or wrong password   |

### Resolve

| Cause               | Action                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| Wrong CA cert       | Pass the correct CA with `--cacert` or add it to the system trust store.   |
| Expired certificate | Regenerate certificates with `elasticsearch-certutil` (self-managed).      |
| Hostname mismatch   | Regenerate the certificate with the correct SAN entries.                   |
| Self-signed cert    | Distribute the CA cert to all clients or use a publicly trusted CA.        |
| Quick workaround    | Use `curl -k` / `--insecure` to skip verification. **Not for production.** |

On ECH, TLS is managed by Elastic — certificate errors usually indicate the client is not using the correct Cloud
endpoint URL. On Serverless, TLS is fully managed and transparent.

## API Key Issues

### Gather

Retrieve the key's metadata:

```bash
curl "${ELASTICSEARCH_URL}/_security/api_key?name=${KEY_NAME}" <auth_flags>
```

Check `expiration`, `invalidated`, and `role_descriptors` in the response.

### Diagnose

| Symptom                                   | Likely cause                                                     |
| ----------------------------------------- | ---------------------------------------------------------------- |
| 401 when using the key                    | Key expired or invalidated                                       |
| 403 on operations that should be allowed  | Key was created with insufficient `role_descriptors`             |
| Derived key has no access                 | API key created another API key — derived keys have no privilege |
| Key works for some indices but not others | `role_descriptors` scope is too narrow                           |

### Resolve

| Cause               | Action                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Expired key         | Create a new key with appropriate `expiration`. See **elasticsearch-authn**.                    |
| Invalidated key     | Create a new key. Invalidated keys cannot be reinstated.                                        |
| Wrong scope         | Create a new key with correct `role_descriptors`. See **elasticsearch-authn**.                  |
| Derived key problem | Use `POST /_security/api_key/grant` with user credentials instead. See **elasticsearch-authn**. |

## Role Mapping Issues

Role mappings grant roles to users from external realms. When they fail silently, users authenticate but get no roles.

### Gather

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Note the `username`, `authentication_realm.name`, and `roles` array.

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_security/role_mapping"
```

List all mappings and inspect their `rules` and `enabled` fields.

### Diagnose

| Symptom                                    | Likely cause                                               |
| ------------------------------------------ | ---------------------------------------------------------- |
| User has empty `roles` array               | No mapping matches the user's attributes                   |
| User gets wrong roles                      | A different mapping matched first or the rule is too broad |
| Mapping exists but does not apply          | `enabled` is `false`                                       |
| Mustache template produces wrong role name | Template syntax error or unexpected attribute value        |

Compare the user's `authentication_realm.name` and `groups` (from `_authenticate`) against each mapping's `rules` to
find the mismatch.

### Resolve

| Cause            | Action                                                                               |
| ---------------- | ------------------------------------------------------------------------------------ |
| No matching rule | Update the mapping rules to match the user's realm and attributes.                   |
| Mapping disabled | Set `"enabled": true` on the mapping.                                                |
| Template error   | Test the Mustache template with known attribute values. See **elasticsearch-authz**. |
| Rule too broad   | Add `all` / `except` conditions to narrow the match. See **elasticsearch-authz**.    |

## Kibana Authentication Issues

### Missing `kbn-xsrf` header

All mutating Kibana API requests require the `kbn-xsrf` header:

```bash
curl -X PUT "${KIBANA_URL}/api/security/role/my-role" \
  <auth_flags> \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

Without it, Kibana returns `400 Bad Request` with `"Request must contain a kbn-xsrf header"`.

### SAML/OIDC redirect loop

Common causes:

- Incorrect `xpack.security.authc.realms.saml.*.sp.acs` or `idp.metadata.path` in `elasticsearch.yml`.
- Clock skew between the IdP and Elasticsearch nodes (SAML assertions have a validity window).
- Kibana `server.publicBaseUrl` does not match the SAML ACS URL.

Verify the SAML realm configuration:

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_security/_authenticate"
```

If this returns a valid user via a non-SAML realm, the SAML realm itself is not being reached. Check realm chain order.

### Kibana cannot reach Elasticsearch

Kibana logs `Unable to retrieve version information from Elasticsearch nodes`. Verify the `elasticsearch.hosts` setting
in `kibana.yml` points to a reachable endpoint and the credentials (`elasticsearch.username` / `elasticsearch.password`
or `elasticsearch.serviceAccountToken`) are valid.

## License Expiry Recovery

When a paid license expires, the cluster enters a **security-closed** state: paid realms (SAML, LDAP, AD, PKI) stop
working and users authenticating through them are locked out. Native and file realms remain functional.

### Quick triage

```bash
curl <auth_flags> "${ELASTICSEARCH_URL}/_license"
```

If `license.status` is `"expired"`, proceed with recovery.

### Recovery steps

Follow the detailed recovery workflow in the **elasticsearch-license** skill. The critical first step depends on
deployment type:

| Deployment   | First step                                                                |
| ------------ | ------------------------------------------------------------------------- |
| Self-managed | Log in with a file-based user (`elasticsearch-users` CLI) or native user. |
| ECH          | Contact Elastic support or renew via the Cloud console.                   |
| Serverless   | Not applicable — licensing is fully managed by Elastic.                   |

## Examples

### User gets 403 when querying logs

**Symptom:** "I get a 403 when searching `logs-*`."

1. Verify identity:

```bash
curl -u "joe:${PASSWORD}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Response shows `"roles": ["viewer"]`.

1. Test privileges:

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/user/_has_privileges" \
  -u "joe:${PASSWORD}" \
  -H "Content-Type: application/json" \
  -d '{"index": [{"names": ["logs-*"], "privileges": ["read"]}]}'
```

Response: `"has_all_requested": false` — the `viewer` role does not include `read` on `logs-*`.

1. Fix: create a `logs-reader` role and assign it to Joe. See **elasticsearch-authz**.

### API key stopped working

**Symptom:** "My API key returns 401 since yesterday."

1. Check the key:

```bash
curl -u "admin:${PASSWORD}" "${ELASTICSEARCH_URL}/_security/api_key?name=my-key"
```

Response shows `"expiration": 1709251200000` — the key expired.

1. Fix: create a new API key with a suitable `expiration`. See **elasticsearch-authn**.

### SAML login redirects to error

**Symptom:** "Clicking the SSO button in Kibana redirects to an error page."

1. Check if the SAML realm is reachable by authenticating with a non-SAML method:

```bash
curl -u "elastic:${PASSWORD}" "${ELASTICSEARCH_URL}/_security/_authenticate"
```

1. Verify the IdP metadata URL is accessible from the Elasticsearch nodes (self-managed):

```bash
curl -s "${IDP_METADATA_URL}" | head -5
```

1. Check for clock skew — SAML assertions are time-sensitive. Ensure NTP is configured on all nodes.
1. Verify `server.publicBaseUrl` in `kibana.yml` matches the SAML ACS URL configured in the IdP.

### Users locked out after license expired

**Symptom:** "Nobody can log in to Kibana. We use SAML."

1. Check license:

```bash
curl -u "admin:${PASSWORD}" "${ELASTICSEARCH_URL}/_license"
```

Response shows `"status": "expired"`, `"type": "platinum"`.

1. The SAML realm is disabled because the paid license expired. Follow the recovery steps in **elasticsearch-license**:
   log in with a file-based or native user, then upload a renewed license or revert to basic.

## Guidelines

### Always start with `_authenticate`

Run `GET /_security/_authenticate` as the first diagnostic step. It reveals the user's identity, realm, roles, and
authentication type in a single call. Most issues become apparent from this response alone.

### Check the license early

Before investigating realm or privilege issues, verify the license is active with `GET /_license`. An expired paid
license disables realms and features, producing symptoms that mimic misconfiguration.

### Use `_has_privileges` before manual inspection

Instead of reading role definitions and mentally computing effective access, use `POST /_security/user/_has_privileges`
to test specific privileges directly. This is faster and accounts for role composition, DLS, and FLS.

### Avoid superuser credentials

Never use the built-in `elastic` superuser for day-to-day troubleshooting. Create a dedicated admin user or API key with
`manage_security` privileges. Reserve the `elastic` user for initial setup and emergency recovery only.

### Do not bypass TLS in production

Using `curl -k` or `--insecure` skips certificate verification and masks real TLS issues. Use it only for initial
diagnosis, then fix the underlying certificate problem.

## Deployment Compatibility

Diagnostic tool and API availability differs across deployment types.

| Tool / API                       | Self-managed | ECH           | Serverless    |
| -------------------------------- | ------------ | ------------- | ------------- |
| `_security/_authenticate`        | Yes          | Yes           | Yes           |
| `_security/user/_has_privileges` | Yes          | Yes           | Yes           |
| `_xpack`                         | Yes          | Yes           | Limited       |
| `_license`                       | Yes          | Yes (read)    | Not available |
| `_security/api_key` (GET)        | Yes          | Yes           | Yes           |
| `_security/role_mapping`         | Yes          | Yes           | Yes           |
| `elasticsearch-users` CLI        | Yes          | Not available | Not available |
| `openssl s_client` on nodes      | Yes          | Not available | Not available |
| Elasticsearch logs               | Yes          | Via Cloud UI  | Via Cloud UI  |

**ECH notes:**

- No node-level access, so the `elasticsearch-users` CLI and direct log/certificate inspection are not available.
- TLS is managed by Elastic — certificate errors typically indicate an incorrect endpoint URL.
- Use the Cloud console for log inspection and deployment configuration.

**Serverless notes:**

- Licensing APIs are not exposed. License-related lockouts do not occur.
- Native users do not exist — authentication issues are handled at the organization level.
- TLS is fully managed and transparent.
