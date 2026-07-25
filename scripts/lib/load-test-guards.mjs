export function assertStagingTarget(baseUrl) {
  const url = new URL(baseUrl);
  const host = url.hostname.toLowerCase();
  const blocked = ["sequrai.com", "www.sequrai.com", "app.sequrai.com", "localhost"];
  if (blocked.includes(host) && !process.env.LOAD_TEST_ALLOW_LOCALHOST) {
    throw new Error(`Refusing load test against blocked host: ${host}`);
  }
  if (!host.includes("staging") && !process.env.LOAD_TEST_ALLOW_LOCALHOST) {
    throw new Error("Load tests require a staging hostname or LOAD_TEST_ALLOW_LOCALHOST=true");
  }
}

export function requireExplicitConfirmation(flag) {
  if (process.env.LOAD_TEST_CONFIRM !== "yes") {
    throw new Error(`Set LOAD_TEST_CONFIRM=yes to run destructive scenario ${flag}`);
  }
}
