# Biblioteca real de decoraciones

`construir-biblioteca-real.ts` regenera datos desde la carpeta de referencias local. No se ejecuta al cargar la app.

## Acciones

- `--ejecutar`: convierte imágenes a JPG local de hasta 800 px, llama una vez por imagen al analizador clásico, guarda blueprint y plan/cotización Python, y publica `decoraciones.json`. Tiene gasto de análisis visual; ejecutar solo a mano.
- `--solo-resolver`: reutiliza blueprints guardados, vuelve a resolver con `plan.py` y llama `plan.lista_materiales`; no llama al analizador visual.
- `--solo-publicar`: reconstruye `decoraciones.json` desde planes guardados; no llama IA, Python ni base de datos.

Cada acción exige `--ejecutar` para hacer explícita su ejecución. Los archivos de entrada se leen como imágenes con `sharp`; nunca se ejecutan.

## Python local

Para `--ejecutar` y `--solo-resolver`, levanta el backend de este worktree en `127.0.0.1:8080` y apágalo al terminar. El lanzador lee `.env.local` en memoria y no imprime sus valores:

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
