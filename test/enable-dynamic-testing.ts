// Imported FIRST by the suites that exercise the dynamic security testing capability against the local lab.
// In V1 that capability is closed by default (server/attack-simulation/availability.ts); these suites open it explicitly,
// so "closed unless an operator opens it" is what every other test (and production) sees.
process.env.SEQURAI_DYNAMIC_SECURITY_TESTING_ENABLED = "true";
process.env.SEQURAI_FEATURE_FLAGS_JSON = JSON.stringify({
  ...(process.env.SEQURAI_FEATURE_FLAGS_JSON ? JSON.parse(process.env.SEQURAI_FEATURE_FLAGS_JSON) : {}),
  attack_simulation: "ga",
});
export {};
