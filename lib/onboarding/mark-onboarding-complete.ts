/** Marks the first-run onboarding wizard complete (user metadata). */
export async function markOnboardingWizardComplete(): Promise<boolean> {
  const response = await fetch("/api/onboarding/complete", { method: "POST" });
  return response.ok;
}
