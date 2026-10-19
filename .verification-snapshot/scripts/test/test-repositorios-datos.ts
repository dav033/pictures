/**
 * Los datos detrás de los repositorios (REQ-013, plan T41): los cargadores devuelven las MISMAS fuentes y el MISMO orden que antes,
 * sin copiar datos: ideas y formatos/colores en sempertex, muebles y generadores paramétricos en mobiliario, fondos/cortinas/
 * paneles/pedestales/pasteles en escenografía. Código real, sin base, red ni IA.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-repositorios-datos.ts
 */
import assert from "node:assert/strict";
import { repositorio } from "../../src/lib/catalogo/registro";
import { ASIGNACION_FONDOS, GENERADORES_MOBILIARIO } from "../../src/lib/catalogo/asignacion-fondos";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import { MODULOS } from "../../src/lib/globos3d/modulos";
import { CATALOGO_UTILERIA } from "../../src/lib/globos3d/utileria-catalogo";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ok ${pruebas} - ${nombre}`); };
const sempertex = () => repositorio("sempertex")!.entradas();
const daClase = <C extends string>(lista: readonly { clase: string }[], clase: C) => lista.filter((e) => e.clase === clase);

prueba("sempertex: ideas de fábrica = BIBLIOTECA_FABRICA (mismos objetos y orden)", () => {
  const items = daClase(sempertex(), "item-biblioteca") as unknown as { idLocal: string; dato: unknown }[];
  assert.deepEqual(items.slice(0, BIBLIOTECA_FABRICA.length).map((e) => e.idLocal), BIBLIOTECA_FABRICA.map((i) => i.id));
  BIBLIOTECA_FABRICA.forEach((item, k) => assert.equal(items[k]!.dato, item));
});

prueba("sempertex: formatos, colores, utilería y módulos salen de sus tablas de siempre", () => {
  const entradas = sempertex();
  const datos = (clase: string) => (daClase(entradas, clase) as unknown as { dato: unknown }[]).map((e) => e.dato);
  assert.deepEqual(datos("formato"), [...FORMATOS_GLOBO]);
  assert.deepEqual(datos("color"), [...TABLA_SEMPERTEX.referencias]);
  assert.deepEqual(datos("producto-tienda"), [...CATALOGO_UTILERIA]);
  assert.deepEqual(datos("modulo"), [...MODULOS]);
});

prueba("sempertex: el orden de clases es el de hoy", () => {
  const orden: string[] = [];
  for (const e of sempertex()) if (orden.at(-1) !== e.clase) orden.push(e.clase);
  assert.deepEqual(orden, ["item-biblioteca", "formato", "color", "producto-tienda", "plan-idea", "decoracion-guiada", "modulo"]);
});

prueba("mobiliario: muebles y sets paramétricos del catálogo en su orden + los dos generadores", () => {
  const esperados = FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === "mobiliario");
  const entradas = repositorio("mobiliario")!.entradas();
  assert.deepEqual(entradas.map((e) => e.idLocal), [...esperados.map((f) => f.id), ...GENERADORES_MOBILIARIO]);
  esperados.forEach((f, k) => assert.equal(entradas[k]!.dato, f, f.id));
  assert.ok(esperados.some((f) => f.id.startsWith("conjunto") || f.id.includes("mesa")), "hay sets paramétricos de mesa");
});

prueba("escenografía: fondos, cortinas, paneles, pedestales y pasteles, y nada de mobiliario", () => {
  const esperados = FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === "escenografia");
  const entradas = repositorio("escenografia")!.entradas();
  assert.deepEqual(entradas.map((e) => e.idLocal), esperados.map((f) => f.id));
  entradas.forEach((e, k) => assert.equal(e.dato, esperados[k]));
  for (const e of entradas) assert.ok(e.clase === "fondo" || e.clase === "decorado", e.id);
  for (const palabra of ["panel", "cortina", "pedestal", "pastel"]) assert.ok(entradas.some((e) => e.idLocal.includes(palabra)), `sin ${palabra}`);
});

prueba("el catálogo plano está repartido sin pérdida: mobiliario + escenografía = FONDOS_CATALOGO", () => {
  const ids = [...repositorio("mobiliario")!.entradas().filter((e) => e.clase !== "generador"), ...repositorio("escenografia")!.entradas()].map((e) => e.idLocal);
  assert.deepEqual(ids.sort(), FONDOS_CATALOGO.map((f) => f.id).sort());
});

prueba("cada repositorio solo lista clases de su manifiesto y apunta a su carpeta de datos", () => {
  for (const id of ["sempertex", "mobiliario", "escenografia"] as const) {
    for (const e of repositorio(id)!.entradas()) assert.ok(MANIFIESTOS[id].clases.includes(e.clase), `${e.id}`);
  }
  assert.equal(MANIFIESTOS.sempertex.datos, "data/taller");
  assert.equal(MANIFIESTOS.mobiliario.datos, "data/catalogos/mobiliario");
  assert.equal(MANIFIESTOS.escenografia.datos, "data/catalogos/escenografia");
});

console.log(`test-repositorios-datos: ${pruebas} pruebas ok`);
