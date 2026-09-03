# Elasticsearch Authentication API Reference

Quick reference for authentication realms and API key APIs. For full documentation, see the linked Elastic docs.

## Authentication Realms

| Realm            | Type               | Auth mechanism           | Category |
| ---------------- | ------------------ | ------------------------ | -------- |
| Native           | `native`           | Username / password      | Internal |
| File             | `file`             | Username / password      | Internal |
| LDAP             | `ldap`             | Username / password      | External |
| Active Directory | `active_directory` | Username / password      | External |
| PKI              | `pki`              | X.509 client certificate | External |
| SAML             | `saml`             | Browser SSO redirect     | External |
| OpenID Connect   | `oidc`             | Browser SSO redirect     | External |
| JWT              | `jwt`              | Bearer token             | External |
| Kerberos         | `kerberos`         | SPNEGO / Negotiate       | External |

Internal realms: maximum one per type, managed by Elasticsearch. External realms: multiple allowed, delegated to
identity systems.

[Full documentation](https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/authentication-realms)

## Authenticate

```text
GET /_security/_authenticate
```

Verify credentials and retrieve the authenticated user's identity and realm.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-authenticate)

### Response fields

| Field                       | Type   | Description                                               |
| --------------------------- | ------ | --------------------------------------------------------- |
| `username`                  | string | Authenticated user's name                                 |
| `roles`                     | array  | Assigned roles                                            |
| `enabled`                   | bool   | Whether the user is active                                |
| `authentication_realm.name` | string | Name of the realm that authenticated the user             |
| `authentication_realm.type` | string | Realm type: `native`, `file`, `pki`, `ldap`, `saml`, etc. |
| `authentication_type`       | string | `realm`, `api_key`, `token`, or `anonymous`               |

## API Keys — Create

```text
POST /_security/api_key
```

Create an API key for authentication.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-create-api-key)

### Required privileges

`manage_own_api_key` or `manage_api_key` cluster privilege.

### Request body

```json
{
  "name": "my-api-key",
  "expiration": "30d",
  "role_descriptors": {
    "role-name": {
      "cluster": [],
      "indices": [{ "names": ["index-*"], "privileges": ["read"] }]
    }
  },
  "metadata": {}
}
```

| Field              | Type   | Description                                                                  |
| ------------------ | ------ | ---------------------------------------------------------------------------- |
| `name`             | string | Key name (required)                                                          |
| `expiration`       | string | Duration until expiry (e.g. `30d`, `1h`); omit for no expiration             |
| `role_descriptors` | object | Scoped privileges; omit to inherit the authenticated user's full permissions |
| `metadata`         | object | Arbitrary metadata                                                           |

### Response

| Field     | Type   | Description                                              |
| --------- | ------ | -------------------------------------------------------- |
| `id`      | string | Key ID                                                   |
| `name`    | string | Key name                                                 |
| `api_key` | string | Secret key value                                         |
| `encoded` | string | Base64 of `id:api_key`, ready for `Authorization` header |

### Limitation: derived keys

An API key **cannot** create another API key with privileges. The derived key has no effective access. Use the Grant API
below instead.

## API Keys — Get

```text
GET /_security/api_key
```

Retrieve API key information. Filter by `id`, `name`, `username`, or `realm_name` query parameters.

## API Keys — Invalidate

```text
DELETE /_security/api_key
```

Invalidate one or more API keys.

### Request body

```json
{ "name": "my-api-key" }
```

Other filter fields: `id`, `ids`, `username`, `realm_name`, `owner` (boolean).

## API Keys — Grant

```text
POST /_security/api_key/grant
```

Create an API key on behalf of another user, bypassing the derived-key limitation.

### Required privileges

`grant_api_key` or `manage_api_key` cluster privilege.

### Request body

```json
{
  "grant_type": "password",
  "username": "target-user",
  "password": "user-password",
  "api_key": {
    "name": "granted-key",
    "expiration": "30d",
    "role_descriptors": {}
  }
}
```

| Field        | Type   | Description                                                       |
| ------------ | ------ | ----------------------------------------------------------------- |
| `grant_type` | string | `"password"` (user credentials) or `"access_token"` (OAuth token) |
| `username`   | string | Target user (required for `password` grant type)                  |
| `password`   | string | Target user's password (required for `password` grant type)       |
| `api_key`    | object | API key definition (same fields as the standard create API)       |

## OIDC — Authenticate (token exchange)

```text
POST /_security/oidc/authenticate
```

Exchange a successful OIDC redirect response for Elasticsearch access and refresh tokens. Used by custom applications
that implement the OIDC redirect flow outside of Kibana.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-oidc-authenticate)

### Request body

```json
{
  "redirect_uri": "https://app.example.com/callback?code=abc&state=xyz",
  "state": "xyz",
  "nonce": "nonce-value",
  "realm": "oidc1"
}
```

| Field          | Type   | Description                                              |
| -------------- | ------ | -------------------------------------------------------- |
| `redirect_uri` | string | The full callback URL the OIDC provider redirected to    |
| `state`        | string | State value from the original authentication request     |
| `nonce`        | string | Nonce for replay-attack mitigation                       |
| `realm`        | string | OIDC realm name (optional if only one OIDC realm exists) |
