/**
 * Arnés de entrenamiento (W4): el leaderboard que se escribe desde las corridas en disco y el commit con que corrió cada
 * pasada. Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-leaderboard.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { agregarPorFoto, type RegistroPasada } from "../entrenamiento/lib-agregado";
import { commitDeTrabajo } from "../entrenamiento/lib-commit";
import { construirLeaderboard, renderizarLeaderboard, rutaDelLeaderboard } from "../entrenamiento/lib-leaderboard";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-leaderboard-"));
let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const registro = (over: Partial<RegistroPasada>): RegistroPasada => ({
  foto: "images (25).jpg", modo: "real", transporte: "api", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "abc1234", iniciadaEn: "2026-10-10T10:00:00.000Z",
  turnos: 1, turnosMax: 2, llamadas: 5, deteccionCacheada: false, convergio: true,
  puntajes: { proporciones: 0.5, colores: 0.5, zonas: null, iou: null },
  piezas: { leidas: 1, armadas: 1, omitidas: 0, globosFoto: 3, globosArmados: 3 },
  fallos: [], captura: "pendiente", costeUsd: 0.1, abortada: null, error: null, ...over,
});

function escribirCorrida(raiz: string, corrida: string, registros: RegistroPasada[]): void {
  const dir = path.join(raiz, corrida);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "resumen.json"), JSON.stringify({ corridaId: corrida }));
  for (const r of registros) writeFileSync(path.join(dir, `${r.foto.replace(/\.jpg$/, "")}.json`), JSON.stringify({ registro: r, escena: null }));
}

const filasDe = (md: string) => md.split("\n").filter((l) => /^\| \d+ \|/.test(l));

console.log("Leaderboard y commit del arnés (W4):");

prueba("agrega solo las corridas válidas y comparables del modo, y cuenta las omitidas", () => {
  const raiz = path.join(tmp, "corridas");
  mkdirSync(path.join(raiz, "cache-deteccion"), { recursive: true });
  mkdirSync(path.join(raiz, "registro"), { recursive: true });
  escribirCorrida(raiz, "2026-10-10T10-00-00-000Z", [
    registro({ iniciadaEn: "2026-10-10T10:00:00.000Z", puntajes: { proporciones: 0.6, colores: 0.4, zonas: null, iou: null } }),
    registro({ foto: "images (26).jpg", iniciadaEn: "2026-10-10T10:01:00.000Z" }),
  ]);
  escribirCorrida(raiz, "2026-10-11T10-00-00-000Z", [
    registro({ iniciadaEn: "2026-10-11T10:00:00.000Z", puntajes: { proporciones: 0.8, colores: 0.6, zonas: null, iou: null }, fallos: ["compilacion"] }),
    registro({ foto: "images (26).jpg", iniciadaEn: "2026-10-11T10:01:00.000Z", abortada: "Tope de gasto de la pasada superado", puntajes: { proporciones: 0.99, colores: 0.99, zonas: null, iou: null } }),
    registro({ foto: "images (27).jpg", iniciadaEn: "2026-10-11T10:02:00.000Z", error: "TypeError inesperado", fallos: [] }),
    registro({ foto: "images (29).jpg", iniciadaEn: "2026-10-11T10:04:00.000Z", error: "La IA no pudo leer la foto", fallos: ["lectura"], puntajes: { proporciones: null, colores: null, zonas: null, iou: null } }),
    registro({ foto: "images (28).jpg", iniciadaEn: "2026-10-11T10:03:00.000Z", modo: "seco" }),
  ]);
  const md = construirLeaderboard(raiz, "real", "2026-10-12T00:00:00.000Z");
  assert.match(md, /modo real/);
  assert.match(md, /Omitidas: 2 corridas abortadas/);
  assert.doesNotMatch(md, /Dry-run/);
  const filas = filasDe(md);
  assert.equal(filas.length, 3, "27 (error del arnés sin clasificar) y 28 (seco) no tienen fila; 29 (no se pudo leer) sí");
  assert.match(filas[0]!, /^\| 1 \| images \(29\)\.jpg \| 1 \| — \| — \| — \| — \| lectura \| 2026-10-11T10:04:00\.000Z /);
  assert.match(filas[1]!, /^\| 2 \| images \(25\)\.jpg \| 2 \| 0\.70 \| 0\.50 \| — \| — \| compilacion \| 2026-10-11T10:00:00\.000Z \| claude-haiku-5-5 \| medium \| api \| 1\/2 \| abc1234 \| 0\.2000 \|$/);
  assert.match(filas[2]!, /^\| 3 \| images \(26\)\.jpg \| 1 \| 0\.50 \| 0\.50 \| — \| — \| ninguno \| 2026-10-10T10:01:00\.000Z /, "la corrida abortada (0.99) no cuenta, y la fila queda con la última válida");
  assert.doesNotMatch(md, /0\.99/);
});

prueba("el leaderboard de seco solo lee corridas seco y avisa de que son marcadores", () => {
  const raiz = path.join(tmp, "corridas-seco");
  escribirCorrida(raiz, "2026-10-10T10-00-00-000Z", [
    registro({ foto: "images (25).jpg", modo: "seco", transporte: "seco" }),
    registro({ foto: "images (26).jpg", modo: "real" }),
  ]);
  const md = construirLeaderboard(raiz, "seco", "2026-10-12T00:00:00.000Z");
  assert.match(md, /modo seco/);
  assert.match(md, /Dry-run/);
  assert.deepEqual(filasDe(md).map((f) => f.split("|")[2]!.trim()), ["images (25).jpg"]);
});

prueba("sin corridas en disco el leaderboard sale vacío, no falla", () => {
  const md = construirLeaderboard(path.join(tmp, "no-existe"), "real", "2026-10-12T00:00:00.000Z");
  assert.equal(filasDe(md).length, 0);
  assert.match(md, /Omitidas: 0 /);
});

prueba("la fila muestra el esfuerzo y avisa cuando el modelo corrió sin razonamiento", () => {
  const md = renderizarLeaderboard(agregarPorFoto([registro({ esfuerzo: "high", pensamiento: false })]), "real", "2026-10-12T00:00:00.000Z", 0);
  assert.match(filasDe(md)[0]!, / \| claude-haiku-5-5 \| high sin razonamiento \| api \| /);
  assert.match(md, /\| Modelo \| Esfuerzo \| Transporte \|/);
});

prueba("la fila de capacidad_faltante muestra detrás su causa más repetida; las corridas viejas, sin detalle, solo la clase madre", () => {
  const conCausa = (iniciadaEn: string, capacidades?: NonNullable<RegistroPasada["capacidades"]>) => registro({ iniciadaEn, fallos: ["capacidad_faltante"], ...(capacidades ? { capacidades } : {}) });
  const [nueva] = agregarPorFoto([conCausa("2026-10-10T10:00:00.000Z", { falta_figura: 3, fondo_fijo: 1 })]);
  assert.equal(nueva!.fallo, "capacidad_faltante");
  assert.equal(nueva!.falloEspecifico, "falta_figura");
  const [varias] = agregarPorFoto([conCausa("2026-10-10T10:00:00.000Z", { falta_figura: 1 }), conCausa("2026-10-10T10:01:00.000Z", { falta_pared: 2 }), conCausa("2026-10-10T10:02:00.000Z")]);
  assert.equal(varias!.falloEspecifico, "falta_pared", "se suman las comparables; la que no trae detalle no cuenta");
  const [vieja] = agregarPorFoto([conCausa("2026-10-10T10:00:00.000Z")]);
  assert.equal(vieja!.fallo, "capacidad_faltante");
  assert.equal(vieja!.falloEspecifico, null);
  const [otra] = agregarPorFoto([registro({ fallos: ["compilacion"], capacidades: { falta_figura: 1 } })]);
  assert.equal(otra!.falloEspecifico, null, "solo si la clase dominante es la madre de las causas");
  const md = renderizarLeaderboard([...agregarPorFoto([conCausa("2026-10-10T10:00:00.000Z", { color_no_disponible: 1 })]), ...agregarPorFoto([registro({ foto: "images (26).jpg", fallos: ["capacidad_faltante"] })])], "real", "2026-10-12T00:00:00.000Z", 0);
  const filas = filasDe(md);
  assert.match(filas.find((f) => f.includes("images (25).jpg"))!, / \| capacidad_faltante\/color_no_disponible \| /);
  assert.match(filas.find((f) => f.includes("images (26).jpg"))!, / \| capacidad_faltante \| /);
  assert.match(md, /capacidad_faltante\/falta_figura/, "la cabecera explica el formato");
});

prueba("el leaderboard real va a la bitácora por defecto; el de seco nunca", () => {
  const porDefecto = "C:/bitacora/pictures/research/entrenamiento/LEADERBOARD.md";
  const raizCorridas = path.join("repo", "corridas");
  assert.equal(rutaDelLeaderboard({ seco: false, indicada: undefined, porDefecto, raizCorridas }), porDefecto);
  assert.equal(rutaDelLeaderboard({ seco: false, indicada: "otra/ruta.md", porDefecto, raizCorridas }), "otra/ruta.md");
  assert.equal(rutaDelLeaderboard({ seco: true, indicada: undefined, porDefecto, raizCorridas }), path.join(raizCorridas, "LEADERBOARD-seco.md"), "seco sin ruta: dentro de corridas, no en la bitácora");
  assert.equal(rutaDelLeaderboard({ seco: true, indicada: path.join("tmp", "LEADERBOARD.md"), porDefecto, raizCorridas }), path.join("tmp", "LEADERBOARD-seco.md"));
});

prueba("el commit lleva «+dirty» cuando el árbol tiene cambios sin confirmar", () => {
  const git = (sucio: string) => (argumentos: string[]) => (argumentos[0] === "rev-parse" ? "abc1234\n" : sucio);
  assert.equal(commitDeTrabajo(git("")), "abc1234");
  assert.equal(commitDeTrabajo(git(" M scripts/entrenamiento/lib-pasada.ts\n")), "abc1234+dirty");
  assert.equal(commitDeTrabajo(git("?? tsconfig.verif.json\n")), "abc1234+dirty", "un archivo nuevo sin seguir también cuenta");
  assert.equal(commitDeTrabajo(() => { throw new Error("git no está"); }), "desconocido");
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas del leaderboard y el commit: OK`);
