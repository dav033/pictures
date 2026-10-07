# Biblioteca real de decoraciones

`construir-biblioteca-real.ts` regenera datos desde la carpeta de referencias local. No se ejecuta al cargar la app.

## Acciones

- `--ejecutar`: convierte imágenes a JPG local de hasta 800 px, llama una vez por imagen al analizador clásico, guarda blueprint y plan/cotización Python, y publica `decoraciones.json`. Tiene gasto de análisis visual; ejecutar solo a mano.
- `--solo-resolver`: reutiliza blueprints guardados, vuelve a resolver con `plan.py` y llama `plan.lista_materiales`; no llama al analizador visual.
- `--solo-publicar`: reconstruye `decoraciones.json` desde planes guardados; no llama IA, Python ni base de datos.
- Con `--solo-resolver`: `--ids=03,08` re-resuelve solo esas (las demás conservan su `.plan.json`) y `--sin-publicar` no toca `decoraciones.json`.

Cada acción exige `--ejecutar` para hacer explícita su ejecución. Los archivos de entrada se leen como imágenes con `sharp`; nunca se ejecutan.

## Python local

Para `--ejecutar` y `--solo-resolver` el script usa `PYTHON_BACKEND_URL` de `.env.local` si está definida (el backend local que ya corre) y, si no, `127.0.0.1:8080`: en ese caso levanta el backend de este worktree en `127.0.0.1:8080` y apágalo al terminar. El lanzador lee `.env.local` en memoria y no imprime sus valores:

```powershell
rtk node -e 'process.loadEnvFile(".env.local"); process.env.PYTHON_BACKEND_URL="http://127.0.0.1:8080"; const {spawn}=require("node:child_process"); const child=spawn("uv",["--system-certs","run","--directory","services/ai-api","uvicorn","app.main:app","--host","127.0.0.1","--port","8080"],{stdio:"inherit",env:process.env}); child.on("exit",c=>process.exit(c??1));'
```

En otra terminal, desde la raíz del worktree:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npx tsx --conditions=react-server scripts/biblioteca/construir-biblioteca-real.ts --ejecutar
```

Para rehacer planes sin repagar análisis, usa `--ejecutar --solo-resolver`. Para regenerar solo el catálogo JSON, usa `--ejecutar --solo-publicar`.

Los JSON en `data/biblioteca-real/analisis/` guardan blueprint, plan Python, snapshot y cotización. No guardan imágenes. Los JPG optimizados viven en `public/biblioteca-sempertex/referencias/`.

## Correcciones de la auditoría de fotos (`data/biblioteca-real/correcciones-auditoria.json`)

Las 20 decoraciones del script (`real-NN-…`) se resuelven desde su corrección auditada contra la foto (2026-10-06), no desde la heurística de color (que solo ofrecía R-12 y elegía el tono por orden alfabético). Por cada pieza dice: la estructura oficial, qué tamaños muestra la foto (pista de tamaños para Python, que elige la mezcla), las capas y el remate si es una columna (los valida y cuenta el motor de columna de Python), y el producto Sempertex de cada color. La variante de cada talla la elige el script contra el snapshot vigente (paquete de 50 en 5/9/12", el más chico en 18/24/36") y falla si no está disponible. Python sigue siendo el único dueño de las cantidades: reparte las tallas entre los colores según la mezcla, y una talla que un color no tiene la sirve con la contigua de ese color. `tamanos_foto` va al plan como tallas obligatorias solo si todos los colores las tienen. `extras` son accesorios que Python no modela (cortinas, foil, confeti, impresos, acentos dibujados): se publican como `estimado_foto`, con su detalle. Un elemento del análisis que no esté en `piezas` ni en `descartar` detiene el script.

## Detalle de cada idea (`detalles-ideas.json`)

La tarjeta «Tu elección» de la vista guiada muestra cada pieza de la idea con sus globos Sempertex por producto y tamaño. Ese detalle se precalcula, sin red, sin Python y sin coste, desde `decoraciones.json` y los `.plan.json` resueltos:

```powershell
npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts           # regenera src/lib/biblioteca-sempertex/detalles-ideas.json
npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts --check   # sale con 1 si está desfasado con decoraciones.json
```

`--solo-publicar` lo regenera al final (en un proceso aparte, sin la condición `react-server`). Si se edita `decoraciones.json` a mano (las curadas 21-31), hay que correrlo después. Los avisos dicen qué ideas se muestran sin repartir por pieza, porque su plan ya no cuadra con los materiales o sus piezas no son las de la decoración. Prueba: `npx tsx scripts/test/test-detalles-ideas.ts`.
