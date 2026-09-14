import "server-only";

/**
 * Phase 36, section 15: the single source of truth for whether real
 * OS/container-level network egress enforcement exists for the Security
 * Execution Worker. Phase 35.5 recorded a `network_policy` value per job
 * but never enforced it (no iptables/seccomp/network-namespace restriction
 * was built) -- that finding is still true today; nothing in Phase 36
 * changes it.
 *
 * This defaults to false and MUST NOT be flipped by editing this file --
 * it requires an explicit operator attestation via
 * SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED, set only once the worker's
 * actual deployment has real enforcement in place and someone has verified
 * it (e.g. confirmed the container cannot reach 169.254.169.254 or an
 * RFC1918 address). Never infer this from network_policy metadata alone --
 * that field describes intent, not a control.
 */
export function isNetworkEgressEnforced(): boolean {
  return process.env.SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED?.trim() === "true";
}
