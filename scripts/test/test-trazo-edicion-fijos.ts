/**
 * Un trazo orgánico con mezcla propia por punto (`pesos`) y globos fijos (`fijos`, los de una foto medida) no pierde nada al
 * editarse. Sin coste.
 * - escalarTrazo (más larga, más alta, más gruesa): los puntos conservan su `pesos` y los fijos se estiran con el eje (siguen en
 *   el mismo sitio del cuerpo);
 * - espejar: los fijos se reflejan en el generador Y en las opciones armables; espejar dos veces devuelve el original;
 * - cambiar_pieza «solo estos tamaños»: la mezcla de cada punto y los fijos de los formatos que ya no van se quitan (antes
 *   «solo R-12 y R-5» seguía poniendo un R-36);
 * - ajustar_tamanos sobre un trazo con mezcla por punto: «más R-24» sube de verdad, «quitar R-36» quita también los fijos,
 *   «menos R-36» deja la mitad de los fijos de ese formato.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-trazo-edicion-fijos.ts
 */
import assert from "node:assert/strict";
import { armarOrganico, olvidarEmpaquesOrganicos, type GloboFijo } from "../../src/lib/globos3d/organico";
import { escalarTrazo, puntosDeSilueta, type ParametrosTrazoOrganico } from "../../src/lib/globos3d/trazo-organico";
import { piezaDeGenerador } from "../../src/lib/globos3d/generadores-organicos";
import { espejarPieza } from "../../src/lib/globos3d/herramientas-escena-disposicion";
import { ajustarTrazo } from "../../src/lib/globos3d/herramientas-escena-trazo";
import { ajustarTamanos } from "../../src/lib/globos3d/herramientas-escena-tamanos";
import type { Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
type Organico = Extract<Pieza, { tipo: "organico" }>;

const PESOS_CARGADOS = { "R-36": 0.12, "R-24": 0.1, "R-12": 0.5, "R-5": 0.28 };
const FIJOS: GloboFijo[] = [
  { formatoId: "R-36", codigo: "032", x: -100, y: 150, infladoCm: 78 }, { formatoId: "R-36", codigo: "032", x: 105, y: 150 },
  { formatoId: "R-24", codigo: "005", x: 0, y: 108 },
];
const trazo = (extra: Partial<ParametrosTrazoOrganico> = {}): ParametrosTrazoOrganico => {
  const puntos = puntosDeSilueta("feston", { anchoCm: 320, altoCm: 170, grosorCm: 100 });
  return { puntos: puntos.map((q, i) => (i === 0 || i === puntos.length - 1 ? { ...q, pesos: PESOS_CARGADOS } : q)), mezcla: { "R-12": 0.55, "R-9": 0.25, "R-5": 0.2 }, colores: [{ codigo: "032", peso: 50 }, { codigo: "005", peso: 50 }], racimos: 0.3, semilla: 9, fijos: FIJOS, ...extra };
};
const pieza = (t = trazo()): Organico => piezaDeGenerador({ tipo: "trazo", trazo: t }, null, 0);
const armar = (p: Organico) => { olvidarEmpaquesOrganicos(); return armarOrganico(p.opciones); };
const cuenta = (p: Organico, f: string) => armar(p).globos.filter((g) => g.formatoId === f).length;
const trazoDe = (p: Organico) => p.generador!.trazo;

console.log("Estirar el trazo");
/** El punto de la polilínea más cercano a `c` y la distancia (el oráculo de la prueba, aparte del código). */
function alEje(puntos: ReadonlyArray<{ x: number; y: number }>, c: { x: number; y: number }) {
  let mejor = { x: puntos[0]!.x, y: puntos[0]!.y, d: Infinity };
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i]!, b = puntos[i + 1]!, vx = b.x - a.x, vy = b.y - a.y;
    const u = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / (vx * vx + vy * vy)));
    const q = { x: a.x + vx * u, y: a.y + vy * u };
    const d = Math.hypot(c.x - q.x, c.y - q.y);
    if (d < mejor.d) mejor = { ...q, d };
  }
  return mejor;
}

prueba("más larga y más alta: los puntos conservan su mezcla; un fijo sobre el eje sigue al eje y uno fuera de él conserva su separación del eje", () => {
  const q = trazo().puntos[1]!;
  const fuera = { formatoId: "R-36", codigo: "032", x: q.x + 18, y: q.y - 22 };
  const t = trazo({ fijos: [{ formatoId: "R-24", codigo: "005", x: q.x, y: q.y }, fuera] });
  const e = escalarTrazo(t, { anchoCm: 480, altoCm: 220 });
  t.puntos.forEach((p, i) => assert.deepEqual(e.puntos[i]!.pesos, p.pesos, `punto ${i}`));
  const rango = (v: readonly number[]) => Math.max(...v) - Math.min(...v);
  assert.ok(rango(e.puntos.map((p) => p.x)) > rango(t.puntos.map((p) => p.x)) * 1.3, "el eje se estiró a lo ancho");
  const q2 = e.puntos[1]!;
  assert.ok(Math.hypot(e.fijos![0]!.x - q2.x, e.fijos![0]!.y - q2.y) < 0.2, "el fijo del eje sigue a su punto");
  // El de fuera: el punto del eje que tenía más cerca se estira con el eje y el vector que los separa se conserva.
  const pie = alEje(t.puntos, fuera);
  const [vx, vy] = [fuera.x - pie.x, fuera.y - pie.y];
  const g = e.fijos![1]!;
  const rel = (puntos: ReadonlyArray<{ x: number; y: number }>) => { const r = alEje(puntos, g); return { x: g.x - r.x, y: g.y - r.y }; };
  assert.ok(Math.hypot(g.x - e.puntos[1]!.x, g.y - e.puntos[1]!.y) > 1, "no quedó sobre el eje");
  assert.ok(Math.hypot(rel(e.puntos).x, rel(e.puntos).y) <= Math.hypot(vx, vy) + 0.5, "sigue pegado al eje, a lo más a su distancia de antes");
  assert.equal(g.formatoId, "R-36");
  assert.equal(g.codigo, "032");
});

