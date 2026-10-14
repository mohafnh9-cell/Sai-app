# Observación breve para cerrar V1 (solo criterios abiertos; no se repite el recorrido)

Tiempo total estimado del propietario: 25–35 min repartidos en tres bloques. Nada de esto lanza scans ni escribe datos de producción: las lecturas de B2 son GET y las pruebas de escritura (B3) no se hacen sin un registro desechable autorizado.

## Cómo registrar (común)
- **Grabación local, la inicia el propietario:** macOS `⌘⇧5` → *Grabar la parte seleccionada* (incluir la ventana del navegador **y** un reloj UTC visible: abrir `https://time.is/UTC` en una ventana pequeña al lado). Guardar el archivo con el nombre del criterio (`O1.mov`…). No hace falta enviarlo entero: bastan capturas con la hora.
- Consola (solo para O1): `F12 → Console`, marcar *Preserve log*, recargar con `⌘⇧R`. Copiar o capturar **cualquier línea roja**, o decir «sin rojos».
- Regla: si algo no se ve, se escribe «no observado». No se reconstruye a partir de capturas posteriores.

## O1 · Journey en la página real: el #418 sigue abierto (3–5 min)
Cronología: el `#418` (argumento **HTML**: diferencia de estructura) se observó **después** de desplegar #77. No hay causa determinada; una hipótesis sin confirmar es una extensión del navegador que modifica el DOM antes de la hidratación.
Se hacen dos pasadas, en este orden, y se anota cada una por separado:
1. **Ventana normal** (con extensiones): abrir `/projects/2005075a-fc80-4bcc-a080-52bf8195cf2f/journey`, consola abierta con *Preserve log*, `⌘⇧R`, esperar 5 s. Capturar la pantalla (hitos con fecha `AAAA-MM-DD` y commit) y la consola. Si hay una línea roja, **copiarla completa** (incluido el enlace con `args[]=`).
2. **Ventana de incógnito sin extensiones** (activar extensiones en incógnito está desactivado por defecto; comprobar `chrome://extensions` → «Permitir en incógnito» apagado), misma URL, misma consola, misma recarga.
- **Interpretación (no se decide antes de ver los datos):** error solo en la ventana normal → apunta a una extensión (quitar de una en una); error en ambas → es de la aplicación: pegar el error completo y parar; sin error en ninguna → no reproducido (no equivale a resuelto).
- Si aparece en la aplicación, la siguiente comprobación es una compilación **sin minificar** de la misma página para obtener la pila de componentes: se prepara aparte.

## O2 · Una pestaña en reposo ante un análisis nuevo (solo cuando #81 esté desplegada y haya un commit autorizado)
1. Abrir `/projects/…/mission-control` **sin** `run`, dejarla en primer plano con el reloj UTC visible; anotar la hora H0.
2. El agente hace el push autorizado y dice la hora exacta (H1). No tocar la pestaña.
3. Anotar a qué hora aparece el aviso «Hay un análisis más reciente…» (esperado ≤ 60 s tras terminar el scan) y **que nada más cambia**. Pulsar el enlace y anotar qué se ve.
- **Pasa:** el aviso aparece y la vista no se sustituye sola. **Falla:** la vista cambia sin aviso, o no hay aviso a los 2 min.

## O3 · Transición negativo → VERIFIED tras #78 (solo en una ejecución autorizada)
Requiere repetir una verificación negativa y luego la correcta sobre un commit nuevo: no se hace hasta autorizar los commits. Registrar con grabación: la tarjeta justo tras pulsar *Verificar* (¿pasa por «Actualizando evidencia»?, ¿cuántos segundos?) y a los 10 s. **Pasa:** nunca muestra motivos del intento anterior.

## O4 · Pantalla durante un análisis manual (D9), en la siguiente ejecución autorizada
Con la grabación y el reloj UTC, anotar la hora de cada cambio visible (progreso, «completado», veredicto). Se compara con la base de datos (motores, marcador, veredicto). **Pasa:** ningún veredicto ni «completado final» antes de que terminen los motores.

## Sesión B: aislamiento entre organizaciones (el bloqueo 12)
**Qué falta:** un usuario real **B** de otra organización **no protegida**. El agente **no crea cuentas**: la crea el propietario.

