#!/usr/bin/env node
/**
 * Platform Convergence — staging certification environment inspector.
 */

import { mainCertificationCli } from "./run-platform-convergence-certification.mjs";

await mainCertificationCli("staging");
