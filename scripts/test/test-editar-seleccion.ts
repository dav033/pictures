/**
 * `editar_globos` (src/lib/globos3d/editar-seleccion.ts + herramientas-escena-editar.ts): la edición PRECISA por selector
 * que pidió el dueño — «cambia los Link-O-Loon de la decoración» cambiaba toda la pieza; «cambia los colores de un
 * tamaño» cambiaba todos los tamaños. Sin coste (no llama a ninguna IA ni a la red): aplica la herramienta como el
 * modelo y comprueba ARMANDO cada pieza que solo cambió lo seleccionado.
 *   npx tsx scripts/test/test-editar-seleccion.ts
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { SALA_INICIAL, type Colocacion, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { ARBOLES_PREDEFINIDOS } from "../../src/lib/globos3d/arboles-globos";
import { columnaClasica, piezaNueva } from "../../src/lib/globos3d/escenas-presets";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { elementosDe, etiquetar } from "../../src/lib/globos3d/seleccion-datos";
import { editarSeleccion } from "../../src/lib/globos3d/editar-seleccion";
import { aplicarRepintes } from "../../src/lib/globos3d/repintes";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { const t = Date.now(); fn(); pruebas += 1; console.log(`  ✓ ${nombre} (${Date.now() - t} ms)`); };

const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => {
  if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`);
  return r;
};
const error = (r: ResultadoHerramienta, contiene: RegExp): string => {
  if (r.ok) assert.fail(`se esperaba error y vino: ${r.resumen}`);
  assert.match(r.error, contiene);
  return r.error;
};
const piso = (x: number): Colocacion => ({ en: "piso", xCm: x, zCm: 0, giroGrados: 0 });
const escena = (...nodos: Array<{ id: string; pieza: Pieza; colocacion?: Colocacion }>): Escena => ({
  sala: structuredClone(SALA_INICIAL),
  nodos: nodos.map((n, i): NodoEscena => ({ id: n.id, nombre: n.id, pieza: n.pieza, colocacion: n.colocacion ?? piso(-200 + i * 120) })),
});
const pieza = (e: Escena, id: string): Pieza => { const n = e.nodos.find((x) => x.id === id); assert.ok(n, `falta ${id}`); return n.pieza; };
const editar = (e: Escena, args: Record<string, unknown>) => ok(aplicarHerramienta(e, "editar_globos", args));
const elementos = (p: Pieza) => elementosDe(armarPieza(p));
/** Los elementos (globos y tubitos) que cambiaron de color o de formato, por índice (misma forma). */
function cambiosPorIndice(a: Pieza, b: Pieza): { cambiados: number[]; total: number } {
  const x = elementos(a), y = elementos(b);
  assert.equal(y.length, x.length, "misma cantidad de globos");
  const cambiados = x.flatMap((e, i) => (e.codigo !== y[i]!.codigo || e.formatoId !== y[i]!.formatoId ? [i] : []));
  return { cambiados, total: x.length };
}
const codigoDe = (formato: string, nombre: RegExp) => coloresDelFormato(formato).find((c) => nombre.test(c.nombreCompleto))!.codigo;

const flor = (conCorona: boolean): Pieza => ({
  tipo: "decoracion",
  decoracion: {
    tipo: "flor",
    propiedades: {
      petalos: { formatoId: "R-9", infladoCm: 18, codigo: "009", cantidad: 5, aperturaGrados: 20, giroGrados: 0 },
      centro: { formatoId: "R-5", infladoCm: 9, codigo: "570", cantidad: 1 },
      ...(conCorona ? { corona: { formatoId: "R-5", infladoCm: 9, codigo: "012", cantidad: 6 } } : {}),
    },
  },
});
const palmera = (): Pieza => ({ tipo: "arbol_globos", arbol: structuredClone(ARBOLES_PREDEFINIDOS[0]!.arbol) });

console.log("editar_globos — edición precisa por formato, parte y color");