prueba("más gruesa: el eje no se mueve y los fijos se alejan de él lo que crece el cuerpo (no se quedan enterrados)", () => {
  const q = trazo().puntos[2]!;
  const fijo = { formatoId: "R-36", codigo: "032", x: q.x + 4, y: q.y + 30 };
  const t = trazo({ fijos: [fijo] });
  const e = escalarTrazo(t, { grosor: 1.3 });
  assert.deepEqual(e.puntos[0]!.pesos, PESOS_CARGADOS);
  assert.ok(e.puntos[2]!.grosor > t.puntos[2]!.grosor);
  assert.deepEqual(e.puntos.map((p) => ({ x: p.x, y: p.y })), t.puntos.map((p) => ({ x: p.x, y: p.y })));
  const antes = alEje(t.puntos, fijo).d, despues = alEje(e.puntos, e.fijos![0]!).d;
  assert.ok(Math.abs(despues / antes - 1.3) < 0.02, `separación del eje ${antes.toFixed(1)} → ${despues.toFixed(1)}`);
});

prueba("la pieza armada con el trazo estirado lleva los fijos en su nuevo sitio", () => {
  const p = pieza();
  const ancha = ajustarTrazo(p, p.generador!, { ancho_cm: 460 });
  const f = trazoDe(ancha).fijos!;
  assert.equal(f.length, FIJOS.length);
  const armada = armar(ancha);
  for (const g of f) assert.ok(armada.globos.some((b) => b.codigo === g.codigo && b.formatoId === g.formatoId && Math.hypot(b.centro.x - g.x, b.centro.y - g.y) < 0.5), `fijo ${g.formatoId} en (${g.x}, ${g.y})`);
  assert.ok(f[1]!.x > FIJOS[1]!.x, "el fijo de la derecha se corrió a la derecha");
});

console.log("Espejar");
prueba("los fijos se reflejan en el generador y en las opciones; espejar dos veces devuelve el original", () => {
  const p = pieza();
  const { pieza: e, reflejada } = espejarPieza(p);
  assert.ok(reflejada);
  const m = e as Organico;
  assert.deepEqual(trazoDe(m).fijos!.map((f) => f.x), FIJOS.map((f) => -f.x));
  assert.deepEqual(m.opciones.fijos!.map((f) => f.x), FIJOS.map((f) => -f.x));
  assert.deepEqual(trazoDe(m).puntos.map((q) => q.pesos), trazoDe(p).puntos.map((q) => q.pesos));
  const armada = armar(m);
  for (const f of FIJOS) assert.ok(armada.globos.some((b) => b.codigo === f.codigo && b.formatoId === f.formatoId && Math.hypot(b.centro.x + f.x, b.centro.y - f.y) < 0.5), `el espejo de ${f.formatoId} en (${-f.x}, ${f.y})`);
  const de_vuelta = espejarPieza(m).pieza as Organico;
  assert.deepEqual(trazoDe(de_vuelta).fijos, FIJOS);
  assert.deepEqual(de_vuelta.opciones.fijos, p.opciones.fijos);
  assert.deepEqual(trazoDe(de_vuelta).puntos.map((q) => ({ x: q.x, y: q.y })), trazoDe(p).puntos.map((q) => ({ x: q.x, y: q.y })));
});

console.log("«Solo estos tamaños»");
prueba("la mezcla de los puntos y los fijos de los tamaños que ya no van se quitan", () => {
  const p = pieza();
  assert.ok(cuenta(p, "R-36") > 0, "antes lleva gigantes");
  const solo = ajustarTrazo(p, p.generador!, { tamanos: ["R-12", "R-5"] });
  const t = trazoDe(solo);
  assert.ok(t.puntos.every((q) => q.pesos === undefined), "ningún punto conserva la mezcla de antes");
  assert.equal(t.fijos, undefined, "los fijos eran de R-36 y R-24");
  assert.deepEqual(Object.keys(t.mezcla).sort(), ["R-12", "R-5"]);
  const armada = armar(solo);
  assert.equal(armada.globos.filter((g) => g.formatoId === "R-36" || g.formatoId === "R-24").length, 0, "ni un R-36 ni un R-24");
  // Un fijo de un tamaño que se queda, se queda.
  const conPequeno = pieza(trazo({ fijos: [...FIJOS, { formatoId: "R-12", codigo: "005", x: 30, y: 105 }] }));
  const t2 = trazoDe(ajustarTrazo(conPequeno, conPequeno.generador!, { tamanos: ["R-12", "R-5"] }));
  assert.deepEqual(t2.fijos, [{ formatoId: "R-12", codigo: "005", x: 30, y: 105 }]);
});