**B0 · Preparación (propietario, 10 min):**
1. Perfil de Chrome nuevo o ventana privada distinta de la sesión A.
2. Registrarse en SequrAI con **otro correo** (p. ej. un alias `+b`). No invitar a B a Sequrai ni usar `test-ai-g7r2` ni el proyecto protegido.
3. Comprobar que B tiene **su propia organización activa** (nombre visible en el selector de espacio de trabajo) y que no ve `sequrai-e2e-test`. Capturar la pantalla con la identidad y el espacio de trabajo.
4. Si el producto exige suscripción antes de entrar, decirlo: para este criterio basta con estar autenticado.

**B1 · URLs directas con la sesión B, solo lectura (cada una con captura; esperado: 404 o redirección, sin datos de A):**
`/projects/2005075a-fc80-4bcc-a080-52bf8195cf2f/mission-control`, `/journey`, `/scans`, y `/scanner-results/e5aaf268-5061-4132-91ef-925cd415c828`.

**B2 · API con la sesión B, SOLO LECTURA (GET), con un usuario B autorizado (consola, una ejecución, 6 peticiones; ninguna escribe):**
```js
(async()=>{
  const P='2005075a-fc80-4bcc-a080-52bf8195cf2f', VER='e2fa01eb-ac10-476a-9f51-76a92c2e77a6', SCAN='e5aaf268-5061-4132-91ef-925cd415c828';
  const reqs=[['GET',`/api/projects/${P}/safe-fixes`],['GET',`/api/projects/${P}/safe-fixes/${VER}`],['GET',`/api/brain/project/${P}`],
    ['GET',`/api/projects/${P}/mission-control`],['GET',`/api/projects/${P}/analysis-runs?limit=1&verdicts=0`],['GET',`/api/repositories/${P}/scans/${SCAN}`]];
  const rows=[];
  for(const [m,u] of reqs){
    const r=await fetch(u,{method:m,credentials:'same-origin',cache:'no-store'});
    const t=await r.text();
    rows.push({request:`${m} ${u.replace(P,'P').replace(VER,'VER').replace(SCAN,'SCAN')}`,status:r.status,leaksData:/lifecycleState|proposalCommitSha|productionVerdict|currentVerdict|"verdict"|safeFixes|"runs"/.test(t),body:t.slice(0,70)});
  }
  console.table(rows);
  console.log(rows.every(x=>[401,403,404].includes(x.status)&&!x.leaksData)?'ISOLATION OK (all denied, no data)':'ISOLATION FAILED - stop and report');
})();
```
**Pasa:** 6 filas con 401/403/404 y `leaksData:false`, y `ISOLATION OK`. Captura de la tabla y de la identidad de B con la hora. **Si falla, se para**: no se hace B3 ni nada más y el agente revisa el estado de A (solo lectura).

**B3 · Pruebas de ESCRITURA: no se hacen con ninguna propuesta verificada existente, ni con `verify`** (`verify` también escribe —verificación y evento de ciclo de vida— si el aislamiento fallara y el registro estuviera en `APPLIED`). Solo se hacen si B2 pasó **y** el propietario autoriza expresamente un **registro desechable** con estas condiciones:
1. Un registro creado para la prueba (no uno existente), en estado conocido `READY`, en un proyecto desechable de la organización A; el agente anota `id`, estado y hash de sus campos **antes**.
2. Una única petición de escritura de B sobre ese registro (`approve`). Esperado: 404 y el registro sin cambios.
3. **Plan de recuperación si el aislamiento fallara:** el registro pasaría a `APPROVED`; el propietario (sesión A, interfaz) pulsa «Reabrir» para volver a `READY`; el agente compara el hash de los campos de negocio con el anotado; el hecho se registra como fallo de aislamiento crítico y se detiene todo.
4. Ningún otro registro (ni `c439438e` ni los VERIFIED) interviene. Hoy **no existe** un registro desechable así: crearlo requiere un bloqueo abierto (el veredicto actual no tiene) y una autorización aparte; **B3 queda sin ejecutar** hasta entonces.

**B4 · Después, con la sesión A (agente, solo lectura):** los hashes de todos los registros de Safe Fix siguen idénticos a los anteriores a la aceptación; `e2fa01eb` sigue `VERIFIED` con `updatedAt` 11:31:52 UTC.

**B5 · MCP con B (fase 2, opcional):** exige que B conecte su propio cliente MCP (consentimiento OAuth como B) y repetir `can_i_deploy` sobre el proyecto de A. Se decide aparte porque añade una autorización de cliente.
