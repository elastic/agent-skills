# Agent Builder companion (optional, non-universal)

The universal skill body uses Elasticsearch and Kibana HTTP APIs only. Prebuilt **Kibana Agent Builder** tools (`ad_*`),
workflows (`ad_wf_*`), and registration scripts are **not** part of the universal contract.

Teams running Kibana Agent Builder may optionally deploy custom ES|QL tools and workflows that wrap the same underlying
indices (`.ml-anomalies-*`, `.ml-config`, `.ml-notifications-*`) and ML APIs documented in this skill. Those assets are
maintained separately from this skill package and are not required for investigation, explanation, or troubleshooting
via the `elastic` CLI.

When Agent Builder tools are available in a runtime, they can accelerate repetitive RCA queries — but the expert
judgment (rank by `influencer_score`, diagnose `memory_status = hard_limit`, lifecycle sequencing) remains identical.
