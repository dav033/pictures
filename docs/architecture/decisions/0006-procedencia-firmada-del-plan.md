# ADR 0006: Procedencia comercial firmada del plan

- Estado: aceptado
- Fecha: 2026-09-11
- Decisores: equipo del proyecto
- Relacionado: [ADR 0005](0005-python-authority-cutover.md)

## Contexto

El resolutor de planes de Python (`services/ai-api/app/plan.py`, expuesto en
`POST /internal/v1/plan/resolve`) necesita dos entradas de dominio que el
resolutor TypeScript nunca tuvo que transportar:

- `catalog_snapshot_id`: el snapshot publicado del catálogo que es autoritativo
  para precios, stock y variantes.
- `allowlist`: la restricción *same-turn*, es decir, las variantes que el modelo
  realmente recibió en la búsqueda de ese turno. Python no puede elegir una
  variante que el modelo no vio.

Esos dos valores se conocen en el turno de chat (`estado.ragCatalogSnapshotId` y
`estado.ragVariantIdsRecuperados` en `src/lib/ia/registro-herramientas.ts`), pero
se perdían al terminar la conversación. Las peticiones posteriores
—`POST /api/generate` y `POST /api/plan-editar`— llegan del navegador con el
plan ya resuelto y reconstruían por su cuenta una whitelist a partir del propio
plan. Ninguno de los dos valores podía leerse del cuerpo de la petición: un
`catalogSnapshotId` o una allowlist enviados por el navegador permitirían
resolver contra un catálogo distinto del que aprobó el cliente.

El token de aprobación existente (`src/lib/plan/aprobacion.ts`) ya cruzaba esa
frontera firmado con HMAC, pero solo llevaba versión, `planHash`, `requestId` y
expiración.

## Decisión

La procedencia comercial del plan viaja **firmada dentro del token de
aprobación** (payload `v: 2`), no en el cuerpo de la petición ni en una tabla
nueva. El token incorpora:

- `backend`: `"next"` o `"python"`, el resolutor que produjo ese `planHash`.
- `catalogSnapshotId`: el snapshot publicado del turno, o `null`.
- `allowlist`: la allowlist same-turn como `[{ product_id, variant_ids }]`.

Reglas que acompañan la decisión:

1. **Un plan se re-resuelve con el backend que lo produjo.** Si ese backend ya
   no está disponible (kill switch, flag apagado o snapshot ausente), la
   petición falla en cerrado con un error explícito que pide volver a solicitar
   la propuesta. Nunca se re-resuelve con el otro backend: el hash podría no
   coincidir y se estaría aprobando un plan distinto del que vio el cliente.
2. **La puerta de aprobación no cambia.** `verificarTokenAprobacion` sigue
   exigiendo el `planHash` realmente resuelto en el servidor.
   `abrirContextoPlan` lee la procedencia *antes* de tener ese hash y por eso
   deliberadamente no lo liga; todo llamador debe seguir verificando después.
3. **Python nunca ve el token.** Recibe `catalog_snapshot_id` y `allowlist` como
   datos de dominio validados. El token es un mecanismo temporal de Next.
4. **No hay fallback implícito.** `resolverPlanConBackend`
   (`src/lib/plan/resolver-backend.ts`) es el único lugar que decide y ejecuta
   el backend; si Python falla, el error sube y el llamador decide qué ve el
   cliente. `PYTHON_BACKEND_KILL_SWITCH` es el rollback.
5. **El resultado de Python no se recalcula.** Python devuelve `plan_resuelto`,
   `material_estimate` y `quote` juntos; Next solo los mapea
   (`src/lib/plan/python-mapper.ts`). Volver a ejecutar `estimateFromPlan` o
   `cotizarPlan` sobre un resultado Python crearía un segundo dueño de la misma
   regla comercial.

Los tokens `v: 1` ya emitidos siguen siendo válidos y se leen como
`backend: "next"`, sin snapshot ni allowlist: el camino TypeScript deriva su
propia whitelist del plan, exactamente como antes.

## Alternativas descartadas

- **Enviar snapshot y allowlist en el cuerpo de la petición.** Es precisamente
  el dato que no se puede confiar al navegador; una allowlist ampliada por el
  cliente deja que el resolutor elija variantes que el modelo nunca vio.
- **Persistir el contexto en PostgreSQL con clave `plan_hash`.** Es la opción
  correcta a largo plazo y sigue abierta, pero exige una tabla nueva y una
  migración contra la base gestionada; el token firmado da la misma garantía de
  integridad sin tocar el esquema y sin bloquear el corte por capacidad.
- **Re-derivar la allowlist desde el plan en cada petición.** Es lo que hace hoy
  el camino TypeScript, pero no es la restricción same-turn: acepta cualquier
  variante presente en el plan, que es un conjunto distinto —y más amplio— que
  el que el modelo vio.
- **Caer a TypeScript cuando Python falla.** Escondería un corte roto detrás de
  un plan que ningún operador verificó, y los hashes de ambos resolutores no
  están todavía demostrados idénticos.

## Consecuencias

- El token crece con la allowlist del turno. Se acota su tamaño al leerlo y su
  payload se valida en runtime aunque esté firmado, porque llega del navegador.
- Un plan propuesto con Python deja de poder editarse o generarse si se activa
  el kill switch. Es el comportamiento buscado: el rollback invalida propuestas
  en vuelo en vez de resolverlas con otras reglas.
- Mientras el camino TypeScript siga activo, `crearTokenAprobacion` emite un
  token sin procedencia. Esa función desaparecerá cuando Python sea el único
  resolutor.
- El token es un mecanismo de transición. Cuando Python sea dueño de la
  aprobación, la procedencia deberá vivir en su propio estado durable y el token
  se retira junto con el selector de backend.

## Secuencia y rollback

1. El turno de chat resuelve con el backend seleccionado y emite el token con la
   procedencia (`confirmar_plan_decoracion`).
2. `/api/generate` y `/api/plan-editar` abren la procedencia, re-resuelven con el
   mismo backend, comparan el hash y solo entonces verifican la aprobación.
3. Rollback por capacidad: `PYTHON_BACKEND_KILL_SWITCH=true` fuerza Next para
   las propuestas nuevas; las propuestas Python en vuelo fallan en cerrado con
   un mensaje que pide volver a pedirlas.
