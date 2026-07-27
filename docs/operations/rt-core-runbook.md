# RT-Core runbook

## Verify

```bash
cd sequrai-app
npx vitest run server/ai-red-team/core
npm run validate:red-team
```

## Common failures

| Symptom | Check |
|---------|--------|
| Manifest registration throws | `validateRedTeamManifest` issues; missing `metadata.status` |
| Stage skipped | Missing capability in registry; inspect planner explainability |
| Nondeterministic plans | Ensure capability roots sorted; compare resolution reports |

## Version

Export `RT_CORE_VERSION` from `core/index.ts` — bump major only on breaking contract changes.
