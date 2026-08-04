# SequrAI Prompts

Official LLM prompts and methodology documents for the production review pipeline.

| Prompt | Version | Document | Code module | Consumed by |
|--------|---------|----------|-------------|-------------|
| Analysis Engine V2 | 2.0.0 | [analysis-engine-v2.md](./analysis-engine-v2.md) | `brain/prompts/analysis-engine-v2.ts` | Scan runner, finding gate, AI narrative |
| AI Security Narrative | 2.0.0-ae | (derived from AE V2) | `server/ai-security-engine/claude-analyzer.ts` | Post-scan executive summary |

## Analysis Engine V2

The authoritative methodology for Production Readiness Review. Defines the eight-phase flow:

1. Understand the project  
2. Build the project model  
3. Determine applicability  
4. Attack planning  
5. Evidence collection  
6. Validation  
7. Safe Fix  
8. Production Verdict  

**Zero false positive policy:** insufficient evidence → `NOT ENOUGH EVIDENCE`, never invent findings.

### Integration map

```
docs/prompts/analysis-engine-v2.md          ← human-readable source of truth
        ↓
brain/prompts/analysis-engine-v2.ts         ← loader + constants
        ↓
├── server/security-scanner/scan-job-runner.ts   (methodology version in scan metrics)
├── brain/repository-model/finding-gate.ts       (applicability + evidence gate)
└── server/ai-security-engine/claude-analyzer.ts (post-scan narrative role)
```

Production Verdict status/score remains authoritative in `brain/production-verdict/` (ADR-001). Analysis Engine V2 feeds validated findings and narrative; it does not replace the verdict engine.
