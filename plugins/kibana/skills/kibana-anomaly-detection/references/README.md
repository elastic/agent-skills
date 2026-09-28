# kibana-anomaly-detection references

Universal skill references for Elastic ML anomaly detection — investigation, score explanation, troubleshooting, and job
configuration. All analytical workflows use Elasticsearch ML REST APIs and `POST /.ml-anomalies-*/_search`.

| File                                                               | Purpose                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| [score-reference.md](score-reference.md)                           | Score field definitions, bands, renormalization, explanation |
| [anomaly-detection-functions.md](anomaly-detection-functions.md)   | Detector function selection guide                            |
| [protocols/investigation.md](protocols/investigation.md)           | 14-step RCA protocol                                         |
| [investigation-queries.md](investigation-queries.md)               | Search query templates for Investigate mode                  |
| [troubleshooting-reference.md](troubleshooting-reference.md)       | Memory, datafeed, and lifecycle troubleshooting              |
| [worked-example.md](worked-example.md)                             | End-to-end investigation walkthrough                         |
| [job-creation-recipes.md](job-creation-recipes.md)                 | Job + datafeed JSON recipes for Manage mode                  |
| [security-anomaly-expert.md](security-anomaly-expert.md)           | Threat-first framing (MITRE mappings, attack-chain protocol) |
| [observability-anomaly-expert.md](observability-anomaly-expert.md) | SRE / reliability framing                                    |
| [agent-builder-companion.md](agent-builder-companion.md)           | Optional non-universal Agent Builder deployment note         |

For job create/open/start lifecycle details, see also the `elasticsearch-anomaly-detection` skill in this repository.
