# Graph engineering demo: a resilience audit as a Claude Code workflow

A small seeded Scala/Play + Spring corpus with planted resilience bugs (and decoys), audited by a
Claude Code dynamic workflow that was grown stage by stage:

| Stage | Graph shape | Agents | Tokens |
|---|---|---|---|
| 1 | single agent | 1 | 41k |
| 2 | scatter-gather, one auditor per file | 4 | 158k |
| 3 | + JSON-schema edges, deterministic validator, quarantine | 4 | 159k |
| 4 | + adversarial verification gate (supported / refuted / unverified) | 10 | 398k |
| 5 | + grounded synthesis (resumed from stage 4 cache) | 11 (1 live) | 39k |
| 6 | stage 4 with injected faults | 10 | 398k |

- `app/`, `src/`: the seeded corpus (do not ship this code, it is wrong on purpose)
- `.claude/workflows/resilience-audit.js`: the final workflow, available as `/resilience-audit`
- `.claude/demo-graph/`: per-stage scripts, results, metrics, `checkpoint.json` and `ground-truth.json`

Run it in Claude Code from this folder: `/reload-skills`, then `/resilience-audit`.
