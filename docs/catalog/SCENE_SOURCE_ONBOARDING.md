# Onboarding de proveedores de escena

**Audiencia:** humano que va a incorporar un proveedor real de venta o alquiler
(mobiliario, floristería, estructuras de altar, iluminación ambiental, etc.)
al catálogo de escenas de boda.

**Referencia normativa:** `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`,
secciones 6 ("Procedencia y verdad comercial"), 8.2 ("Extensión no
destructiva de PostgreSQL") y 8.3 ("Incorporación de proveedores"). Este
documento es la versión operativa de esa sección — la lista de requisitos de
abajo es la MISMA lista, en el mismo orden, que
`SUPPLIER_ONBOARDING_REQUIREMENTS` en
`src/lib/rag/sources/scene-source-adapter.ts`. Si algún día divergen, ese
archivo de código es la fuente de verdad ejecutable; este documento debe
actualizarse para volver a coincidir.

---

## 0. Antes de empezar — qué NO es esto

- **Esto no es un adaptador implementado.** `src/lib/rag/sources/scene-source-adapter.ts`
  define el CONTRATO (`SceneSourceAdapter`) que un adaptador real debe
  cumplir. Construir el adaptador concreto de un proveedor específico
  (llamadas HTTP a su API, parseo de su feed CSV, etc.) es trabajo aparte,
  fuera del alcance de esta tarea.
- **El catálogo demo NUNCA se promueve a producción.** `src/lib/catalog-data.ts`
  + SQLite (14 productos demo, ver Tarea 00.3 /
  `src/lib/generacion/provenance.ts`) es exclusivamente un *fixture* de
  evaluación y desarrollo local. No tiene proveedor real, vigencia,
  modalidad comercial ni fotos con licencia de uso comercial verificada.
  `classifyNonCommercialProduct` (en `provenance.ts`) ya bloquea, en
  producción, que un producto de esa fuente se use como línea comercial
  (compra, alquiler o plan verificable) — solo puede aparecer como
  `editorial_reference` o `test_only`. Onboardear un proveedor real NUNCA
  significa "promover" filas del seed: significa crear filas nuevas en
  `catalog_sources` / `catalog_commercial_offers` que apunten a datos reales
  de ese proveedor.
- **Nada de esto autoriza inventar disponibilidad o precio.** Si un dato no
  se puede verificar con el proveedor, la oferta correspondiente se deja como
  `QUOTE_REQUIRED` (o directamente no se crea), nunca se completa con un
  supuesto.

---

## 1. Checklist exacta de incorporación (sección 8.3)

Para **cada** proveedor nuevo (o cada renovación de verificación de uno
existente) se exige lo siguiente. Las columnas "Aplica a" marcan si el
requisito es universal o solo para alquiler; "Dónde vive" indica en qué
tabla/columna de `scripts/migrations/012_scene_catalog.sql` queda el dato.

| # | Requisito | Aplica a | Dónde vive |
|---|---|---|---|
| 1 | **Identidad y autorización de uso** — quién es el proveedor y evidencia de que autorizó usar su catálogo/precios aquí (contrato, correo, cuenta verificada). | Todos | `catalog_sources.provider_name`, `catalog_sources.commercial_policy`, `catalog_sources.status = 'active'` solo después de verificar |
| 2 | **Catálogo o feed reproducible** — un origen consultable de nuevo (API, feed versionado, hoja con fecha), nunca una lista verbal. | Todos | `catalog_commercial_offers.snapshot_id` (identifica cada corrida de sincronización) |
| 3 | **Precio o estado `QUOTE_REQUIRED`** — cada oferta trae un precio real o se marca explícitamente como "requiere cotización". | Todos | `catalog_commercial_offers.status`, `catalog_price_components` |
| 4 | **Disponibilidad/stock cuando aplique** — estado real de disponibilidad, nunca "disponible" por defecto. | Todos | `catalog_commercial_offers.availability_status` + `availability_checked_at` |
| 5 | **Fecha de vigencia** — desde/hasta cuándo el precio/oferta es válido. | Todos | `catalog_commercial_offers.valid_from` / `valid_until` |
| 6 | **Ciudad/área de servicio y reglas de período** — cobertura geográfica siempre que sea limitada; para alquileres, además período mínimo y su unidad (evento/día). | Todos (área de servicio); alquiler (reglas de período) | `catalog_commercial_offers.service_area_*`, `rental_minimum_periods`, `rental_period_unit` |
| 7 | **Depósito, transporte, instalación y qué incluye el precio base** — cada cargo de servicio como componente separado, nunca mezclado con el precio de producto. | Todos | `catalog_price_components` (`price_type='service_fee'`, `component_kind` en `deposit/transport/installation/labor`) |
| 8 | **Dimensiones y condiciones de montaje** — medidas físicas y compatibilidad de instalación cuando el proveedor las tenga. | Todos | `catalog_product_spatial` |
| 9 | **Fotos utilizables como referencia** — al menos una imagen con licencia/autorización de uso. | Todos | `CatalogItemV3.media_refs` (`role: "identity"`) |
| 10 | **Proceso de despublicación** — cómo y cuándo el proveedor deja de ofrecer algo, y cómo eso llega al sistema. | Todos | `SceneSourceAdapter.unpublishOffer(...)` + `catalog_source_audit` |

La misma lista, con la redacción completa de cada requisito, está en
`SUPPLIER_ONBOARDING_REQUIREMENTS` (`src/lib/rag/sources/scene-source-adapter.ts`)
— `supplierRequirementsFor("catalog_sale" | "catalog_rental")` filtra
automáticamente los requisitos que no aplican a venta pura.

---

## 2. Flujo de incorporación paso a paso

1. **Verificar identidad y autorización** (requisito 1). Registrar una fila
   en `catalog_sources` con `status = 'pending_verification'` hasta tener
   evidencia real; solo entonces pasar a `status = 'active'`.
2. **Confirmar que el catálogo/feed del proveedor es reproducible**
   (requisito 2) — si el proveedor solo puede compartir precios por
   WhatsApp o llamada, esa fuente NO califica todavía para sincronización
   automática; puede arrancar como `QUOTE_REQUIRED` verificado manualmente,
   pero cada verificación manual también necesita su propio `snapshot_id` y
   fecha, registrados igual que un sync automático.
3. **Implementar (o reutilizar) un `SceneSourceAdapter`** para ese proveedor
   (`src/lib/rag/sources/scene-source-adapter.ts`), que sepa producir
   `CommercialOfferV1` válidos vía `listOffers(...)` y validarlos con
   `validateSyncedOffer(...)`. Cualquier registro del proveedor que no se
   pueda convertir en una oferta válida (falta precio, falta identidad,
   etc.) debe aparecer en `SceneSourceOfferSyncResult.rejected` con su
   razón — nunca completarse con un valor supuesto.
4. **Persistir** los `CatalogItemV3` y `CommercialOfferV1` resultantes en
   `catalog_items` / `catalog_commercial_offers` / `catalog_price_components`
   (migración `012_scene_catalog.sql`), y las funciones de escena
   correspondientes en `catalog_product_capabilities` (con evidencia y
   confianza reales — ver Tarea 03.1, `scripts/enrich-scene-capabilities.ts`).
5. **Auditar cobertura** con `npx tsx scripts/audit-scene-catalog.ts --recipe
   <recipeId> --require-<perfil>` para confirmar qué slots de una receta ya
   quedaron cubiertos por este proveedor y cuáles siguen en brecha.
6. **Revalidar periódicamente.** Un cambio de precio, disponibilidad,
   modalidad o snapshot del proveedor invalida `selection_hash` / `quote_hash`
   de cualquier plan que ya lo hubiera seleccionado (sección 6.4) — la
   revalidación debe volver a pasar por los pasos 3–4, nunca reutilizar en
   silencio el dato anterior.
7. **Despublicar cuando el proveedor deje de ofrecer algo** — llamar a
   `SceneSourceAdapter.unpublishOffer(offerId, reason)`, que deja la oferta en
   `status = "UNAVAILABLE"` (nunca borra la fila) y registrar la acción en
   `catalog_source_audit` con `action = 'deactivated'`.

---

## 3. Cómo saber si ya se puede dejar de "solo producir globos"

Ejecutar, para la receta que interese:

```bash
npx tsx scripts/audit-scene-catalog.ts --recipe wedding_ceremony_garden@1 --require-balanced
```

- **Código de salida 0:** todos los slots obligatorios del perfil pedido
  tienen al menos una oferta comercial verificada (o, en el caso de
  `focal_structure_surface`/otros slots con `venue_existing` en
  `allowed_sources`, el propio evento aportó esa evidencia — el script solo
  audita catálogo, no eventos concretos).
- **Código de salida distinto de cero:** el reporte impreso lista, por cada
  slot obligatorio sin cobertura, si (a) ningún producto del catálogo está
  siquiera etiquetado con esa función, o (b) sí hay productos etiquetados
  pero ninguno tiene oferta verificada — y en ambos casos, qué tipo de fuente
  falta (venta, alquiler, o evidencia de `venue_existing` no auditable desde
  catálogo). Ese es el estado esperado mientras mobiliario, floristería,
  estructuras de altar e iluminación ambiental sigan sin proveedor real
  (diagnóstico de la Ola 0, sección 2.2 del plan) — no un error del script.

El objetivo de este documento es que ese código distinto de cero deje de
aparecer, receta por receta, a medida que se incorporan proveedores reales
siguiendo la checklist de la sección 1 — nunca maquillándolo con datos del
catálogo demo o con fuentes sin verificar.
