# RT9 Known Limitations Register (Slice 10)

| ID | Limitation | Impact | Likelihood | Mitigation | Blocks production? |
|----|------------|--------|------------|------------|-------------------|
| L1 | Heuristic workflow discovery from discovery report / API inventory hints | May miss custom workflows or over-fit template kinds | Medium | Evidence thresholds (`MIN_WORKFLOW_CONFIDENCE`); static site yields zero workflows | No (flagged) |
| L2 | Generic FSM templates per workflow kind | States/transitions may not match real provider FSM | Medium | Validation issues surfaced; mock simulation only | No |
| L3 | No AST / DB schema parsing | Invariants inferred from templates not code | High | Cross-check with RT7/RT8; confidence caps in execution classifier | No |
| L4 | Mock runtime ≠ staging/production evidence | Findings reflect simulated abuse, not live traffic | High | Classifications capped; unsupported rejected; RT11 replay future | No (disclosed) |
| L5 | Pessimistic mock violations for many abuse categories | “Secure” apps may still get candidate findings | Medium | RT5 policies unchanged; severity/confidence gates | No |
| L6 | UUID-based entity/workflow IDs per run | Raw IDs differ between runs; semantic keys stable | Low | `findingKey` / `findingId` hash stable; persistence uses logical keys | No |
| L7 | Concurrency simulation bounded (`maxConcurrentExecutions: 1`) | Race findings are mock-scoped | Medium | Abuse + specialist narrative; budget limits | No |
| L8 | Incomplete economic impact quantification | Dollar impact is qualitative | Medium | RT5 business impact from intelligence layer | No |
| L9 | Persistence RLS not defined in 040 | Tables intended for service role | Medium | Do not expose PostgREST to anon; wire service role only | **Conditional** |
| L10 | Supabase store not wired in director by default | MC DB may lack metrics until job metadata merge | Medium | Agent metadata + scan job writer follow-up | No |
| L11 | RT11 replay not implemented | Replay plans are metadata only | Certain | `executable: false` default; ASO `autoExecute: false` | No |

## Release relevance

RT9 is suitable for **controlled internal rollout** behind `business_logic_team` and optional `business_logic_persistence`, with clear simulation limits (L4–L5) and tenant scoping enforced at application layer (org/project on all rows).
