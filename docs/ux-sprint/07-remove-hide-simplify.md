# Remove, Hide, and Simplify

**Rule:** If it doesn’t serve the first 5 minutes or “what should I do next?”, remove, hide, or defer.

**This sprint:** UX visibility only—routes may remain behind flags or direct URLs.

---

## REMOVE (delete UI or dead code in implementation sprint)

| Item | Location | Reason |
|------|----------|--------|
| Post-scan “Building your Production Verdict” phase | `OnboardingVerdictReveal.tsx` | Duplicate wait; scan already built verdict |
| Wizard step `dashboard` as separate screen | `OnboardingDashboardEntry.tsx` flow | Merged into finale |
| `FirstVerdictDashboardModal` | dashboard | Redundant with inline hero |
| Orphan components (if not merged) | `OnboardingEngineerStep`, `OnboardingFastestPath`, `VendorLockInNotice` | Unused |
| Broken orphan steps without copy | `OnboardingSafeFixStep`, `OnboardingMcpStep` | Replace with finale + cursor spec |
| Duplicate Safe Fix entry on same view | FastestPath on onboarding/project above fold | One hero fix card |
| Progress label “Production Review completed” | onboarding i18n | Jargon |

---

## HIDE (nav / default UI; keep routes for power users)

| Item | Location | How |
|------|----------|-----|
| Timeline | `/timeline` | Remove sidebar + redirect to dashboard |
| Security scanner hub | `/security` | Hide nav |
| AI Fixes legacy | `/ai-fixes` | Already redirects to projects—remove nav refs |
| Technical Details | Project sub-nav | Show only after first GO or 7 days |
| Production Verdict History | Project sub-nav | Rename **History**; collapse under “More” menu |
| Production intelligence panels | Project page collapsed | Below fold; default collapsed |
| Integrations advanced (webhooks, bulk) | Integrations page | “Advanced” accordion; default closed |
| Autopilot / automatic review settings | Settings | Move under Advanced settings |
| Score numbers on dashboard portfolio | `PortfolioVerdictCard` | Badge only in list view |
| `reviewStages` full list | Review step | Current stage + bar only |
| MCP technical docs links in body | Settings | Wizard modal only |

---

## SIMPLIFY (keep but reduce)

| Item | Change |
|------|--------|
| Workspace creation | One field; drop explanatory paragraph |
| GitHub scopes | Accordion default closed |
| Sidebar labels | 4 items max; plain names |
| Project sub-nav | **Overview** only visible first week; rest in ⋯ menu |
| Verdict terminology | Single hero eyebrow: **Deploy answer** |
| Safe Fix button labels | One string globally (doc 03) |
| Settings MCP card | Same 3-step wizard as onboarding, condensed |
| Integrations | First visit: “Add another app” secondary to home |
| Analyze vs Review vs Scan | One verb: **Check again** |
| ProductionVerdictExperience | Full view only on scan/report routes |
| Onboarding page title | “Ready to ship?” not “First Production Verdict” |
| Completion logic | Complete onboarding after finale/cursor, not DB verdict alone |

---

## COPY SIMPLIFICATION TABLE

| Remove phrase | Replace with |
|---------------|--------------|
| Production Review | Checking your app |
| Production Verdict (user-facing) | Deploy answer |
| Production Ready Score | Readiness |
| Critical blocker | Thing to fix first |
| Workspace | Your team *(or omit)* |
| MCP | Cursor connection |
| View Production Verdict | Continue *(or remove button)* |
| Copy Safe Fix Prompt | Copy fix for Cursor |
| Integrations | GitHub |
| Production Journey | History |

---

## SETTINGS — keep vs hide

| Keep visible | Hide under Advanced |
|--------------|---------------------|
| Profile / language | Autopilot tuning |
| Cursor connection | Webhook secrets detail |
| Billing link | Org admin extras |
| GitHub connection status | MCP key rotation history |

---

## INTEGRATIONS PAGE — first-run vs mature

| First app (0–7 days) | After |
|----------------------|-------|
| Banner: “Your first app is connected” | Full repo list |
| CTA: Return to project | Add repos |
| Webhooks hidden | Webhooks in Advanced |

---

## METRICS FOR SIMPLIFICATION SUCCESS

- Reduction in onboarding **clicks to finale** (target: −2).
- Reduction in **unique terms** on onboarding screens (target: ≤ 5 proper nouns).
- Increase **safe_fix_copy** from onboarding finale (target: ≥ 40% of NO-GO users).

---

## Explicitly NOT removing (core value)

- Production Verdict engine / hero component
- Safe Fix generation backend
- MCP five tools
- GitHub OAuth
- Scan job pipeline
- Project + dashboard routes

---

## Implementation order (recommended)

1. Merge onboarding finale + remove redundant steps  
2. Safe Fix card on finale + unified copy  
3. Cursor onboarding wizard  
4. Dashboard hero simplification  
5. Nav hide + copy grep  
6. Delete dead components  

Each PR maps to this doc—no feature creep.
