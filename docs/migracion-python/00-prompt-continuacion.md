# Prompt de continuación — migración a backend Python

Pega esto como primer mensaje en una sesión nueva de Claude Code, en `C:\Users\davidt\Downloads\demo-decoracion` (o donde haya quedado tras el movimiento de carpeta, ver punto 8). Nada se ha lanzado todavía — este documento deja todo listo para arrancar sin fricciones.

---

Estamos migrando gradualmente el backend de IA de este proyecto (Next.js) a un servicio Python/FastAPI, siguiendo un plan maestro de 10 etapas que el usuario ya definió (ETAPA 1 auditoría, ETAPA 2 contratos, ETAPA 3 base del servicio Python, ... hasta ETAPA 10 limpieza y entrega). Sigue `AGENTS.md` de la raíz del repo en todo momento: nada de rewrites completos, trabajo por etapas verificables y reversibles, no duplicar reglas comerciales entre TS y Python sin adaptador explícito y acotado, no desplegar a producción ni lanzar entrenamientos/evals pagados sin autorización explícita, comunícate conmigo en español. Si algo del contexto no está claro, pregunta antes de asumir — nada del proyecto es inmutable.

## Correcciones de contexto ya verificadas (no las repitas ni las cuestiones)

- `services/image-api/` está **vacío**. No hay servicio de imágenes implementado que auditar/migrar ahí.
- El proveedor de IA real de la app es **Gemini** (`@google/genai`, embeddings `gemini-embedding-2`, 768 dims) — **no OpenAI**. OpenAI solo se usa para correr subagentes de investigación vía `opencode` (ver abajo), es una herramienta externa de trabajo, no parte del stack de la app.

## Herramienta de subagentes: opencode CLI

Ya está instalado y autenticado (oauth OpenAI + OpenCode Zen credentials, confirmado con `opencode providers list`). Modelo a usar: `openai/gpt-5.6-luna`, variant `xhigh`, agente `build` (el único definido, permisos ya en allow por defecto).

**Sintaxis correcta** (encontrada por prueba y error — el mensaje posicional debe ir ANTES de las flags, y `--file` debe llevar `=` porque si no, el flag tipo array se come el mensaje siguiente como si fuera parte de los adjuntos). Lánzalo siempre con `run_in_background: true` (Bash tool).

**Lección aprendida (importante):** si un proceso `opencode` queda corriendo cuando la sesión de Claude Code termina, el proceso en sí sobrevive (no se mata), pero el archivo de log al que escribía queda huérfano y deja de actualizarse — pierdes visibilidad aunque el proceso siga vivo y consumiendo CPU. Si al retomar ves con `Get-Process opencode` (PowerShell) procesos corriendo pero ningún informe nuevo en `docs/migracion-python/auditoria/` y el log no avanza: mátalos (`Stop-Process -Id <id> -Force`) y relánzalos dentro de la sesión actual para recuperar notificaciones de finalización reales. No los dejes corriendo "a ciegas" de una sesión a otra.

## Prompts de auditoría — ya escritos, listos para usar

Los 4 prompts detallados (alcance completo por dominio, qué debe producir cada informe, formato de salida) están guardados en disco, fuera del scratchpad de sesión, así que persisten entre sesiones:

```
C:\Users\davidt\AppData\Local\Temp\migracion-audit-prompts\audit-a-chat.md
C:\Users\davidt\AppData\Local\Temp\migracion-audit-prompts\audit-b-rag.md
C:\Users\davidt\AppData\Local\Temp\migracion-audit-prompts\audit-c-planes-imagenes.md
C:\Users\davidt\AppData\Local\Temp\migracion-audit-prompts\audit-d-lora-happie.md
```

Si por algún motivo ya no existen (limpieza de temp de Windows, etc.), reconstrúyelos usando la tabla de alcance de la sección siguiente — cada prompt sigue esta estructura: rol de auditor de solo lectura, instrucción de priorizar velocidad y no exhaustividad perfecta, alcance de rutas a inspeccionar, lista de 8-11 secciones a producir (mapa de flujo, inventario de contratos, dependencias, reglas de negocio a preservar, matriz migrar-ahora/mantener/migrar-después, riesgos+reversión, línea base de pruebas), y ruta de salida.

**Comandos listos para copiar y pegar** (lanzar los 4 en paralelo, cada uno con `run_in_background: true`):

