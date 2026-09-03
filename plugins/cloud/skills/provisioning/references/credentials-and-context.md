# Serverless Projects: Credentials and CLI Context

Day-2 operations run through the `elastic` CLI, which keeps connection details in **contexts** in its config file
(`~/.elasticrc.yml`) and stores secrets in the OS keychain. This replaces the older `.elastic-credentials` file the
script-based skill used.

## How project credentials flow

1. **Create or reset** returns the project's endpoints and a one-time `admin` password. Persisting them with a named
   context (`--save-as <name>`) writes the endpoints to the config file and the secret to the keychain — nothing is
   printed to stdout or chat. A standalone `--credentials-file <path>` YAML fragment (mode `0600`) is an alternative
   when a keychain is unavailable.
2. **Admin is bootstrap-only.** The `admin` user has full privileges and cannot be modified in serverless. Use its
   password exactly once to mint a scoped Elasticsearch API key (`POST /_security/api_key`), then rely on that key.
3. **Select the project** for data-plane work by activating its context (or passing `--use-context <name>`), so bare
   Elasticsearch shorthand (`GET /_security/_authenticate`, `POST /_security/api_key`) targets the right endpoint.

## Serverless projects API endpoints

| Method   | Path                                                         | Description              |
| -------- | ------------------------------------------------------------ | ------------------------ |
| `GET`    | `/api/v1/serverless/projects/{type}`                         | List projects            |
| `GET`    | `/api/v1/serverless/projects/{type}/{id}`                    | Get project details      |
| `PATCH`  | `/api/v1/serverless/projects/{type}/{id}`                    | Update a project         |
| `DELETE` | `/api/v1/serverless/projects/{type}/{id}`                    | Delete a project         |
| `GET`    | `/api/v1/serverless/projects/{type}/{id}/status`             | Get project status       |
| `POST`   | `/api/v1/serverless/projects/{type}/{id}/_reset-credentials` | Reset credentials        |
| `POST`   | `/api/v1/serverless/projects/{type}/{id}/_resume`            | Resume suspended project |

Where `{type}` is one of `elasticsearch`, `observability`, or `security`.

## Project phases

| Phase          | Meaning                                |
| -------------- | -------------------------------------- |
| `initializing` | Being created; not ready yet           |
| `initialized`  | Ready for use                          |
| `suspending`   | Being suspended                        |
| `suspended`    | Suspended (for example, trial expired) |
| `deleting`     | Being deleted                          |
| `deleted`      | Deleted (terminal state)               |

## Security guidance

- Never echo, log, or repeat passwords or API keys in chat or agent thinking.
- Prefer a scoped Elasticsearch API key over admin credentials for all data-plane work.
- For production or shared environments, back the CLI secret store with a centralized secrets manager rather than local
  files.
