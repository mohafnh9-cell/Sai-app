import type { Metadata, Viewport } from "next";
import { getRequestLocale } from "@/lib/i18n/server";
import { inter } from "@/lib/fonts";
import { VercelAnalytics } from "@/components/analytics/VercelAnalytics";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "SequrAI — The security layer for AI-built software",
    template: "%s | SequrAI",
  },
  description:
    "Your AI builds the software. SequrAI adds the security layer. Analyze your app before production, detect priority risks, and get a Production Verdict on what to fix before you deploy.",
  keywords: [
    "security layer",
    "AI-built software",
    "production verdict",
    "security reviews",
    "AI builders",
    "deploy with confidence",
  ],
  authors: [{ name: "SequrAI" }],
  creator: "SequrAI",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://sequrai.com",
    title: "SequrAI — The security layer for AI-built software",
    description:
      "Your AI builds the software. SequrAI adds the security layer. Get a Production Verdict before you deploy.",
    siteName: "SequrAI",
  },
  twitter: {
    card: "summary_large_image",
    title: "SequrAI — The security layer for AI-built software",
    description:
      "Analyze risks before production. Get your Production Verdict and Recommendations before you deploy.",
    creator: "@sequrai",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <body className={`${inter.className} min-h-app antialiased`}>
        {children}
        <VercelAnalytics />
      </body>
    </html>
  );
}