```bash
opencode run "Sigue al pie de la letra las instrucciones del archivo adjunto. Eres un auditor de solo lectura para la Etapa 1 de una migracion a Python. No modifiques ningun archivo salvo el informe de salida indicado en el propio archivo adjunto." --agent build -m openai/gpt-5.6-luna --variant xhigh --auto --title "auditoria-a-chat" --file="C:/Users/davidt/AppData/Local/Temp/migracion-audit-prompts/audit-a-chat.md"

opencode run "Sigue al pie de la letra las instrucciones del archivo adjunto. Eres un auditor de solo lectura para la Etapa 1 de una migracion a Python. No modifiques ningun archivo salvo el informe de salida indicado en el propio archivo adjunto." --agent build -m openai/gpt-5.6-luna --variant xhigh --auto --title "auditoria-b-rag" --file="C:/Users/davidt/AppData/Local/Temp/migracion-audit-prompts/audit-b-rag.md"

opencode run "Sigue al pie de la letra las instrucciones del archivo adjunto. Eres un auditor de solo lectura para la Etapa 1 de una migracion a Python. No modifiques ningun archivo salvo el informe de salida indicado en el propio archivo adjunto." --agent build -m openai/gpt-5.6-luna --variant xhigh --auto --title "auditoria-c-planes-imagenes" --file="C:/Users/davidt/AppData/Local/Temp/migracion-audit-prompts/audit-c-planes-imagenes.md"

opencode run "Sigue al pie de la letra las instrucciones del archivo adjunto. Eres un auditor de solo lectura para la Etapa 1 de una migracion a Python. No modifiques ningun archivo salvo el informe de salida indicado en el propio archivo adjunto." --agent build -m openai/gpt-5.6-luna --variant xhigh --auto --title "auditoria-d-lora-happie" --file="C:/Users/davidt/AppData/Local/Temp/migracion-audit-prompts/audit-d-lora-happie.md"
```

Cada uno escribe SOLO su archivo de informe (nada más del repo):

| Dominio | Alcance | Archivo de salida esperado |
|---|---|---|
| A | Chat (`src/app/api/chat/route.ts`), motor de herramientas (`src/lib/ia/registro-herramientas.ts`, `ejecutar.ts`), proveedor IA, historial (`src/lib/ia/historial-chat.ts`), auth (`src/lib/auth/`), `packages/agente-core` | `docs/migracion-python/auditoria/01-chat-herramientas-proveedor.md` |
| B | RAG (`src/lib/rag/`), catálogo (`src/app/api/catalogo/`, `src/app/api/productos/`), Shopify (`src/lib/shopify/`, `src/app/api/shopify/sync/`), embeddings | `docs/migracion-python/auditoria/02-rag-catalogo.md` |
| C | Planes (`src/lib/plan/`), cotización (`src/lib/cotizacion/`), materiales (`src/lib/materiales/`), generación de imágenes (`src/app/api/generate/`), análisis de referencias (`src/app/api/references/`) | `docs/migracion-python/auditoria/03-planes-presupuesto-imagenes.md` |
| D | LoRA/datasets (`src/lib/lora/`, `src/app/api/lora/`, scripts `.py`), Happie (`src/lib/happie/`, `src/app/api/happie/`, `packages/happie-package-ia`), línea base completa de pruebas del repo (clasificar cada script de test/eval de `package.json` como local-determinista vs. requiere proveedor/credenciales/costo) | `docs/migracion-python/auditoria/04-lora-happie-linea-base.md` |

**Estado actual: ninguno se ha lanzado todavía.** `docs/migracion-python/auditoria/` está vacía. Los intentos anteriores (dos rondas) no llegaron a producir ningún informe: la primera ronda se quedó corriendo entre 30-40 min sin escribir nada y se mató por pérdida de visibilidad de log al cambiar de sesión (ver "lección aprendida" arriba); la segunda ronda se interrumpió a propósito antes de completarse porque el usuario decidió pausar el trabajo activo y primero dejar todo documentado aquí. Al retomar, evalúa si lanzar los 4 de nuevo tal cual, o ajustar el alcance/paralelismo primero.

## Una vez estén los 4 informes completos

Sintetiza, dentro de `docs/migracion-python/`, los entregables formales de la Etapa 1 que pidió el usuario: mapa de flujo global de IA (chat + Happie + webhooks), inventario de contratos y consumidores, dependencias entre módulos, matriz migrar-ahora/mantener-temporalmente/migrar-después, riesgos concretos con plan de reversión, línea base de pruebas (local vs. requiere proveedor/costo), y un documento de progreso vivo (decisiones, verificaciones, pendientes). No marques la Etapa 1 completa si falta alguno de estos.

## Decisión de arquitectura de carpetas ya tomada (no volver a preguntar)

```
Downloads/
  demo-decoracion-workspace/       ← carpeta contenedora nueva, NO es repo git
    demo-decoracion/               ← este repo, movido tal cual, historial git intacto (frontend Next.js)
    demo-decoracion-api/           ← carpeta nueva, repo git independiente y nuevo (backend Python/FastAPI, Etapa 3)
```

Ya se verificó que mover `demo-decoracion` tal cual es seguro: no hay rutas absolutas de filesystem que dependan de su ubicación actual (solo un par de patrones de permisos obsoletos en `.claude/settings.local.json`, y nombres de volumen Docker / rutas remotas SSH en `src/lib/lora/snapshot.ts` que son convención de nombre, no path — no se rompen con el movimiento).

Ejecuta el movimiento **después** de que los 4 informes de auditoría estén completos y guardados en disco (para no interrumpir procesos en curso). Antes de mover: corre `git status` en `demo-decoracion` y confirma qué cambios locales hay pendientes — se preservan automáticamente porque mover la carpeta es una operación de filesystem, no de git, pero confírmalo antes y después del movimiento.
