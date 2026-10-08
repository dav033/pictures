# SEGUIMIENTO · demo-decoracion — Taller 3D de globos

Documento único del proyecto, reiniciado el 2026-10-07 después de la presentación de la vista guiada.
El seguimiento anterior completo (LoRA, fidelidad foto → imagen, vista guiada, herramientas de evaluación) está en git:
`git show 7215029:SEGUIMIENTO.md`.

---

## ⏸ Pausa del 2026-10-08 (08:45): todo detenido, foco en rendimiento

El dueño pausó el resto («centrémonos en el rendimiento»). Dónde quedó cada frente:

**Ideas de fiesta de Sempertex (loop de digitalización, latido 52)**
- 987 ideas raspadas y clasificadas. Datos fuera del repo en `../ideas-fiesta-sempertex/`: `ideas-v3.json`, `productos.json`,
  `fotos/`, `clasif/todas.json`, `clasif/parcial-cubiertas.json` (334, la cola), `clasif/lote-NN.json` (qué lleva cada lote).
  Scripts `raspar.py`, `extraer.py`, `productos.py`, `fotos-y-hojas.py` y el encargo modelo `clasif/plantilla-encargo-lote.txt`.
- En main: lotes 01–24 (393 ideas). En la rama local, verificados pero **sin subir**: lote 25 (`5eab2576`), lote 26 (`7ee1533a`)
  y las 20 bases orgánicas de fotos web (`401d4284`, `5ff31e47`; fotos en `../ideas-fiesta-sempertex/web-organicos/`).
  Se unen con el arreglo de rendimiento (`perf/carga-3d`) en un commit de unión; a lotes 25/26 se les agregó `clase: "escena"`.
- Cola: 110 de «parcial-cubiertas» después del lote 26; luego ~289 parciales y 184 sin cubrir, que piden generadores nuevos
  (flores naturales, cartón, aros espiral, caras de tubito…). Lotes nuevos: patrón perezoso obligatorio (`ideas-sempertex/tipos.ts`).
- Otros: SendMessage no sirve para cambiar encargos en curso; máx. 3 agentes (RAM); verificar cada commit en un worktree limpio.

**Rendimiento (el frente activo)**
- Hallazgo: /3d armaba las 393 ideas al importar `biblioteca.ts` → 18,6 s de ejecución pura (lote-11 solo, 9,1 s). En producción la
  pestaña quedaba congelada ~20 s; en local el servidor de desarrollo se iba a 85 % de CPU con cada cambio en un lote.
- Arreglado en `ef70eb7e` (main): ideas perezosas, Biblioteca con `next/dynamic` y su índice en un Web Worker. Taller3D importa en
  118 ms (antes 14,5 s); `scripts/test/test-carga-3d.ts` falla si algo pasa de 500 ms.
