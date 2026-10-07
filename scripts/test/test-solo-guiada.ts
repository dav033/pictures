/**
 * Producción solo con la guiada (`NEXT_PUBLIC_SOLO_GUIADA`): qué páginas redirigen a /asistente y qué sigue abierto.
 * Sin coste: solo la regla de rutas de `src/lib/solo-guiada.ts`.
 */
import assert from "node:assert/strict";
import { paginaBloqueadaSoloGuiada } from "../../src/lib/solo-guiada";

const bloqueadas = ["/", "/catalogo", "/catalogo/globo-fashion-rosado", "/admin", "/estadisticas", "/happie", "/laboratorio-patrones", "/laboratorio-referencias", "/catalogo/"];
for (const ruta of bloqueadas) assert.equal(paginaBloqueadaSoloGuiada(ruta), true, `${ruta} debe llevar a /asistente`);

const abiertas = [
  "/asistente", "/asistente/", "/login", "/3d", "/3d/",
  "/api/asistente-guiado", "/api/chat", "/api/generate", "/api/plan-editar", "/api/catalogo/imagenes",
  "/_next/static/chunks/main.js", "/favicon.ico", "/referencias-ejemplo/ejemplo-01.jpg", "/globos/fashion-rosado.webp",
];
for (const ruta of abiertas) assert.equal(paginaBloqueadaSoloGuiada(ruta), false, `${ruta} debe seguir abierta`);

console.log("OK test-solo-guiada: la clásica, el catálogo y las páginas internas llevan a /asistente; la guiada, el taller 3D, el login, las API y los archivos siguen abiertos");
