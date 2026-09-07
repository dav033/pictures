# Fase 2 — resolución comercial

Estado: cerrada localmente.

## Entregado

- `resolverPlan` acepta Plan 1.0 y Plan 1.1.
- Esculturas resuelven BOM exacto por `variant_id`, unidades por instancia y repeticiones.
- Props se resuelven como elementos independientes, con origen `prop`.
- Estructuras, esculturas y props consolidan compras por variante.
- Merma aplica solo a líneas físicas de globo.
- Pareja `product_id`/`variant_id`, allowlist same-turn, precio y paquete se validan contra PostgreSQL/catálogo recuperado.
- Se propagan SKU fuente, snapshot, variante fuente, inventario y evidencia de unidades de paquete.
- Hash resuelto incluye plan, BOM, props y compra.
- `cajasDeEstructuras` cubre ocho ubicaciones nuevas 1.1.
- Cotización expone `productId` y `elementosOrigen`.
- Script de deploy sincroniza `data` versionada sobre `demo-decoracion-data` sin borrar archivos persistentes.

## Fixture comercial

Araña 1.1 + guirnalda + dos props:

- BOM repetido: 48 unidades de escultura.
- Compra compartida guirnalda/escultura: 41 globos.
- Prop calabaza: 3 unidades, 2 paquetes.
- Total fixture: `41.000 COP`.
- Cambiar pata o prop cambia compra, total y `plan_hash`.
- Variante no recuperada y pareja producto-variante cruzada quedan sin cobertura.

## Verificaciones

- `npx tsc --noEmit`: PASS.
- `npm run plan:test`: PASS completo.
- `npx eslint scripts/test-resolver-plan.ts scripts/test-plan-pg.ts src/lib/plan/resolver.ts src/lib/plan/resuelto.ts src/lib/plan/ubicaciones.ts src/lib/cotizacion/motor.ts`: PASS.
- `npm run ia:test-plan-lora-e2e`: PASS.
- `npm run plan:test-pg`: PASS contra PostgreSQL real; producto `7109582225601`, 7 compras, `84.750 COP`.
- SSH `n8n-maros`: servicio remoto responde HTTP 200.
- Sin llamadas a fal.ai. Sin reentrenamiento LoRA.
- Sin commit ni push.

## Deploy

`n8nmaos` no resuelve DNS. Alias configurado y usado: `n8n-maros`.

Se instaló `/home/ec2-user/deploy-demo-decoracion.sh`, pasó `bash -n`, y se sincronizó una vez el volumen persistente. El contenedor quedó corriendo; no se reinició ni se desplegó código local no publicado.

El stash original se conserva porque `stash pop` encontró conflicto de imports; su contenido quedó integrado manualmente.
