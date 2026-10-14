# Panel "Corrección asistida" — recorrido y criterios de aceptación (SIN implementar)

Punto 11 de `V1_ACCEPTANCE_CHECKLIST.md`. Este documento se aprueba **antes** de escribir código. Reutiliza las rutas existentes; no añade backend nuevo, ni generación de parches, ni escritura en GitHub, ni PR automáticas, ni ámbitos MCP.

## 1. Principio: propuesta documental ≠ corrección verificada
- **Propuesta (documental):** instrucciones para el agente del usuario. SequrAI no ha cambiado el código ni escrito en GitHub. Estados `PROPOSED`/`READY`/`APPROVED`.
- **Corrección verificada:** solo `VERIFIED` con `statement = exact_commit_rescan_clean`: el commit informado fue reanalizado y el hallazgo ya no aparece. Cualquier otro resultado se presenta como **no verificado** (`not_verified`) o **análisis posterior limpio sin vínculo** (`later_analysis_clean_unbound`), nunca como corregido.
- La interfaz usa el estado **persistido** (#70) y no hace actualizaciones optimistas: tras cada acción vuelve a leer el registro.

## 2. Recorrido
| Paso | Estado visible | Lo que se muestra | Acción del usuario | Ruta existente |
|---|---|---|---|---|
| 0. Ver | cualquiera | Título del hallazgo, severidad, **rama y SHA del análisis base**, fecha, "Propuesta documental — SequrAI no ha cambiado tu código", instrucciones copiables | — | `GET /api/projects/{id}/safe-fixes` |
| 1. Aprobar | `READY` | Qué significa aprobar ("seguirás esta corrección; no se escribe nada en tu repositorio") | **Aprobar** (confirmación) | `POST …/{safeFixId}` `action: approve` |
| 2. Informar el commit | `APPROVED` | Mensaje "Aprobada. Falta informar el commit que contiene la corrección." | Introducir/elegir el commit (§3) | `action: applied` + `commitSha` |
| 3. Confirmar | `APPLIED` | Resumen explícito (§3) y estado "Pendiente de verificación". Sin ningún "corregido" | **Verificar** | `action: verify` |
| 4. Verificar | `VERIFYING` | "Verificando el commit {sha corto} de la rama {rama}…" con actualización automática (sondeo) hasta un resultado | — (cancelar no existe: se indica) | `GET …/{safeFixId}` |
| 5. Resultado | `VERIFIED` / `FAILED` | **Verificada:** commit completo, rama, análisis (id corto, fecha), declaración. **No verificada:** motivo en lenguaje claro + qué hacer | **Reabrir** o informar otro commit | `action: reopen` |
| 6. Histórico | `SUPERSEDED`/anteriores | Marcadas como históricas, con su commit y fecha | — | `GET` |

## 3. Informar el commit: sin preselección silenciosa
- **Ningún valor por defecto.** El campo empieza vacío. No se rellena con el último commit detectado.
- Puede ofrecerse una **tarjeta de sugerencia** (no seleccionada): "Último commit detectado en {rama}: {SHA completo} · analizado el {fecha} / sin análisis todavía" con el botón "Usar este commit". Elegirlo es una acción explícita del usuario.
- Se acepta un SHA completo de 40 caracteres hexadecimales (validación inmediata; el servidor exige lo mismo).
- **Pantalla de confirmación obligatoria**, siempre antes de enviar, con todos estos datos:
  - Rama: `{rama}`; SHA completo: `{sha40}` (copiable).
  - Análisis de ese commit: "{id corto} del {fecha}" o "sin análisis: la verificación lo reanalizará".
  - Análisis base de la propuesta: "{id corto}, commit {sha base}, {fecha}".
  - Aviso si el commit coincide con el commit base de la propuesta ("es el mismo commit que originó el hallazgo: no puede contener la corrección") y no se permite continuar si es idéntico.
  - Texto: "Vas a declarar que el commit {sha corto} contiene la corrección de «{título}». SequrAI lo reanalizará; hasta entonces no es una corrección verificada."
  - Botón **Confirmar commit** (no hay confirmación por Enter ni por defecto).
- El servidor sigue siendo la autoridad: rechaza otro proyecto, organización, repositorio o rama; la interfaz solo muestra su respuesta.

## 4. Errores y recuperación (mapa de `mapSafeFixError`)
| Respuesta | Mensaje al usuario | Acción ofrecida |
|---|---|---|
| 404 | "No encontramos esta corrección en tu espacio de trabajo." | Volver a la lista |
| 409 `open_fix_exists` / `in_flight` | "Ya hay una corrección en curso para este hallazgo." | Ir a la corrección en curso |
| 409 por estado (p. ej. verificar fuera de `APPLIED`) | Explica el estado actual y no escribe nada | Recargar estado |
| 409 `proposal_commit_mismatch` | "El commit analizado no es el que informaste." | Informar de nuevo o esperar el análisis |
| 503 / error transitorio | "No pudimos completar la verificación; no se ha cambiado nada." | Reintentar verificar |
| Verificación fallida | Motivo (`reasons`) en lenguaje claro | Reabrir / informar otro commit |

## 5. Criterios de aceptación
**Producto**
1. Ningún campo de commit se rellena solo; sin confirmación explícita no se envía `applied`.
2. La confirmación muestra rama, SHA completo, análisis del commit y análisis base; el resultado final los repite.
3. "Propuesta" y "corrección verificada" tienen rótulos y estilos distintos; ninguna frase de aprobación/corregido aparece antes de `VERIFIED` con `exact_commit_rescan_clean`.
4. El estado mostrado coincide con la base de datos tras cada acción (sin optimismo).
5. Todas las respuestas 4xx/5xx de la tabla §4 tienen texto y salida.
6. Español e inglés con paridad de claves; sin cadenas fijas.
7. Accesible: operable con teclado, `aria-live` para cambios de estado, foco en el diálogo.
8. Solo usa las rutas existentes; sin cambios de esquema ni migraciones.

**Pruebas**
9. Componente: un test por estado (`READY`, `APPROVED`, `APPLIED`, `VERIFYING`, `VERIFIED`, `FAILED`, `SUPERSEDED`) y por error de §4.
10. Recorrido local sobre los manejadores reales con base en memoria (como `granted-scopes-flow`): crear → aprobar → informar → verificar; más negativos (commit igual al base, SHA corto, otra organización → 404).
11. Aislamiento: un usuario de otra organización no ve ni opera la corrección (404) — también con la sesión B real (punto 12).
12. Cobertura de no regresión: las suites de `safe-fix-engine` y MCP siguen en verde.

**Aceptación real (punto 11 de la checklist)**
13. El propietario completa el flujo **sin consola** sobre `sequrai-e2e-test` (fixture → corrección → verificación). Requiere commits autorizados en ese repositorio (no autorizados todavía).

## 6. Fuera de alcance
Aplicar parches, abrir PR, escribir en GitHub, cola de trabajos nueva, notificaciones, nuevos ámbitos o herramientas MCP, generación de propuestas distinta de la existente.

## 7. Preguntas abiertas (a decidir antes de implementar)
- ¿Dónde vive el panel: sección de la página del proyecto (recomendado) o página propia? 
- ¿Se ofrece el botón "Generar propuesta" (reutiliza `POST …/safe-fixes`) o solo se muestran las creadas por MCP?
- ¿La tarjeta de sugerencia del último commit detectado es aceptable (siempre sin seleccionar)?
