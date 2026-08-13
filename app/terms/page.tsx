import Link from "next/link";
import { Shield } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service | SequrAI" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <Link href="/" className="flex items-center gap-2.5 mb-8 w-fit">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <Shield className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-sm font-semibold">SequrAI</span>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: July 2026</p>
        </div>

        <div className="prose prose-sm prose-invert max-w-none space-y-6 text-sm text-muted-foreground leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p>
              By accessing or using SequrAI, you agree to be bound by these Terms of Service.
              If you do not agree to these terms, please do not use the service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">2. Description of Service</h2>
            <p>
              SequrAI is a production readiness platform for applications developed with AI tools.
              We provide security reviews, Production Verdicts, and remediation guidance through a
              single Builder Edition plan (€5/month).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">3. Subscriptions and Billing</h2>
            <p>
              Access to SequrAI requires an active Builder Edition subscription billed monthly
              through Stripe. You may cancel anytime from the billing portal; cancellation stops
              future charges but does not refund the current billing period unless required by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">4. User Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials
              and for all activities that occur under your account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">5. Acceptable Use</h2>
            <p>
              You agree to use SequrAI only for lawful purposes and in accordance with these Terms.
              You may not use the service to scan systems you do not own or have explicit permission to test.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">6. Limitation of Liability</h2>
            <p>
              SequrAI is provided &quot;as is&quot; without warranties of any kind. We are not liable for
              any security incidents that occur in your applications.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">7. Contact</h2>
            <p>
              For questions about these Terms, contact us at{" "}
              <a href="mailto:legal@sequrai.com" className="text-primary hover:underline">
                legal@sequrai.com
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to SequrAI
          </Link>
        </div>
      </div>
    </div>
  );
}
