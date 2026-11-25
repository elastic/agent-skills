# Path performance (measured)

Same task (hourly security-posture snapshot: 3× http, ES|QL, foreach+bulk, Slack), same local Kibana 9.6, sonnet.
Numbers are wall-clock / turns / USD cost for a 3rd-party agent (Claude Code):

| Path                                                | Wall     | Turns | Cost      | Why                                               |
| --------------------------------------------------- | -------- | ----- | --------- | ------------------------------------------------- |
| Discovery-tools (default)                           | **206s** | 25    | $0.57     | targeted `get_*` lookups, output kept in files    |
| Generator via converse ([ref](generator-path.md))   | 288s     | 17    | **$0.46** | LLM work runs in Kibana; ~2× 75s converse blocks  |
| Schema ([ref](schema-path.md))                      | 942s     | 50    | $1.63     | grinds the ~2 MB schema; 2.6M cache-read replayed |
| _(reference: Agent Builder in-process, 1 converse)_ | _131s_   | —     | —         | _in-process floor; not a 3rd-party path_          |

## Why not front-load the catalog?

Do **not** pull the full step/trigger catalog into context upfront to imitate the in-process generator — measured at
274s / $0.71, worse than targeted lookups. A context-replay harness re-sends everything every turn, so a big upfront
dump is paid dozens of times over. The generator can front-load because it runs in-process; a 3rd-party agent cannot.
Minimize round-trips and keep large tool output in files instead.

## Closing the gap to Agent Builder

The AB→3rd-party gap is harness tax (full-context replay per turn). Closing it fully requires the standalone
`generate_workflow` API — [security-team#18614](https://github.com/elastic/security-team/issues/18614); the
discovery-tools-as-APIs discussion is [security-team#18615](https://github.com/elastic/security-team/issues/18615).
