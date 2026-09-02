import "server-only";

import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

function logSendFailure(kind: string, to: string, error: unknown) {
  // M7 (audit): a Resend failure must never propagate as an unhandled
  // rejection into whatever triggered the email (a scan completing, a
  // critical alert firing) -- callers additionally wrap these in their own
  // try/catch, but the send functions themselves fail closed too so this
  // holds even for a future caller that forgets to.
  console.error({
    component: "resend",
    event: "send_failed",
    kind,
    to,
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function sendScanCompletedEmail(params: {
  to: string;
  projectName: string;
  scanId: string;
  vulnerabilityCount: number;
  criticalCount: number;
  score: number;
}): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) {
    console.log("[Resend] Mock: Scan completed email would be sent to", params.to);
    return { sent: false };
  }

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "noreply@sequrai.com",
      to: params.to,
      subject: `Production Review completed for ${params.projectName}`,
      html: `
        <h2>Production Review completed</h2>
        <p>Your Production Review for <strong>${params.projectName}</strong> has completed.</p>
        <ul>
          <li>Production Ready Score: <strong>${params.score}/100</strong></li>
          <li>Findings reviewed: <strong>${params.vulnerabilityCount}</strong></li>
          <li>Critical blockers: <strong>${params.criticalCount}</strong></li>
        </ul>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/projects">View Production Verdict</a>
      `,
    });
    return { sent: true };
  } catch (error) {
    logSendFailure("scan_completed", params.to, error);
    return { sent: false };
  }
}

export async function sendCriticalVulnerabilityEmail(params: {
  to: string;
  projectName: string;
  vulnerabilityTitle: string;
  vulnerabilityId: string;
}): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) {
    console.log("[Resend] Mock: Critical vulnerability email would be sent to", params.to);
    return { sent: false };
  }

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "noreply@sequrai.com",
      to: params.to,
      subject: `[CRITICAL] Security vulnerability detected in ${params.projectName}`,
      html: `
        <h2>Critical Security Vulnerability Detected</h2>
        <p>A critical vulnerability was found in <strong>${params.projectName}</strong>:</p>
        <p><strong>${params.vulnerabilityTitle}</strong></p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/projects">View and Fix Now</a>
      `,
    });
    return { sent: true };
  } catch (error) {
    logSendFailure("critical_vulnerability", params.to, error);
    return { sent: false };
  }
}
