import { startDynamicSecurityLab } from "./server.js";

const lab = await startDynamicSecurityLab();
console.log(JSON.stringify({
  origin: lab.origin,
  port: lab.port,
  host: "127.0.0.1",
  env: "SEQURAI_DYNAMIC_LAB_ORIGIN=" + lab.origin,
  endpoints: {
    unauthenticatedVulnerable: "GET /api/public/profile",
    unauthenticatedSecure: "GET /api/secure/profile (Bearer test-token-user-a)",
    idorVulnerable: "GET /api/orders/user-b (Bearer test-token-user-a)",
    idorProtected: "GET /api/orders/user-b-protected (Bearer test-token-user-a)",
    rateLimitVulnerable: "POST /api/login",
    rateLimitProtected: "POST /api/login-protected",
  },
  testIdentities: {
    userA: "Bearer test-token-user-a",
    userB: "Bearer test-token-user-b",
    admin: "Bearer test-token-admin",
  },
}, null, 2));

process.on("SIGINT", () => {
  void lab.close().then(() => process.exit(0));
});