prueba("la herramienta está declarada para el modelo", () => {
  const d = DECLARACIONES_ESCENA.find((x) => x.name === "editar_globos");
  assert.ok(d, "editar_globos declarada");
  assert.match(d.description, /PRECISA/);
});

prueba("palmera: «las hojas (tubitos) en azul» cambia SOLO las hojas; el tronco, la base y los cocos quedan igual", () => {
  const e = escena({ id: "palma", pieza: palmera() });
  const antes = pieza(e, "palma");
  const r = editar(e, { id: "palma", formatos: ["T-*"], cambio: { color: "azul" } });
  const despues = pieza(r.escena, "palma");
  const x = elementos(antes), y = elementos(despues);
  const { cambiados } = cambiosPorIndice(antes, despues);
  const tubitos = x.flatMap((g, i) => (g.formatoId === "T-260" ? [i] : []));
  assert.ok(tubitos.length >= 9, `hojas: ${tubitos.length}`);
  assert.deepEqual(cambiados, tubitos, "cambian exactamente los T-260");
  const azul = y[tubitos[0]!]!.codigo;
  assert.ok(tubitos.every((i) => y[i]!.codigo === azul), "todas las hojas del mismo azul");
  assert.ok(despues.tipo === "arbol_globos" && despues.arbol.copa.tipo === "palmera" && despues.arbol.copa.hojas.codigos.every((c) => c === azul), "cambió el DATO de las hojas");
  assert.deepEqual(despues.tipo === "arbol_globos" && despues.arbol.tronco, antes.tipo === "arbol_globos" && antes.arbol.tronco, "el tronco no se tocó");
  assert.match(r.resumen, /sin tocar: \d+ globos/);
  assert.match(r.resumen, /antes: .*T-260.* → después: .*T-260/);
});

prueba("palmera con hojas de Link-O-Loon: «los LOL de la decoración» a otro color (por familia y por parte) solo cambia las hojas", () => {
  const p = palmera();
  if (p.tipo !== "arbol_globos" || p.arbol.copa.tipo !== "palmera") throw new Error("palmera");
  const verde = coloresDelFormato("LOL-660").find((c) => /verde/i.test(c.nombreCompleto))!.codigo;
  p.arbol.copa.hojas = { ...p.arbol.copa.hojas, formatoId: "LOL-660", codigos: [verde] };
  const e = escena({ id: "palma", pieza: p });
  const otro = coloresDelFormato("LOL-660").find((c) => c.codigo !== verde && !/verde/i.test(c.nombreCompleto))!.codigo;
  // Dorado no viene en LOL-660: el error dice el más parecido que sí.
  error(aplicarHerramienta(e, "editar_globos", { id: "palma", formatos: ["LOL"], cambio: { color: "dorado" } }), /no se fabrica en LOL-660\. El más parecido/);
  for (const args of [{ formatos: ["LOL"] }, { partes: ["hojas"] }]) {
    const r = editar(e, { id: "palma", ...args, cambio: { color: otro } });
    const { cambiados } = cambiosPorIndice(p, pieza(r.escena, "palma"));
    const lol: number[] = elementos(p).flatMap((g, i) => (g.formatoId === "LOL-660" ? [i] : []));
    assert.ok(lol.length > 0);
    assert.deepEqual(cambiados, lol, `${JSON.stringify(args)}: solo los LOL-660`);
  }
});

