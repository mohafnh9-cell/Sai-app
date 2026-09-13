import { Inter, Geist, Geist_Mono } from "next/font/google";

/** Landing/marketing typeface. Do not use inside the authenticated app shell. */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
  preload: true,
});

/** Authenticated-app typeface only -- applied by the (dashboard) layout, never the root layout. */
export const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
  preload: false,
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  weight: ["400", "500", "600"],
  preload: false,
});
