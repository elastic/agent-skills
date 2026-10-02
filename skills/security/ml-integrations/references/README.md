# security-ml-integrations

Agent skill for installing and managing Elastic security ML integration packages. The same `SKILL.md` runs in coding
agents and Agent Builder: the body cites HTTP shorthand; the Operations table binds each call to the `elastic` CLI.

## What's included

A single Agent Skill (`SKILL.md` at the package root) covering the full install lifecycle for six security ML packages:
**beaconing**, **ded**, **dga**, **lmd**, **pad**, **problemchild**.

**Kibana version:** Requires **Kibana 9.4+** with Fleet, ML, and Security; a Platinum, Enterprise, or trial license (or
Serverless); `manage_ml`; and the `elastic` CLI ≥ 0.5.

- [package-capabilities.md](package-capabilities.md) — source patterns, shared template fields, ingest-pipeline wiring

## Using this package from agent-skills-sandbox

Install the skill into your agent runtime using the repo's installer script:

```bash
./scripts/install-skills.sh add -a cursor -a claude-code -s 'security-ml-integrations' --yes
```

Restart your agent runtime after installation. Confirm the `elastic` CLI is installed and configured before asking the
agent to check or install a package.

## Layout

```text
ml-integrations/
├── SKILL.md                          # Skill definition: metadata + process + Operations
├── references/
│   ├── README.md                     # This file
│   └── package-capabilities.md       # Per-package patterns, templates, pipelines
└── tests/
    ├── eval.yaml                     # Cluster-free unit + baseline suite
    └── goldenset.json                # LLM-judge cases
```
