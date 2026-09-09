import { LandingNavbarClient } from "@/components/landing/LandingNavbarClient";

export function LandingNavbar({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return <LandingNavbarClient isAuthenticated={isAuthenticated} />;
}
