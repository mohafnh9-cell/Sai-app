# Red Team manifest

Type: `RedTeamManifest` (`core/declarative/manifest.types.ts`).

## Required fields (validation)

- `id`, `name`, `version` (semver integers)
- `supportedDomains` (domain list)
- `metadata.status` (e.g. `stable`, `private-beta`)
- `supportedCapabilities` (pipeline roots)
- Module declarations: discovery, graph, invariants, attacks, specialists, runtime profiles, findings, coverage, telemetry, platform adapters
- `metadata.canonicalStages` should mirror `CANONICAL_PIPELINE_STAGE_ORDER`

## RT9 / RT10 manifests

- RT9: `business-logic/declarative/manifest.ts` (`RT9_BUSINESS_LOGIC_MANIFEST`)
- RT10: `llm-team/declarative/manifest.ts` (`RT10_LLM_MANIFEST`)

Validate locally:

```bash
npm run validate:red-team
```

## Plugin descriptor

Plugins add:

- `pluginId`, `handlers`, `supportedStageIds`, `rootCapabilityId`

Registration: `globalPluginRegistry.register(descriptor, { capabilityRegistry })` when strict capability reference checks are needed.