prueba("flor: «la corona en dorado» cambia SOLO los 6 de la corona (los pétalos y el centro siguen igual)", () => {
  const e = escena({ id: "flor", pieza: flor(true) });
  const r = editar(e, { id: "flor", partes: ["corona"], cambio: { color: "dorado" } });
  const antes = pieza(e, "flor"), despues = pieza(r.escena, "flor");
  const { cambiados } = cambiosPorIndice(antes, despues);
  assert.equal(cambiados.length, 6, "los 6 de la corona");
  assert.ok(despues.tipo === "decoracion" && despues.decoracion.tipo === "flor" && antes.tipo === "decoracion" && antes.decoracion.tipo === "flor");
  assert.deepEqual(despues.decoracion.propiedades.petalos, antes.decoracion.propiedades.petalos);
  assert.deepEqual(despues.decoracion.propiedades.centro, antes.decoracion.propiedades.centro);
  assert.notEqual(despues.decoracion.propiedades.corona!.codigo, "012");
  assert.match(r.resumen, /cambié de color 6 de 6 globos seleccionados \(estrategia datos\); antes: corona R-5 .* → después: corona R-5 .*sin tocar: 6 globos/);
});

prueba("guirnalda orgánica: «los R-24 a azul reflex» cambia solo los R-24 (misma cantidad, otro color) y los demás tamaños quedan globo a globo", () => {
  const e0 = ok(aplicarHerramienta(escena(), "agregar_pieza", { tipo: "trazo_organico", silueta: "feston", colores: ["rosado pastel", "blanco"] })).escena;
  const id = e0.nodos[0]!.id;
  const antes = pieza(e0, id);
  const r = editar(e0, { id, formatos: ["R-24"], cambio: { color: "azul reflex" } });
  const despues = pieza(r.escena, id);
  const x = elementos(antes), y = elementos(despues);
  const { cambiados } = cambiosPorIndice(antes, despues);
  const r24 = x.flatMap((g, i) => (g.formatoId === "R-24" ? [i] : []));
  assert.ok(r24.length > 0, "hay R-24");
  const azul = y[r24[0]!]!.codigo;
  assert.ok(r24.every((i) => y[i]!.codigo === azul), "todos los R-24 del mismo azul");
  assert.ok(cambiados.every((i) => x[i]!.formatoId === "R-24"), "solo cambian R-24");
  assert.equal(y.filter((g) => g.formatoId === "R-24").length, r24.length, "misma cantidad de R-24");
  // Los materiales siguen a los globos.
  const mat = armarPieza(despues).materiales.filter((m) => m.formatoId === "R-24");
  assert.deepEqual(mat.map((m) => [m.codigo, m.cantidad]), [[azul, r24.length]], "materiales de R-24");
  assert.match(r.resumen, /R-24/);
  // La regla vale aunque la pieza cambie: más R-24 y siguen azules.
  const mas = ok(aplicarHerramienta(r.escena, "ajustar_tamanos", { id, cambios: [{ formato: "R-24", accion: "mas" }] }));
  const z = elementos(pieza(mas.escena, id)).filter((g) => g.formatoId === "R-24");
  assert.ok(z.length > r24.length && z.every((g) => g.codigo === azul), "los R-24 nuevos también azules");
  // Y si después se piden los R-24 en rojo con ajustar_tamanos, manda lo último (el repinte de esos tamaños se quita).
  const rojo = ok(aplicarHerramienta(mas.escena, "ajustar_tamanos", { id, colores_por_tamano: [{ formatos: ["R-24"], colores: ["rojo"] }] }));
  const w = elementos(pieza(rojo.escena, id)).filter((g) => g.formatoId === "R-24");
  assert.ok(w.length > 0 && w.every((g) => g.codigo !== azul), "los R-24 ya no son azules");
  assert.equal(pieza(rojo.escena, id).repintes?.length ?? 0, 0);
});

prueba("arco orgánico: «el rosado a lila» en todo el arco se hace en la paleta (exacto) y no toca los otros colores", () => {
  const { pieza: arco } = piezaNueva("arco_organico");
  const e = escena({ id: "arco", pieza: arco });
  const r = editar(e, { id: "arco", cambio: { de: "rosado", a: "lila" } });
  const { cambiados } = cambiosPorIndice(arco, pieza(r.escena, "arco"));
  const x = elementos(arco);
  assert.ok(cambiados.length > 0 && cambiados.every((i) => x[i]!.codigo === "609"), "solo los 609");
  assert.equal(cambiados.length, x.filter((g) => g.codigo === "609").length, "todos los 609");
  assert.match(r.resumen, /\(estrategia paleta\)/);
});

