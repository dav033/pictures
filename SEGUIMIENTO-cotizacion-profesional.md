# Seguimiento: cotización profesional, animaciones y login en dev

Rama `feat/cotizacion-profesional`, creada desde `origin/main` en `94ad16b`
(merge de `feat/guirnaldas`, 2026-09-28). Este documento existe para el merge
con otras ramas: dice exactamente qué archivo se tocó, qué bloque y por qué, y
cómo resolver cada conflicto probable sin perder comportamiento de ninguno de
los dos lados.

## 1. Qué cambia para el usuario

1. **Precio al cliente.** Al principio de cada propuesta hay un panel que
   parte de los materiales de la cotización del plan (productos, bolsas y
   precio de catálogo) y deja que el decorador agregue **sus** costos: mano de
   obra, equipos y transporte (alquileres incluidos), costos indirectos y un %
   de utilidad. Nada viene precargado salvo el precio de catálogo de cada
   bolsa, que el decorador puede cambiar (el precio de su distribuidor). Muestra
   el precio sugerido al cliente y el margen real. Sigue la plantilla de
   cotización de Sempertex (hoja «LLENO»: 268.775 COP con 30 %).
2. **Sin cotización final aparte.** Con una propuesta, al aprobarla ya no
   aparece la tarjeta «Tu cotización final» debajo; el precio vive en la
   propuesta. La tarjeta de cotización solo se muestra sin propuesta (la
   herramienta `cotizar`).
3. **Escáner de la foto.** Mientras se analiza la foto de referencia, la foto
   arranca gris y oscura, un láser la barre de arriba abajo y de vuelta y
   revela los colores a su paso, con rejilla móvil, visor, destellos, chip
   «Escaneando N %» y barra de avance. Los textos rotan («Buscando las piezas
   de globos…», «Midiendo proporciones…»…).
4. **Recuadro de pieza detectada.** Efecto «lock-on»: esquinas que se cierran
   sobre la pieza, marco con brillo morado y un reflejo que la cruza una vez;
   etiqueta tipo vidrio con número en degradado.
5. **Espera de la imagen.** Un arco de globos se construye solo en los colores
   de la propuesta (guía punteada, globos que se inflan desde las bases hacia la
   cima, globo fantasma en el siguiente lugar). El avance es por tiempo y nunca
   completa el arco antes de que llegue la imagen: el proveedor no informa
   progreso.
6. **Ancho.** Desde 1200 px, la columna del chat pasa de 47,5rem a 60rem
   (fuera de la pantalla de inicio); el texto del asistente conserva 47,5rem.
   La tarjeta de la propuesta y la de cotización dejaron de limitarse a
   `max-w-190`.
7. **Login en dev.** `next dev` no pide contraseña. Ver §4.

## 2. Archivos nuevos (no deberían chocar)

| Archivo | Qué es |
|---|---|
| `services/ai-api/app/cotizacion_profesional.py` | Único dueño del cálculo (`cotizacion-profesional.v1` → `-result.v1`). Pesos enteros, `ROUND_HALF_UP` por línea, utilidad como recargo sobre el costo, margen = utilidad / precio. Sin catálogo, sin base, sin efectos. |
| `services/ai-api/tests/test_cotizacion_profesional.py` | 20 pruebas: la hoja «LLENO» da 268.775; precio por bolsa editado; redondeos; entradas inválidas; endpoint 200/422/403. |
| `src/lib/cotizacion/profesional.ts` | Esquemas Zod de la frontera (entrada y resultado), sin `server-only`. Límites iguales a los del modelo de Python. |
| `src/lib/cotizacion/borrador-profesional.ts` | Lectura de lo que escribe el decorador (pesos «12.000», decimales con coma), qué filas se envían, materiales desde la `Cotizacion`, y `pedirCotizacionProfesional` (fetch). No suma ni multiplica nada. |
| `src/app/api/cotizacion-profesional/route.ts` | Ruta de Next: sesión, cuerpo estricto (400), llama a Python con deadline corto (`EDICION_PYTHON_DEADLINE_MS`), devuelve el resultado validado. Mismo patrón que `plan-armado-guirnalda`. |
| `src/components/cotizacion/CotizacionProfesional.tsx` | El panel «Precio al cliente». Calcula siempre (400 ms después de la última tecla, con `AbortController`). Borrador en `sessionStorage` con clave `cotizacion-profesional:<id del mensaje>`. Prop `incrustada` para ir dentro de la propuesta. |
| `src/components/referencia/EscanerFoto.tsx` | Overlay del escáner (recibe `src` de la foto). |
| `src/components/propuesta/ConstruccionArco.tsx` | SVG del arco que se construye; exporta `globosColocados(segundos)`. |
| `scripts/test/test-cotizacion-profesional.ts` | Lectura del borrador + ruta con `fetch` simulado (scope, deadline, 400, 502, 401). |
| `SEGUIMIENTO-cotizacion-profesional.md` | Este documento. |

