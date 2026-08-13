import Link from "next/link";
import { Shield } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy | SequrAI" };

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: July 2026</p>
        </div>

        <div className="prose prose-sm prose-invert max-w-none space-y-6 text-sm text-muted-foreground leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">1. Information We Collect</h2>
            <p>
              We collect information you provide directly (name, email, organization details)
              and information generated through your use of SequrAI (projects, scan results).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">2. How We Use Your Information</h2>
            <p>
              We use your information to provide and improve the SequrAI service, process your
              Builder Edition subscription (€5/month via Stripe), send security reports, and
              communicate important updates about your account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">3. Data Storage</h2>
            <p>
              Your data is stored securely using Supabase (PostgreSQL) with row-level security
              policies ensuring only you and your organization members can access your data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">4. Third-Party Services</h2>
            <p>
              We use GitHub for authentication, Stripe for Builder Edition billing (€5/month),
              and Supabase for data storage. Each service has its own privacy policy governing
              their use of your information.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">5. Data Deletion</h2>
            <p>
              You can delete your account and all associated data at any time from Settings.
              Deletion is permanent and irreversible.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">6. Contact</h2>
            <p>
              For privacy questions, contact us at{" "}
              <a href="mailto:privacy@sequrai.com" className="text-primary hover:underline">
                privacy@sequrai.com
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
