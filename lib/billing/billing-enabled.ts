/** Paid Builder Edition — off until launch. Set SEQURAI_BILLING_ENABLED=true to enable. */
export function isBillingEnabled(): boolean {
  return (
    process.env.SEQURAI_BILLING_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_SEQURAI_BILLING_ENABLED === "true"
  );
}
