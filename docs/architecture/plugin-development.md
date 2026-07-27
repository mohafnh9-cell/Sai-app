# Plugin development (Red Teams)

Template: `server/ai-red-team/templates/red-team-template/`

## Steps

1. Copy template manifest and set `id`, `supportedDomains`, `metadata.status`.
2. Register capabilities via `registerProvider` on a team registry wrapping `registerCoreCapabilities`.
3. Implement stage handlers for canonical stages you support.
4. Register plugin: `globalPluginRegistry.register(descriptor)`.
5. Wire coordinator to `executePluginPipeline`.
6. Add platform adapter under `integration/` (do not embed RT4/RT5 logic in RT-Core).

## Validate

```bash
npm run validate:red-team
```

## Do not

- Import domain enums into RT-Core.
- Bypass capability resolution for stage ordering.
- Emit findings without evidence (use `core/findings/finding-quality.ts` in tests).