prueba("columna clásica: «el blanco a dorado» y «de rojo a negro» solo cambian esos globos", () => {
  const e = escena({ id: "col", pieza: columnaClasica(180, ["609", "005"]) });
  const antes = pieza(e, "col");
  const x = elementos(antes);
  const r = editar(e, { id: "col", colores: ["blanco"], cambio: { color: "dorado" } });
  const { cambiados } = cambiosPorIndice(antes, pieza(r.escena, "col"));
  assert.deepEqual(cambiados, x.flatMap((g, i) => (g.codigo === "005" ? [i] : [])));
  const r2 = editar(r.escena, { id: "col", cambio: { de: "609", a: "negro" } });
  const dos = cambiosPorIndice(pieza(r.escena, "col"), pieza(r2.escena, "col"));
  assert.deepEqual(dos.cambiados, x.flatMap((g, i) => (g.codigo === "609" ? [i] : [])));
});

prueba("pared de Link-O-Loon: LOL-12 → LOL-6 cambia el formato (con su inflado) y deja la unión R-5 con su color", () => {
  const { pieza: pared, colocacion } = piezaNueva("pared");
  if (pared.tipo !== "pared_malla") throw new Error("pared");
  const colores = pared.colores.filter((c) => coloresDelFormato("LOL-6").some((x) => x.codigo === c));
  const base: Pieza = { ...pared, colores: colores.length ? colores : [coloresDelFormato("LOL-6")[0]!.codigo], patron: colores.length >= 4 ? pared.patron : "un_color" };
  const e = escena({ id: "pared", pieza: base, colocacion });
  const r = editar(e, { id: "pared", formatos: ["LOL-12"], cambio: { formato: "LOL-6" } });
  const p = pieza(r.escena, "pared");
  assert.ok(p.tipo === "pared_malla" && p.formatoId === "LOL-6" && p.infladoCm === 12, "formato e inflado de LOL-6");
  const y = elementos(p);
  assert.ok(y.some((g) => g.formatoId === "LOL-6") && !y.some((g) => g.formatoId === "LOL-12"), "ya no hay LOL-12");
  assert.ok(y.filter((g) => g.formatoId === "R-5").every((g) => g.codigo === base.union.codigo), "la unión conserva su color");
  assert.match(r.resumen, /LOL-6/);
  // Un color que no viene en LOL-6: error con el más parecido.
  const sinLol6 = coloresDelFormato("LOL-12").find((c) => !coloresDelFormato("LOL-6").some((x) => x.codigo === c.codigo));
  if (sinLol6) error(aplicarHerramienta(r.escena, "editar_globos", { id: "pared", formatos: ["LOL-6"], cambio: { color: sinLol6.codigo } }), /no se fabrica en LOL-6\. El más parecido que sí viene en LOL-6 es/);
  // La pared de fábrica lleva colores que no vienen en LOL-6: pasarla a LOL-6 dice cuál y el más parecido.
  error(aplicarHerramienta(escena({ id: "pared", pieza: pared, colocacion }), "editar_globos", { id: "pared", formatos: ["LOL-12"], cambio: { formato: "LOL-6" } }), /LOL-6 no viene en .*el más parecido que sí viene en LOL-6 es/);
});

prueba("flor: «quita el centro» lo quita de los datos (centro: null) y los pétalos y la corona quedan igual", () => {
  const e = escena({ id: "flor", pieza: flor(true) });
  const r = editar(e, { id: "flor", partes: ["centro"], cambio: { quitar: true } });
  const p = pieza(r.escena, "flor");
  assert.ok(p.tipo === "decoracion" && p.decoracion.tipo === "flor" && p.decoracion.propiedades.centro === null);
  const antes = etiquetar(pieza(e, "flor")).elementos.length, despues = elementos(p).length;
  assert.equal(despues, antes - 1, "un globo menos");
  assert.doesNotMatch(r.resumen, /OJO/, "nada de fuera cambió");
  // El tronco no se quita: error que dice qué sí se puede.
  error(aplicarHerramienta(escena({ id: "palma", pieza: palmera() }), "editar_globos", { id: "palma", partes: ["tronco"], formatos: ["R-9"], cambio: { quitar: true } }), /no se puede quitar/);
});

