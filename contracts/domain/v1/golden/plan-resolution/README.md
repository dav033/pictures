# Vectores dorados de resolución de plan

Escenarios compartidos por los dos resolutores comerciales de Plan 1.0: el
TypeScript (`src/lib/plan/resolver.ts` + `estimacion.ts` + `cotizacion/motor.ts`)
y el Python (`services/ai-api/app/plan.py`). Sirven para dos cosas distintas:

1. **Bloqueo de regresión de cada backend**, para que un cambio de aritmética
   comercial no pase inadvertido.
2. **Paridad entre backends**, que es la puerta para poder activar
   `PYTHON_BACKEND_ENABLED`.

Ninguna de las dos necesita base de datos ni red: el catálogo del vector entra
por un doble del `Pool` en TypeScript y por un `CatalogPlanStore` en memoria en
Python, con las mismas claves de fila.

## Forma de un vector

| Campo | Qué es |
| --- | --- |
| `name`, `description` | Identificación del escenario. |
| `catalog_snapshot_id` | Snapshot publicado que el vector simula. |
| `catalog_rows` | Filas de catálogo tal y como las leen los dos resolutores. Cada fila lleva `source_snapshot_id` igual al snapshot y `currency: "COP"`. |
| `allowlist` | Allowlist same-turn: producto → variantes que el modelo vio. |
| `lora_variant_ids` | Cobertura del dataset LoRA activo, o `null`. |
| `plan` | El Plan 1.0 declarativo de entrada. |
| `expected` | Salida TypeScript en las formas que consume la UI (`PlanResuelto` sin `approval_token`/`request_id`, `DesignMaterialEstimate`, `Cotizacion`). |
| `expected_python` | Payload `plan-resolution-result.v1` que produce el servicio Python. |

Los dos bloques `expected` se **generan**, no se escriben a mano.

## Comandos

```bash
# Bloqueo de regresión TypeScript (entra en npm run plan:test)
npm run plan:test-paridad

# Regenerar expected tras un cambio intencional de TypeScript
npx tsx --conditions=react-server scripts/test-paridad-plan-python.ts --update

# Bloqueo de regresión Python
cd services/ai-api && uv run --extra test python -m pytest tests/test_plan_parity.py

# Regenerar expected_python tras un cambio intencional de Python
cd services/ai-api && PARIDAD_ACTUALIZAR=1 uv run --extra test python -m pytest tests/test_plan_parity.py

# Paridad entre backends: la puerta de activación (13/13 el 2026-09-14).
npm run plan:test-paridad-python
```

La comparación de paridad se hace en TypeScript a propósito: la respuesta Python
pasa por el mapper de producción (`src/lib/plan/python-mapper.ts`), así que se
comparan exactamente las formas que ve la UI y desaparece el ruido de `12` frente
a `12.0` (el JSON de Python se parsea a números de JavaScript).

## Fuera de la comparación de paridad

Solo dos campos, cada uno con su razón, y ninguno queda sin comprobar: el runner
verifica aparte que los dos backends los producen bien formados.

- `plan_hash`: el [ADR 0006](../../../../docs/architecture/decisions/0006-procedencia-firmada-del-plan.md)
  lo define por backend. Un plan se re-resuelve con el backend que lo produjo, así
  que los dos hashes no tienen que coincidir; lo que sí tiene que coincidir es
  todo el valor comercial.
- `merma_log`: texto para una persona, no un valor comercial.

## Divergencias de 2026-09-11 (resueltas)

El 2026-09-11 `npm run plan:test-paridad-python` fallaba en 4 de los 5 vectores
de entonces por tres causas. Quedan registradas como historia; el estado vigente
se comprueba ejecutando el comando, no leyendo esta sección.

1. `plan_resuelto.alternativas`: TypeScript proponía 1 alternativa comercial y
   Python 0. El resolutor Python ya calcula alternativas.
2. `material_estimate.totals.waste_only_savings_cop`: en el vector de paquete
   pequeño, TypeScript reportaba 1500 COP de ahorro por merma y Python 0. Python
   ya lo calcula por línea de compra.
3. `cotizacion.lineas[].color`: Python transportaba el color de la compra y
   `cotizarPlan` lo dejaba sin definir.

Resuelto el 2026-09-14: el vector `09` destapó que las dos implementaciones
aplicaban ese ahorro también a líneas no geométricas (el telón daba 20000 COP).
`MERMA` modela reventones de globos, así que ahora solo cuentan compras de globo
en los dos backends y el vector `09` espera `0`. Decisión en `decision-log.md`
(2026-09-14).

## Cobertura A5

- `06-a5-presupuesto-excedido.json`: techo por debajo del total, alternativas y
  estado `PRESUPUESTO_EXCEDIDO`.
- `07-a5-presupuesto-verificado.json`: techo por encima del total y estado
  `VERIFICADO`.
- `08-a5-paquete-extra-merma.json`: el sobrante natural no cubre la reserva y
  obliga a marcar un paquete adicional para merma.
- `09-a5-linea-no-geometrica.json`: mezcla un globo con un telón para cubrir
  `special_elements` y el coste fijo no geométrico de las alternativas. El telón
  no recibe merma ni ahorro por merma: `material_estimate.totals.waste_only_savings_cop`
  es `0`, igual que `plan_resuelto.totales.waste_only_savings_cop`.

## Geometría

- `10-estructura-oficial.json` y `11-geometria-estructuras-oficiales.json`:
  variantes oficiales (banda afinada de los asimétricos, aro circular).
- `12-semiarco-alto.json`: el eje del semiarco es un cuarto de elipse
  (a = ancho, b = alto); un semiarco de 1,2 × 2,2 m lleva más globos que una
  columna de 1,8 m. Cubre también la variante asimétrica y un `largo_m`
  que el chat usa como profundidad: con ancho y alto no cambia el eje.
- `13-mismo-color-dos-productos.json`: dos materiales del mismo color (azul
  reflex y azul pastel) en una estructura. Cada línea del despiece conserva su
  material por posición; antes el resolver buscaba por color y compraba solo el
  primero, sin avisar.
