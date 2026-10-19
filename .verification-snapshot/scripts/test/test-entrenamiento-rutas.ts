/**
 * Arnés de entrenamiento (W4): dónde guarda sus corridas (fuera del repo, movible con ENTRENAMIENTO_CORRIDAS). Puro:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-rutas.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { directorioDeCorridas } from "../entrenamiento/lib-rutas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const SUBCARPETA = path.join("demo-decoracion", "entrenamiento", "corridas");

prueba("ENTRENAMIENTO_CORRIDAS gana y se vuelve ruta absoluta", () => {
  assert.equal(directorioDeCorridas({ ENTRENAMIENTO_CORRIDAS: path.resolve("datos", "mis-corridas"), LOCALAPPDATA: "C:/local" }, "/hogar"), path.resolve("datos", "mis-corridas"));
  assert.equal(directorioDeCorridas({ ENTRENAMIENTO_CORRIDAS: " relativa " }, "/hogar"), path.resolve("relativa"));
});

prueba("por defecto va a los datos locales del usuario, fuera del repo y de la bitácora", () => {
  assert.equal(directorioDeCorridas({ LOCALAPPDATA: "C:/Users/x/AppData/Local" }, "/hogar"), path.join("C:/Users/x/AppData/Local", SUBCARPETA));
  assert.equal(directorioDeCorridas({ ENTRENAMIENTO_CORRIDAS: "  ", LOCALAPPDATA: "C:/Users/x/AppData/Local" }, "/hogar"), path.join("C:/Users/x/AppData/Local", SUBCARPETA), "vacía = sin indicar");
  assert.equal(directorioDeCorridas({ XDG_DATA_HOME: "/datos" }, "/hogar"), path.join("/datos", SUBCARPETA));
  assert.equal(directorioDeCorridas({}, "/hogar"), path.join("/hogar", ".local", "share", SUBCARPETA));
  const real = directorioDeCorridas();
  assert.ok(!real.includes("bitacora") && !real.includes(`${path.sep}scripts${path.sep}`), `no cae en la bitácora ni en el repo: ${real}`);
});

console.log(`\n${pruebas} pruebas de las rutas del arnés: OK`);