- Pendiente de medir: el Worker en un navegador real, la apertura de ideas pesadas (#471 tarda ~6 s), el primer `buscar_en_biblioteca`
  de `/api/escena-ia` (~20 s en frío), el armado orgánico (~1 s por base), los FPS del visor con escenas grandes y el peso del bundle.

## ⏯ Qué estamos haciendo

Un **taller 3D paramétrico** de decoraciones con globos Sempertex en `/3d` (producción y local). Lo armamos por niveles: globo → módulo →
estructura → decoraciones colgadas de anclas. La lista de materiales sale de las hojas y el render sirve de guía exacta para FLUX.
El consejo de LLM lo recomendó antes que un LoRA de estructuras (ver enlaces).

- Producción: https://demo-decoracion.vercel.app/3d · Local: http://localhost:3010/3d
- Rama local `fix/color-organico-conteo`; cada hito verificado se sube con `git push origin fix/color-organico-conteo:main`. Vercel
  despliega solo. El VPS se despliega a mano y solo con aviso previo al dueño.

### Hecho (todo en main)

| Pestaña | Qué hace |
|---|---|
| Globos | Cada globo Sempertex a tamaño real (R-5…R-36, LOL-6/12/660, T-160/260/360, C-6/C-12), color oficial e inflado |
| Módulos | Pareja, trío, cuarteto, quinteto y sexteto con los pitones amarrados al centro; color por globo, anclas y materiales |
| Columna | Trenza de cuartetos: un color, dos colores, espiral, salvavidas y zig-zag; radio 0,62 d, paso 0,8 d |
| Arco | La misma trenza sobre un recorrido redondo, parabólico o rectangular |
| Pared | Malla Link-O-Loon tipo flor (un color, damero, rombos, franjas) o trenzas alternando tamaños |
| Decoración | Flores, flor de tubito, moño, estrella y flor de corazones por propiedades (14 predefinidas), colgadas de las anclas de la columna, el arco o la pared; mezcla de varias. **Celebra ed. 27 uno a uno**: modo «Como la foto», cada una de las 25 piezas en su sitio medido en la foto |
| Orgánico | Motor orgánico (columna, guirnalda, semiarco) con flores artificiales, pedestal y confeti; réplica de la columna azul de XV |
| Colores de la escena | Paleta arriba en todas las pestañas (menos Globos): cada color usado con su cantidad; tocarlo lo cambia en todo el montaje (en Decoración, por separado la base y las decoraciones), con «Deshacer» y aviso si el color no viene en un formato (p. ej. Corazón 6 solo Fucsia) |
| Escena | Varias piezas en una sala (piso, paredes y techo que se ocultan al girar): en el piso, contra una pared, colgadas del techo o de un ancla de otra pieza; mover, girar, duplicar, quitar. Presets: arco orgánico con dos columnas y guirnalda, pared de globos al fondo con columnas, techo con tiras y flores. Base común: `Pieza` (`piezas.ts`) y `armarEscena` (`escena.ts`) |
| Escena a mano | Clic para elegir en el visor, arrastrar sobre piso/pared/techo (imán 5 cm, Alt libre), flechas 5 cm (Shift 25), Q/E girar, RePág/AvPág altura, Supr, Ctrl+D, Ctrl+Z/Y (50 pasos) |
| Decoraciones pequeñas | Sección aparte en Escena: las 14 predefinidas con miniatura; colgar en la pieza elegida (cada N anclas) o sueltas en pared/piso/techo; en la pared siempre de frente |
| IA arma la escena | «Pídele a la IA» en Escena: Gemini (texto, `MODELO_CHAT`) con 11 herramientas (`herramientas-escena.ts`, ruta `/api/escena-ia`): ver, preset, agregar, mover, girar, cambiar, quitar, duplicar, sala, catálogo, colores. Suma sin rehacer; registro por herramienta; tope 60 mensajes/hora; «Deshacer lo de la IA». ~US$0,016 por pedido grande |
| Catálogo | 13 decoraciones simples del Banco de estructuras digitalizadas (`catalogo-fotos.ts`), añadibles desde Escena; cada una dice qué se parece y qué no |
| Imagen con IA | «Generar imagen con IA»: captura el visor y lo vuelve foto con FLUX base `/edit` (sin LoRA), eligiendo lugar; ~US$0,05 por imagen, tope 30/hora, registro en el servidor |

### Siguiente

- Más decoraciones del banco: guirnalda espiral roja y azul (e02-p016-002), columnas de cuarteto grande con chicos de colores (e02-p045-000, e02-p044-000), arcos con decoraciones colgadas (e20-p036-002, e26-p043-002).
- Decidir el paso entre cuartetos: las fotos muestran 0,6–0,7 d por nivel; el taller usa 0,8 d (5 por metro de Sempertex).
- Afinar decoraciones dentro de una escena (hoy solo se cambian por otra predefinida).

### Antes planeado: motor de composición modular (hecho en buena parte con Escena)

1. Interfaz común `Generador` con esquema de propiedades → `armar(props)` → pieza `{globos, anclas, follaje, materiales}`.
2. Registro de generadores (módulo, trenza/columna, arco, pared malla, pared trenzas, orgánico, flor, moño, estrella…).
3. Escena como árbol plano de nodos `{id, padre, generador, props, ancla, regla}`; las raíces van al piso.
4. Paneles de propiedades generados desde el esquema; presets como escenas JSON (columna XV, Celebra 27).
5. Flores por **capas** y **racimo de perlitas** para cubrir las 9 variaciones de flor de Celebra 27.

Después, con menos prioridad: anclas en las intersecciones entre niveles; bases con pesas y marcos para los arcos; arco orgánico;
conectar el render 3D al plan real (Python `plan.py` sigue siendo el único dueño de cantidades y cotización).

---

## Arquitectura del taller

- **Lógica pura** en `src/lib/globos3d/` (sin three.js, probada con `tsx`):
  `formatos.ts` (catálogo y colores por formato) · `geometria.ts` (perfiles de globo y link, nudo) · `modulos.ts` · `trenza.ts`
  (base de `columnas.ts` y `arcos.ts`) · `decoraciones.ts` (flores por propiedades, `colocarEn`, `elegirAnclas`) · `figuras.ts`
  · `mezcla.ts` (`decorarPared`, `CELEBRA_27`) · `paredes.ts` · `pared-trenzas.ts` · `organico.ts` · `flores-artificiales.ts`
  · `organico-presets.ts` · `render-ia.ts` (texto para FLUX).
- Cada generador devuelve `GloboColocado {nudo, direccion, cuelloExtraCm}` y anclas `{posicion, normal}`. Las decoraciones se arman en
  +Y local y se colocan con `colocarEn(globos, ancla)`.
- **Visor**: `src/components/tres-d/escena-globos.ts` (three.js 0.180; `mostrar`, `mostrarModulo`, `capturar`), `Taller3D.tsx`
  (pestañas), `PanelFlor`, `PanelPared`, `PanelDecoracion`, `EditoresFiguras`, `PanelOrganico`, `GeneradorIA`.
- **Ruta**: `src/app/api/render-3d-imagen/route.ts` (FLUX base `/edit` con la captura como base, `decidir`/`conRegistro`).

### Fórmulas Sempertex usadas

| Dato | Valor |
|---|---|
| Cuartetos por metro | R-12 a 25 cm: 5 · R-9: 7 · R-5: 10 |
| Paso vertical / radio de columna | 0,8 d / 0,62 d |
| Malla Link-O-Loon flor | 16 LOL-12 o 64 LOL-6 por m² (eslabón 1,47 d) |
| Pared de trenzas | 6 cuartetos/m, ~50 cm por trenza |

### Verificación (por hito)

Copia limpia `C:\Users\davidt\Downloads\e3-verif`: `git fetch ../pictures-workspace/demo-decoracion <sha>` y `git checkout --detach <sha>`,
luego `npx tsc --noEmit`, `npx eslint <archivos>` y las pruebas sin coste:
`npx tsx --conditions=react-server scripts/test/<prueba>.ts` con `test-globos3d`, `test-columna3d`, `test-arco3d`,
`test-decoraciones3d`, `test-pared3d`, `test-pared-trenzas3d`, `test-figuras3d`, `test-organico3d`, `test-render-ia`.
Revisión visual en Chrome sobre `localhost:3010/3d` (el servidor de desarrollo tarda en hidratar: repetir el clic si no responde).

---

## Enlaces (artifacts)

- **Banco de estructuras Sempertex** (galería de decoraciones con leyenda, tipo y técnica de armado): https://claude.ai/artifact/DzowLnkzwAon1xhvHn59D9
- Fuentes Sempertex de estructuras (resumen de páginas y revistas Celebra): https://claude.ai/artifact/U55V33UrYrSePN2Cqx6BU3
- Consejo: motor 3D de globos: https://claude.ai/artifact/DdKUfZJwKkqDtu6vebdW3N
- Consejo: plan jerárquico de globos (control más fino): https://claude.ai/artifact/DK2yPtY5ASreFbFJcELhv4

---

## Reglas que siguen vigentes

- Español; autonomía total; preguntar solo decisiones del dueño. Commits en español con la atribución de la sesión.
- `services/ai-api/app/plan.py` es el único dueño de cantidades, medidas y cotización. Contratos Zod → export → `generate_models.py`.
- TypeScript sin `any`. Nunca imprimir valores de `.env*`. Sin datos de clientes en el repo.
- Imagen final: FLUX base en fal.ai, sin LoRA. Gemini nunca genera imágenes. Toda corrida pagada declara su tope.
- Ninguna decisión de IA sin registro en el servidor (`npm run registros`).
- No reiniciar ni matar `:3010` (Next) ni `:8000` (Python). Poca RAM (15,7 GB): nada de `next build`, un proceso pesado a la vez.
- Pruebas grandes en pausa: solo las puntuales del módulo tocado, `tsc` y `eslint`.
