import type { ProductionPriority } from "@/brain/production-verdict/schema";

const ES_PRIORITY_TITLES: Record<string, string> = {
  "Harden authentication and session handling":
    "Refuerza la autenticación y el manejo de sesiones",
  "Protect resource ownership checks":
    "Protege las comprobaciones de propiedad de recursos",
  "Revoke exposed credentials and rotate secrets":
    "Revoca credenciales expuestas y rota secretos",
  "Add rate limiting to sensitive endpoints":
    "Añade límites de tasa a endpoints sensibles",
  "Protect admin endpoints and privileged routes":
    "Protege endpoints de administración y rutas privilegiadas",
  "Fix injection and input validation risks":
    "Corrige riesgos de inyección y validación de entradas",
  "Fix deployment and environment configuration":
    "Corrige la configuración de despliegue y entorno",
  "Mutating route lacks visible server-side validation":
    "Ruta de modificación sin validación visible en el servidor",
  "Mutating route without visible CSRF protection":
    "Ruta de modificación sin protección CSRF visible",
};

const ES_CATEGORY_LABELS: Record<string, string> = {
  authentication: "Problema de autenticación",
  authorization: "Problema de autorización",
  data_protection: "Protección de datos",
  deployment: "Configuración de despliegue",
  security: "Riesgo de seguridad",
  auth: "Problema de autenticación",
};

export function formatPriorityTitleForLocale(
  priority: Pick<ProductionPriority, "title" | "category">,
  locale: string
): string {
  if (locale !== "es") {
    return priority.title;
  }

  return (
    ES_PRIORITY_TITLES[priority.title] ??
    ES_CATEGORY_LABELS[priority.category] ??
    priority.title
  );
}
