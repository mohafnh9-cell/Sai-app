# Delivering the security worker (Railway) alongside the app (Vercel)

Two deployables, two pipelines:

| | App | Security worker |
|---|---|---|
| Where | Vercel (`sequrai-app`) | Railway, project `sequrai`, env `production`, service `sequrai` |
| Deployed by | merging to `main` (automatic) | **manual** `railway up` (no CI, no git link) |
| Runs | Next.js | `worker/dist/worker-bundle.cjs` via `worker/Dockerfile` (opengrep, trivy, crypto engines, the engine-terminal verdict finalizer) |

**Merging to `main` does not update the worker.** On 2026-10-14 the worker was still the 2026-10-05 build (`0a44ed2`), so verdict code merged after that (#76 D9, #79, #96) never ran where engine jobs finish.

## Which version is the worker running?
- Database (read-only): `select claimed_by, max(claimed_at) from security_jobs group by 1 order by 2 desc limit 3;` — `claimed_by` is `worker-<commit7>-<pid>-<start>`.
- Worker logs: the `starting` event prints `buildCommit` and `deploymentId`; `/health` and `/readiness` (inside the container) include `buildCommit`.
- Railway: `railway deployment list` (the message carries the commit).

## Does a change need a worker deploy?
After merging, with `<deployed>` = the commit from `claimed_by`:

    node scripts/worker-impact.mjs <deployed> HEAD

Exit 1 lists the bundled files that changed (the bundle's own input list, plus lockfile/Dockerfile/engine rules). Exit 0: no worker deploy needed. Do this for every merge that touches `server/`, `brain/`, `lib/` or `worker/`.

## Deploying the worker
1. Pick a window with no active jobs (`security_jobs` QUEUED/RUNNING = 0, no active scans): the old process has no drain, SIGTERM aborts in-flight work after 3 s.
2. `scripts/export-worker-source.sh <commit> <empty-dir>` (clean `git archive`, no `.env`, writes `worker/BUILD_INFO.json`).
3. From that directory: `railway up --ci -p <project id> -e production -s sequrai -m "worker <full commit> <why>"`. Railway activates the new version only if `/health` passes.
4. Confirm: new `deploymentId`, new `claimed_by` prefix on the next claimed job, old deployment `REMOVED`.
5. Engines: `/health` does not prove the engines work; check `/readiness` inside the container or the engine versions recorded on the first job.

## Recovery
Record the previous deployment (id, commit, image digest) before deploying. If the new one fails `/health` it never becomes active. If it fails later, `railway up` from the previous commit's export. Going back to an old commit **reintroduces whatever was fixed since**; do it only as an emergency and say which fixes are lost.
