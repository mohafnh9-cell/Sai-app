# Observación breve para cerrar V1 (solo criterios abiertos; no se repite el recorrido)

Tiempo total estimado del propietario: 25–35 min repartidos en tres bloques. Nada de esto lanza scans ni escribe datos de producción salvo donde se indica (`verify` inocuo, ver B3).

## Cómo registrar (común)
- **Grabación local, la inicia el propietario:** macOS `⌘⇧5` → *Grabar la parte seleccionada* (incluir la ventana del navegador **y** un reloj UTC visible: abrir `https://time.is/UTC` en una ventana pequeña al lado). Guardar el archivo con el nombre del criterio (`O1.mov`…). No hace falta enviarlo entero: bastan capturas con la hora.
- Consola (solo para O1): `F12 → Console`, marcar *Preserve log*, recargar con `⌘⇧R`. Copiar o capturar **cualquier línea roja**, o decir «sin rojos».
- Regla: si algo no se ve, se escribe «no observado». No se reconstruye a partir de capturas posteriores.

## O1 · Journey en la página real tras #77 (2–3 min)
1. Abrir `/projects/2005075a-fc80-4bcc-a080-52bf8195cf2f/journey` en producción, consola abierta y *Preserve log*.
2. `⌘⇧R`. Esperar 5 s. Capturar la pantalla con los hitos (deben llevar fecha `AAAA-MM-DD`) y la consola.
- **Pasa:** sin `Minified React error #418` ni `Hydration failed`; hitos con fecha y commit. **Falla:** cualquier línea roja → pegarla completa y parar.

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

**B1 · URLs directas con la sesión B (cada una con captura; esperado: 404 o redirección, sin datos de A):**
`/projects/2005075a-fc80-4bcc-a080-52bf8195cf2f/mission-control`, `/journey`, `/scans`, y `/scanner-results/e5aaf268-5061-4132-91ef-925cd415c828`.

**B2 · API con la sesión B (consola, una sola ejecución, 8 peticiones; las dos de escritura son inocuas: `verify` solo actúa sobre un registro APPLIED y ambos están en otro estado):**
```js
(async()=>{
  const P='2005075a-fc80-4bcc-a080-52bf8195cf2f', VER='e2fa01eb-ac10-476a-9f51-76a92c2e77a6', RDY='c439438e-c947-4c42-bc89-2b80a8334860', SCAN='e5aaf268-5061-4132-91ef-925cd415c828';
  // Solo `verify` en las escrituras: no se usa approve/reopen porque cambiarían un registro si el aislamiento fallara.
  const reqs=[['GET',`/api/projects/${P}/safe-fixes`],['GET',`/api/projects/${P}/safe-fixes/${VER}`],['POST',`/api/projects/${P}/safe-fixes/${VER}`,{action:'verify'}],
    ['POST',`/api/projects/${P}/safe-fixes/${RDY}`,{action:'verify'}],['GET',`/api/brain/project/${P}`],['GET',`/api/projects/${P}/mission-control`],
    ['GET',`/api/projects/${P}/analysis-runs`],['GET',`/api/repositories/${P}/scans/${SCAN}`]];
  const rows=[];
  for(const [m,u,b] of reqs){
    const r=await fetch(u,{method:m,credentials:'same-origin',cache:'no-store',headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):undefined});
    const t=await r.text();
    rows.push({request:`${m} ${u.replace(P,'P').replace(VER,'VER').replace(RDY,'RDY').replace(SCAN,'SCAN')}`,status:r.status,leaksData:/lifecycleState|proposalCommitSha|productionVerdict|currentVerdict|"verdict"|safeFixes|"runs"/.test(t),body:t.slice(0,70)});
  }
  console.table(rows);
  console.log(rows.every(x=>[401,403,404].includes(x.status)&&!x.leaksData)?'ISOLATION OK (all denied, no data)':'ISOLATION FAILED - stop and report');
})();
```
**Pasa:** 8 filas con 401/403/404 y `leaksData:false`, y la última línea `ISOLATION OK`. Captura de la tabla **y** de la identidad de B con la hora.

**B3 · Después, con la sesión A (agente, solo lectura):** los registros de Safe Fix y sus hashes siguen idénticos a los anteriores a la aceptación; el registro `e2fa01eb` sigue VERIFIED con el mismo `updatedAt` (11:31:52 UTC).

**B4 · MCP con B (fase 2, opcional):** exige que B conecte su propio cliente MCP (consentimiento OAuth como B) y repetir `can_i_deploy` sobre el proyecto de A. Se decide aparte porque añade una autorización de cliente.
