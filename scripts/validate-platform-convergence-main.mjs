#!/usr/bin/env node
/**
 * Platform Convergence — main environment certification (explicit opt-in only).
 */

import { mainCertificationCli } from "./run-platform-convergence-certification.mjs";

await mainCertificationCli("main");