## 3. Archivos existentes modificados (aquí estarán los conflictos)

### `services/ai-api/app/main.py` (+23)
- Import nuevo después de `from app.armado_bouquet import DISPOSICIONES as DISPOSICIONES_BOUQUET`:
  `from app.cotizacion_profesional import (COTIZACION_PROFESIONAL_SCOPE, CotizacionProfesionalRequest, cotizar_profesional)`.
- Ruta nueva `POST /internal/v1/plan/cotizacion-profesional` inmediatamente
  **después** de `plan_armado_guirnalda` y antes de `ia_intent_parse`, scope
  `plan.cotizacion_profesional`, vía `_handle_operational_request`.
- Conflicto probable: otra rama que agregue rutas en el mismo lugar. Resolver
  conservando ambas rutas; no hay dependencia de orden.

### `src/lib/ia/nucleo/python-adapter.ts` (+40)
- Import de `@/lib/cotizacion/profesional` después del de `edicion-esquemas`.
- Constantes `PYTHON_COTIZACION_PROFESIONAL_PATH` y `_SCOPE` justo debajo de
  `PYTHON_PLAN_ARMADO_GUIRNALDA_SCOPE`.
- `PythonCotizacionProfesionalInput` y `llamarPythonCotizacionProfesional`
  justo **antes** de `export function pythonErrorBody`. Valida el resultado y
  que las líneas de materiales vuelvan en el mismo orden (si no, 502).
- Conflicto probable: otras operaciones nuevas en los mismos puntos. Conservar
  ambas.

### `src/app/page.tsx` (+6 −5)
- Import de `CotizacionProfesional` debajo del de `TarjetaCotizacion`.
- En `<TarjetaPlanDecoracion …>` se agregó la prop
  `precioCliente={m.cotizacion ? <CotizacionProfesional cotizacion={m.cotizacion} clave={m.id} incrustada /> : undefined}`
  (después de `loraMode`).
- La condición de `<TarjetaCotizacion>` pasó de
  `m.cotizacion && (!m.plan || planAprobadoHash === m.plan.plan_hash)` a
  `m.cotizacion && !m.plan`, y se quitó `final={Boolean(m.plan)}`. **Esto es
  lo que elimina la cotización final.** Si la otra rama toca este bloque,
  mantener `!m.plan` salvo que se decida volver a mostrarla.

### `src/components/TarjetaPlanDecoracion.tsx` (+6 −3)
- `type ReactNode` en el import de React.
- Prop nueva `precioCliente?: ReactNode` al final de `Props` y en la
  desestructuración de la firma.
- Se renderiza `{precioCliente && <motion.div variants={ENTRADA_CASCADA} className="px-4 pt-4 @xl:px-5.5">…</motion.div>}`
  justo después del cierre del bloque de cabecera (título, resumen, «Basada en
  tu foto») y antes del comentario de `concepto.descripcion`.
- `max-w-190` quitado del `className` de la `motion.section` raíz.
- Conflicto probable: la firma (una línea larga) y el `className` raíz. Unir
  las props de ambos lados.

### `src/components/TarjetaCotizacion.tsx` (+1 −1)
- Solo `max-w-190` quitado del `className` raíz. La prop `final` sigue
  existiendo (la usan las pruebas); `page.tsx` ya no la pasa.

### `src/components/referencia/AnalisisFoto.tsx` (+67 −21)
- Import de `EscanerFoto`.
- `RecuadroPieza` reescrito (lock-on, esquinas `ESQUINAS_PIEZA`, reflejo,
  etiqueta vidrio). **La posición de la etiqueta (`posicion.*`,
  `etiquetas-analisis.ts`) no cambió.**
- Nuevos `PASOS_ANALISIS` y `FraseAnalisis` (frases rotativas) entre
  `RecuadroPieza` y `AnalisisFoto`; el `<p key="mirando">` usa
  `<FraseAnalisis titulo={vista.titulo} />` en vez de `{vista.titulo}`.
- El `motion.div key="escaneo"` anterior se reemplazó por
  `{estado === "analizando" && <EscanerFoto key="escaneo" src={src} />}`
  (ahora también con reducir movimiento).
- Opacidad del velo en `analizando`: 0.75 → 0.1 (el escáner ya oscurece).
- Conflicto probable si otra rama cambia `RecuadroPieza` o el escaneo: quedarse
  con la lógica de datos del otro lado y reaplicar solo las clases/animaciones.

### `src/components/propuesta/CargaImagen.tsx` (+12 −27)
- El globo SVG (`const color`, `const globo`) se eliminó; ambos casos
  (`conMarco` y sin marco) usan `ConstruccionArco`. `faseCargaImagen` y la fila
  de texto/cancelar no cambiaron.

### `src/app/globals.css` (+173)
- Bloque nuevo `@media (min-width: 1200px)` justo después de `.app-columna`
  (60rem fuera del inicio; `.msg-asistente` 47,5rem).