console.log("ajustar_tamanos con mezcla por punto y fijos");
prueba("«más R-24» sube aunque los puntos traigan su propia mezcla", () => {
  const p = pieza(trazo({ fijos: undefined }));
  const antes = cuenta(p, "R-24");
  const r = ajustarTamanos(p, { cambios: [{ formato: "R-24", accion: "mas" }] }, []);
  const despues = cuenta(r.pieza as Organico, "R-24");
  assert.ok(despues > antes, `R-24: ${antes} → ${despues}`);
});

prueba("«quitar R-36» quita también los fijos de ese formato", () => {
  const p = pieza();
  const r = ajustarTamanos(p, { cambios: [{ formato: "R-36", accion: "quitar" }] }, []);
  const t = trazoDe(r.pieza as Organico);
  assert.ok(!t.fijos?.some((f) => f.formatoId === "R-36"), JSON.stringify(t.fijos));
  assert.ok(t.fijos?.some((f) => f.formatoId === "R-24"), "los de otro formato siguen");
  assert.equal(cuenta(r.pieza as Organico, "R-36"), 0);
  assert.ok(t.puntos.every((q) => (q.pesos?.["R-36"] ?? 0) === 0));
});

prueba("«menos R-36» baja también los fijos de ese formato (no quedan los dos)", () => {
  const dos = pieza(trazo({ fijos: FIJOS }));
  const r = ajustarTamanos(dos, { cambios: [{ formato: "R-36", accion: "menos" }] }, []);
  const quedan = trazoDe(r.pieza as Organico).fijos!.filter((f) => f.formatoId === "R-36");
  assert.ok(quedan.length < 2, `quedan ${quedan.length} fijos R-36`);
  assert.ok(cuenta(r.pieza as Organico, "R-36") < cuenta(dos, "R-36"));
});

console.log("Un fijo que bajó de formato sigue siendo de su escalón");
// Un gigante dorado cromado: se dibuja como R-24 (el color no se fabrica en R-36) pero la foto lo pedía R-36.
const GIGANTE_BAJADO: GloboFijo = { formatoId: "R-24", formatoPedidoId: "R-36", codigo: "032", x: -100, y: 150, infladoCm: 70 };
prueba("«quitar R-36» y «solo R-12 y R-5» quitan el gigante dibujado como R-24 (cuenta por el formato pedido)", () => {
  const p = pieza(trazo({ fijos: [GIGANTE_BAJADO, { formatoId: "R-24", codigo: "005", x: 100, y: 150 }] }));
  const quitado = ajustarTamanos(p, { cambios: [{ formato: "R-36", accion: "quitar" }] }, []);
  const t = trazoDe(quitado.pieza as Organico);
  assert.deepEqual(t.fijos, [{ formatoId: "R-24", codigo: "005", x: 100, y: 150 }], "se queda el R-24 de verdad");
  const solo = trazoDe(ajustarTrazo(p, p.generador!, { tamanos: ["R-24", "R-12"] }));
  assert.equal(solo.fijos?.length, 2, "«solo R-24 y R-12» deja el gigante dibujado como R-24 (así sale en el inventario) y el R-24 verdadero");
  const sinR36 = trazoDe(ajustarTrazo(p, p.generador!, { tamanos: ["R-12", "R-5"] }));
  assert.equal(sinR36.fijos, undefined);
});

prueba("«quitar R-24» también quita el gigante dibujado como R-24 (el inventario lo muestra como R-24); un R-12 fijo no se toca", () => {
  const p = pieza(trazo({ fijos: [GIGANTE_BAJADO, { formatoId: "R-12", codigo: "005", x: 20, y: 105 }] }));
  const r = ajustarTamanos(p, { cambios: [{ formato: "R-24", accion: "quitar" }] }, []);
  assert.deepEqual(trazoDe(r.pieza as Organico).fijos, [{ formatoId: "R-12", codigo: "005", x: 20, y: 105 }]);
  // Y lo cuentan igual «quitar R-36» y «solo R-12 y R-5».
  assert.equal(trazoDe(ajustarTamanos(p, { cambios: [{ formato: "R-36", accion: "quitar" }] }, []).pieza as Organico).fijos?.length, 1);
  assert.deepEqual(trazoDe(ajustarTrazo(p, p.generador!, { tamanos: ["R-12", "R-5"] })).fijos, [{ formatoId: "R-12", codigo: "005", x: 20, y: 105 }]);
});

console.log(`test-trazo-edicion-fijos: ${pruebas} pruebas ok`);