prueba("cambiar el formato de una parte: la corona de R-5 a R-9 (inflado de decoración); los pétalos siguen igual", () => {
  const e = escena({ id: "flor", pieza: flor(true) });
  const r = editar(e, { id: "flor", partes: ["corona"], cambio: { formato: "R-9" } });
  const p = pieza(r.escena, "flor");
  assert.ok(p.tipo === "decoracion" && p.decoracion.tipo === "flor");
  assert.equal(p.decoracion.propiedades.corona!.formatoId, "R-9");
  assert.equal(p.decoracion.propiedades.corona!.infladoCm, 18);
  assert.equal(p.decoracion.propiedades.centro!.formatoId, "R-5", "el centro (también R-5) no cambió");
  error(aplicarHerramienta(e, "editar_globos", { id: "flor", partes: ["corona"], cambio: { formato: "LOL-12" } }), /misma familia/);
});

prueba("una selección que no encaja: error claro con lo que la pieza sí tiene", () => {
  const e = escena({ id: "flor", pieza: flor(false) });
  error(aplicarHerramienta(e, "editar_globos", { id: "flor", formatos: ["LOL-12"], cambio: { color: "rojo" } }), /Ningún globo.*Tiene: formatos R-5, R-9; partes centro, petalos/);
  error(aplicarHerramienta(e, "editar_globos", { id: "flor", colores: ["negro"], cambio: { color: "rojo" } }), /no lleva «negro»/);
  error(aplicarHerramienta(e, "editar_globos", { formatos: ["T-260"], cambio: { color: "rojo" } }), /Ningún globo de la escena/);
  error(aplicarHerramienta(e, "editar_globos", { id: "flor", cambio: { color: "rojo", quitar: true } }), /pasa UNO/);
});

prueba("sin id: «los centros en rojo» cambia el centro de las dos flores y no toca la columna", () => {
  const e = escena({ id: "flor-a", pieza: flor(false) }, { id: "flor-b", pieza: flor(true) }, { id: "col", pieza: columnaClasica(180, ["609", "005"]) });
  const r = editar(e, { partes: ["centro"], cambio: { color: "rojo" } });
  for (const id of ["flor-a", "flor-b"]) {
    const { cambiados } = cambiosPorIndice(pieza(e, id), pieza(r.escena, id));
    assert.equal(cambiados.length, 1, `${id}: solo el centro`);
  }
  assert.deepEqual(pieza(r.escena, "col"), pieza(e, "col"), "la columna no cambió");
  assert.match(r.resumen, /Edité 2 piezas/);
});

prueba("el motor directo: antes/después exactos y repinte con materiales consistentes", () => {
  const p = columnaClasica(120, ["609", "005"]);
  const r = editarSeleccion(p, { colores: ["005"] }, { tipo: "color", codigo: "570" });
  const blancos = elementos(p).filter((g) => g.codigo === "005").length;
  assert.equal(r.cambiados, blancos);
  assert.equal(r.seleccionados, blancos);
  assert.deepEqual(r.ajenosCambiados, []);
  assert.equal(r.despues.find((l) => l.codigo === "570")?.cantidad, blancos);
  const armada = armarPieza(p);
  const repintada = aplicarRepintes(armada, [{ colores: ["005"], codigo: "570" }]);
  assert.deepEqual(repintada.materiales.filter((m) => m.codigo === "570").map((m) => m.cantidad), [blancos]);
  assert.ok(!repintada.materiales.some((m) => m.codigo === "005"));
});

console.log(`\n${pruebas} pruebas en verde.`);