- Al final del archivo, dos bloques nuevos: `escaner-*` y `construir-*`
  (keyframes + clases + overrides dentro de `prefers-reduced-motion`).
- La regla global `prefers-reduced-motion` existente **no se tocó**; los
  overrides son por clase con `!important`, solo para estas dos piezas.

### `src/lib/auth/session.ts`, `src/lib/auth/request.ts`, `src/proxy.ts` (+14 −2 en total)
- `loginOmitidoEnDesarrollo()` en `session.ts`; primera línea de `proxy()` y
  de `isAuthenticatedRequest()` la consultan. Ver §4.

### `scripts/fixtures/guirnalda-ui/tarjeta-sin-armado.json` (huella recapturada)
- `test-ui-armado-guirnalda.ts` congela byte a byte el HTML de la tarjeta de la
  propuesta sin armado. Quitar `max-w-190` y agregar el hueco `precioCliente`
  lo cambia. Se recapturó **a mano y deliberadamente**, después de comprobar
  que, con `max-w-190` reinsertado, la única diferencia con `27528f2` son los
  ids de `useId` desplazados por el hueco nuevo (`_R_1aa69a_` → `_R_1aa69e_`).
  El JSON lleva `recapturada_en` y `motivo_recaptura`.
- **En el merge:** si la otra rama también cambia la tarjeta, esta huella va a
  fallar. No regenerarla a ciegas: comprobar como arriba que la diferencia es
  solo la intencional de cada lado y recapturarla una vez, explicando ambas.

### `package.json` (+2 −1)
- Script `plan:test-cotizacion-profesional`, y agregado a `plan:test` justo
  después de `plan:test-armado-guirnalda-ruta`. Conflicto casi seguro en la
  línea gigante de `plan:test`: tomar la del otro lado y reinsertar
  `npm run plan:test-cotizacion-profesional && `.

## 4. Decisiones

- **Python calcula** (`AGENTS.md`: Python es dueño de la cotización).
  TypeScript valida la frontera y muestra; no suma.
- **Contrato local de operación**, como `plan-armado-guirnalda.v1`: no está en
  `domain-v1.ts` ni en `contracts/domain/v1`, así que no requiere
  `contracts:export:domain` ni regenerar modelos ni vectores dorados.
- **Fuera del `plan_hash`**: la cotización profesional no entra en `compras`
  ni en el snapshot; no invalida planes aprobados.
- **Materiales sin re-verificar contra el plan firmado** (pedido explícito):
  se usan las líneas que tiene el navegador. Es una herramienta del decorador
  para su propio precio, no una compra. Si algún día se usa para cobrar,
  verificar el `approval_token` como en `aplicarEdicionPlan`.
- **Utilidad = recargo sobre el costo** (como la plantilla), y se muestra el
  margen real sobre el precio para que no se confundan.
- **Animaciones con reducir movimiento**: el escáner y el arco se animan aunque
  el sistema pida reducir movimiento (pieza de presentación). El resto de la
  app sigue respetándolo (`MotionConfig reducedMotion="user"` y la regla
  global). Revertible quitando los overrides del final de `globals.css`.
- **Login omitido en `next dev`**: solo con `NODE_ENV=development` (nunca en
  `next start` ni en producción, que sigue fallando cerrado); se restaura con
  `DEV_REQUIRE_LOGIN=1`. Las pruebas corren con `tsx` sin `NODE_ENV`, así que
  siguen probando el 401.

## 5. Verificación que corrió

- `uv run --directory services/ai-api pytest -q`: 919 passed, 4 skipped (DB).
- `ruff check app tests`, `ruff format`, `mypy app`: limpios.
- `npx tsc --noEmit`: limpio (tras `npm run build --workspaces --if-present`).
- `npm run lint`: 0 errores (avisos preexistentes, ninguno en archivos nuevos).
- `npm run plan:test`: pasa, incluido `plan:test-cotizacion-profesional`.
- `ui:test-propuesta` (57), `ui:test-presentacion-plan` (14),
  `test-proxy-matcher` (incluye fail-closed): pasan.
- Navegador integrado, propuesta de fixture a 1440 px y 375 px: panel de precio
  calcula 507.117 con materiales; con 2 h × 12.000 y 30 % da 690.452 (margen
  23,08 %); sin scroll horizontal en móvil.

**No verificado en navegador:** el escáner y el arco en una ejecución real
(requieren análisis de foto y generación de imagen, con costo); y la ausencia
de la cotización final tras aprobar.

## 6. Nota de entorno local

`.env.local` tiene `PYTHON_BACKEND_URL=http://demo-decoracion-ai-api:8000`
(nombre de Docker). Corriendo `uvicorn` en local, Next no lo resuelve y el chat
responde «No hubo respuesta». Arrancar Next con
`PYTHON_BACKEND_URL=http://127.0.0.1:8000`.
