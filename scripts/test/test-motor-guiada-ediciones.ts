/**
 * Las ediciones del cliente sobre la espec del motor 3D (REQ-007, fase 5): operaciones puras, honestas y acotadas. Sin red,
 * sin coste y sin modelo.
 * - cada operación como unidad, con sus avisos («puse el más parecido», «quedó en 5 m») y sus «No pude: …»;
 * - una tanda parcial dice lo que hizo y lo que no (D-023);
 * - garantía de «sin arrastrar ni crear»: ninguna operación mete geometría fuera de la lista oficial, las piezas que no se
 *   nombran quedan idénticas y toda espec editada sigue cumpliendo su contrato y se vuelve a armar;
 * - la caché de piezas: una edición rearma solo la pieza que cambió y los materiales salen iguales.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-ediciones.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ESTRUCTURAS_OFICIALES_IDS } from "../../src/lib/plan/estructuras-oficiales";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import { MAX_PIEZAS_PLAN } from "../../src/lib/plan/piezas-individuales";
import {
  aplicarEdicion, aplicarEdiciones, armarDesdeEspec, crearCachePiezas, EdicionEspecV1Schema, especDesdeIdeaGuardada, especDesdePropuesta, OPERACIONES_EDICION,
  PREFIJO_NO_PUDE, type EdicionEspecV1, type EspecClienteV1, type PiezaEspec,
} from "../../src/lib/globos3d/motor/v1";
import { EspecClienteV1Schema } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { medidasEditables } from "../../src/lib/globos3d/motor/rangos-medidas";

type Propuesta = Parameters<typeof especDesdePropuesta>[0];
const espec = (piezas: Propuesta["piezas"], colores: Propuesta["colores"] = ["azul", "dorado"]): EspecClienteV1 => especDesdePropuesta({ frase: "x", colores, piezas }).espec;
const BASE = espec([{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }]);
const [ARCO, IZQ, DER] = ["EST_01_ARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"] as const;
const pieza = (e: EspecClienteV1, id: string): PiezaEspec => e.piezas.find((p) => p.id === id)!;
const suma = (p: PiezaEspec): number => p.colores.reduce((total, c) => total + c.peso, 0);
const nombres = (p: PiezaEspec): string[] => p.colores.map((c) => c.nombre);
const ok = (e: EspecClienteV1, edicion: EdicionEspecV1) => {
  const r = aplicarEdicion(e, edicion);
  assert.equal(r.noAplicado, undefined, `se esperaba hecho y fue: ${r.noAplicado}`);
  assert.deepEqual(EspecClienteV1Schema.safeParse(r.espec).success, true, "la espec editada cumple su contrato");
  return r;
};
const noPudo = (e: EspecClienteV1, edicion: EdicionEspecV1, patron: RegExp) => {
  const r = aplicarEdicion(e, edicion);
  assert.ok(r.noAplicado?.startsWith(PREFIJO_NO_PUDE), `debía decir «No pude: …» y dijo ${r.noAplicado}`);
  assert.match(r.noAplicado!, patron);
  assert.deepEqual(r.espec, e, "si no se pudo, la espec es la misma");
  assert.deepEqual(r.tocadas, []);
  return r;
};
/** Las piezas que no están en `ids` quedan idénticas. */
const restoIgual = (antes: EspecClienteV1, despues: EspecClienteV1, ids: readonly string[]) => {
  for (const p of antes.piezas) if (!ids.includes(p.id)) assert.deepEqual(pieza(despues, p.id), p, `${p.id} no se debía tocar`);
};

test("reemplazar_color: cambia el color donde está, conserva el peso y deja lo demás igual", () => {
  const r = ok(BASE, { op: "reemplazar_color", de: "azul", a: "rojo" });
  for (const id of [ARCO, IZQ, DER]) {
    assert.deepEqual(nombres(pieza(r.espec, id)), ["rojo", "dorado"]);
    assert.deepEqual(pieza(r.espec, id).colores.map((c) => c.peso), [0.5, 0.5]);
  }
  assert.deepEqual(r.tocadas, [ARCO, IZQ, DER]);
  assert.match(r.descripcion, /cambié azul por rojo en todo el plan/);
  assert.equal(r.espec.origen.tipo, "edicion");
  // Solo en una pieza.
  const una = ok(BASE, { op: "reemplazar_color", de: "azul", a: "celeste", piezas: [IZQ] });
  assert.deepEqual(nombres(pieza(una.espec, IZQ)), ["celeste", "dorado"]);
  restoIgual(BASE, una.espec, [IZQ]);
  assert.match(una.descripcion, /en la columna izquierda/);
  // Por código Sempertex.
  assert.equal(pieza(ok(BASE, { op: "reemplazar_color", de: "040", a: "970", piezas: [ARCO] }).espec, ARCO).colores.length, 1, "si el color nuevo ya estaba, se suman sus pesos y la pieza lleva uno menos");
  assert.equal(pieza(ok(BASE, { op: "reemplazar_color", de: "040", a: "970", piezas: [ARCO] }).espec, ARCO).colores[0]!.peso, 1);
});

test("reemplazar_color dice «No pude: …» si el color no existe, no está o la pieza no es del plan", () => {
  noPudo(BASE, { op: "reemplazar_color", de: "azul", a: "colorquenoexiste" }, /no reconozco el color/);
  noPudo(BASE, { op: "reemplazar_color", de: "verde", a: "rojo" }, /tu plan no lleva verde/);
  noPudo(BASE, { op: "reemplazar_color", de: "azul", a: "rojo", piezas: ["EST_09_ARCO"] }, /no encontré esa pieza/);
  noPudo(BASE, { op: "reemplazar_color", de: "azul", a: "azul" }, /ya lleva/);
});

test("un color que la pieza no fabrica en su globo se cambia por el más parecido y se dice", () => {
  const pared = espec([{ estructura: "pared_densa", cantidad: 1 }]);
  const sinLol = TABLA_SEMPERTEX.referencias.find((r) => !r.formatos.includes("LOL-12"))!;
  const r = ok(pared, { op: "reemplazar_color", de: "dorado", a: sinLol.codigo });
  const puesto = pieza(r.espec, "EST_01_PARED_DENSA").colores.find((c) => c.codigo !== "040")!;
  assert.notEqual(puesto.codigo, sinLol.codigo, "no se dejó un color que ese globo no fabrica");
  assert.ok(TABLA_SEMPERTEX.referencias.find((x) => x.codigo === puesto.codigo)!.formatos.includes("LOL-12"), "el que se puso sí se fabrica");
  assert.ok(r.avisos.some((a) => a.includes(sinLol.nombre) && /no se fabrica/.test(a) && /el más parecido/.test(a)), `el aviso lo dice: ${r.avisos.join(" | ")}`);
  // El motor arma lo que quedó.
  assert.deepEqual(armarDesdeEspec(r.espec).noRepresentable, []);
});

test("agregar_color: lo suma con parte pareja, no repite y respeta el máximo de colores", () => {
  const r = ok(BASE, { op: "agregar_color", color: "rosado" });
  for (const id of [ARCO, IZQ, DER]) {
    const p = pieza(r.espec, id);
    assert.equal(p.colores.length, 3);
    assert.ok(Math.abs(suma(p) - 1) < 0.002);
    assert.ok(p.colores[2]!.peso > 0.3 && p.colores[2]!.peso < 0.36, "parte pareja");
  }
  noPudo(BASE, { op: "agregar_color", color: "dorado" }, /esas piezas ya llevan ese color/);
  assert.ok(aplicarEdicion(BASE, { op: "agregar_color", color: "dorado" }).avisos.some((a) => /ya lleva dorado/.test(a)), "dice cuál ya lo lleva");
  noPudo(BASE, { op: "agregar_color", color: "zzz" }, /no reconozco/);
  // Seis colores es el tope de una pieza.
  const seis = espec([{ estructura: "semiarco_asimetrico", cantidad: 1 }], ["azul", "dorado", "rojo", "verde", "blanco", "negro"]);
  assert.equal(pieza(seis, "EST_01_SEMIARCO_ASIMETRICO").colores.length, 6);
  const tope = aplicarEdicion(seis, { op: "agregar_color", color: "rosado" });
  assert.match(tope.noAplicado!, /^No pude: /);
  assert.ok(tope.avisos.some((a) => /máximo de 6 colores/.test(a)));
  // Un color a una sola pieza; las demás quedan igual.
  const una = ok(BASE, { op: "agregar_color", color: "rosado", piezas: [DER] });
  assert.equal(pieza(una.espec, DER).colores.length, 3);
  restoIgual(BASE, una.espec, [DER]);
});

test("quitar_color: los demás toman su lugar y una pieza nunca se queda sin color", () => {
  const r = ok(BASE, { op: "quitar_color", color: "dorado" });
  for (const id of [ARCO, IZQ, DER]) assert.deepEqual(pieza(r.espec, id).colores.map((c) => [c.nombre, c.peso]), [["azul", 1]]);
  const uno = espec([{ estructura: "arco", cantidad: 1 }], ["azul"]);
  noPudo(uno, { op: "quitar_color", color: "azul" }, /al menos un color/);
  noPudo(BASE, { op: "quitar_color", color: "verde" }, /tu plan no lleva verde/);
  const solo = ok(BASE, { op: "quitar_color", color: "azul", piezas: [IZQ] });
  restoIgual(BASE, solo.espec, [IZQ]);
  // En una tanda, la pieza de un solo color se salta y se dice; las demás sí cambian.
  const mezcla = aplicarEdicion(aplicarEdicion(BASE, { op: "quitar_color", color: "dorado", piezas: [IZQ] }).espec, { op: "quitar_color", color: "azul" });
  assert.ok(mezcla.avisos.some((a) => /la columna izquierda necesita al menos un color/.test(a)));
  assert.deepEqual(mezcla.tocadas, [ARCO, DER]);
});

test("proporcion_color: pesos normalizados, ninguno bajo el mínimo y «No pude» si no cuadra", () => {
  const r = ok(BASE, { op: "proporcion_color", pieza: ARCO, pesos: [3, 1] });
  assert.deepEqual(pieza(r.espec, ARCO).colores.map((c) => c.peso), [0.75, 0.25]);
  assert.match(r.descripcion, /75 % azul y 25 % dorado/);
  restoIgual(BASE, r.espec, [ARCO]);
  const minimo = aplicarEdicion(BASE, { op: "proporcion_color", pieza: ARCO, pesos: [99, 1] });
  assert.equal(minimo.noAplicado, undefined);
  assert.ok(pieza(minimo.espec, ARCO).colores.every((c) => c.peso >= 0.05), "ningún color baja de 5 %");
  assert.ok(minimo.avisos.some((a) => /al menos 5 %/.test(a)));
  noPudo(BASE, { op: "proporcion_color", pieza: ARCO, pesos: [1, 1, 1] }, /lleva 2 colores y me diste 3/);
  noPudo(BASE, { op: "proporcion_color", pieza: ARCO, pesos: [1, 1] }, /ya lleva esa proporción/);
  noPudo(BASE, { op: "proporcion_color", pieza: "EST_07_ARCO", pesos: [1, 2] }, /no encontré esa pieza/);
});

test("mas_menos_color: mueve la parte del color y las demás se reparten el resto; en el límite dice que no puede", () => {
  const mas = ok(BASE, { op: "mas_menos_color", color: "dorado", direccion: 1, piezas: [ARCO] });
  const [azul, dorado] = pieza(mas.espec, ARCO).colores;
  assert.ok(dorado!.peso > 0.5 && azul!.peso < 0.5 && Math.abs(azul!.peso + dorado!.peso - 1) < 0.002);
  assert.match(mas.descripcion, /puse más dorado en el arco/);
  let actual = BASE;
  for (let i = 0; i < 12; i += 1) actual = aplicarEdicion(actual, { op: "mas_menos_color", color: "dorado", direccion: 1, piezas: [ARCO] }).espec;
  assert.ok(pieza(actual, ARCO).colores.every((c) => c.peso >= 0.05), "el otro color nunca baja de 5 %");
  const tope = aplicarEdicion(actual, { op: "mas_menos_color", color: "dorado", direccion: 1, piezas: [ARCO] });
  assert.match(tope.noAplicado!, /ya llevan todo el dorado que admiten/);
  noPudo(BASE, { op: "mas_menos_color", color: "verde", direccion: 1 }, /tu plan no lleva verde/);
  const uno = espec([{ estructura: "arco", cantidad: 1 }], ["azul"]);
  const unico = aplicarEdicion(uno, { op: "mas_menos_color", color: "azul", direccion: -1 });
  assert.match(unico.noAplicado!, /^No pude: /);
  assert.ok(unico.avisos.some((a) => /un solo color/.test(a)));
});

test("tamano_pieza: agranda o achica un 10 %, escribe medidas, las acota a lo que el constructor arma y lo dice", () => {
  const mas = ok(BASE, { op: "tamano_pieza", pieza: ARCO, direccion: 1 });
  assert.deepEqual(pieza(mas.espec, ARCO).medidas, { anchoM: 3.3, altoM: 2.64 });
  assert.match(mas.descripcion, /agrandé el arco/);
  restoIgual(BASE, mas.espec, [ARCO]);
  const menos = ok(mas.espec, { op: "tamano_pieza", pieza: ARCO, direccion: -1 });
  assert.ok(pieza(menos.espec, ARCO).medidas.anchoM! < 3.3);
  const escrita = ok(BASE, { op: "tamano_pieza", pieza: IZQ, medidas: { altoM: 2.5 } });
  assert.deepEqual(pieza(escrita.espec, IZQ).medidas, { altoM: 2.5 });
  // Fuera de rango: se acota y se dice.
  const fuera = ok(BASE, { op: "tamano_pieza", pieza: IZQ, medidas: { altoM: 9 } });
  assert.equal(pieza(fuera.espec, IZQ).medidas.altoM, 5);
  assert.ok(fuera.avisos.some((a) => /9 m queda fuera de lo que se arma \(de 0,6 m a 5 m\); quedó en 5 m/.test(a)), fuera.avisos.join("|"));
  // En el límite, dice que ya no puede.
  const maxima = espec([{ estructura: "columna", cantidad: 1 }]);
  const enTope = ok(maxima, { op: "tamano_pieza", pieza: "EST_01_COLUMNA", medidas: { altoM: 5 } });
  noPudo(enTope.espec, { op: "tamano_pieza", pieza: "EST_01_COLUMNA", direccion: 1 }, /ya está en su tamaño máximo/);
  // Una medida que la pieza no usa se ignora diciéndolo; sola, no hace nada.
  const ancho = aplicarEdicion(BASE, { op: "tamano_pieza", pieza: IZQ, medidas: { anchoM: 0.8 } });
  assert.equal(ancho.noAplicado, undefined, "la columna con una sola medida (el alto) recibe la que se pidió");
  assert.equal(pieza(ancho.espec, IZQ).medidas.altoM, 0.8);
  noPudo(BASE, { op: "tamano_pieza", pieza: "EST_09_ARCO", direccion: 1 }, /no encontré esa pieza/);
});

test("tamano_pieza: un aro se mide por su diámetro, una columna con capas manda por el alto nuevo y una pieza sin metros no cambia", () => {
  const aro = espec([{ estructura: "aro_circular", cantidad: 1 }]);
  const r = ok(aro, { op: "tamano_pieza", pieza: "EST_01_ARO_CIRCULAR", medidas: { altoM: 2 } });
  assert.deepEqual(pieza(r.espec, "EST_01_ARO_CIRCULAR").medidas, { anchoM: 2, altoM: 2 }, "el alto pedido es el diámetro y el alto lo sigue");
  const conCapas: EspecClienteV1 = { ...BASE, piezas: BASE.piezas.map((p) => (p.id === IZQ ? { ...p, capas: 11, medidas: { altoM: 2 } } : p)) };
  const columna = ok(conCapas, { op: "tamano_pieza", pieza: IZQ, direccion: 1 });
  assert.equal(pieza(columna.espec, IZQ).capas, undefined, "las capas viejas no pelean con el alto nuevo");
  assert.equal(pieza(columna.espec, IZQ).medidas.altoM, 2.2);
  const sinMetros: EspecClienteV1 = { ...BASE, piezas: [...BASE.piezas, { ...pieza(BASE, ARCO), id: "EST_04_FIGURA", oficial: "figura", nombre: "Figura con globos" }] };
  noPudo(sinMetros, { op: "tamano_pieza", pieza: "EST_04_FIGURA", direccion: 1 }, /no se mide en metros/);
});

test("tamano_globos: mueve la proporción de tamaños por la escala de MEZCLAS y dice cuando el armado cambia", () => {
  const organica = espec([{ estructura: "semiarco_asimetrico", cantidad: 1 }]);
  const id = "EST_01_SEMIARCO_ASIMETRICO";
  assert.equal(pieza(organica, id).tamanos, "organica_fina");
  let actual = organica;
  const escala: string[] = [];
  for (let paso = 0; paso < 3; paso += 1) {
    actual = ok(actual, { op: "tamano_globos", pieza: id, direccion: 1 }).espec;
    escala.push(pieza(actual, id).tamanos);
  }
  assert.deepEqual(escala, ["clasica", "organica_gruesa", "solo_grandes"], "de los globos más chicos a los más grandes");
  noPudo(actual, { op: "tamano_globos", pieza: id, direccion: 1 }, /ya llevan los globos más grandes/);
  noPudo(organica, { op: "tamano_globos", pieza: id, direccion: -1 }, /ya llevan los globos más pequeños/);
  // Un arco de cuartetos que pasa a globos de varios tamaños lo dice.
  const clasico = ok(BASE, { op: "tamano_globos", pieza: ARCO, direccion: 1 });
  assert.equal(pieza(clasico.espec, ARCO).tamanos, "organica_gruesa");
  assert.ok(clasico.avisos.some((a) => /pasa a armarse con globos de varios tamaños, ya no en cuartetos/.test(a)));
  restoIgual(BASE, clasico.espec, [ARCO]);
  // Sin pieza: todas las que se pueden; las de un solo tamaño se saltan.
  const pared = espec([{ estructura: "pared_densa", cantidad: 1 }]);
  noPudo(pared, { op: "tamano_globos", direccion: 1 }, /un solo tamaño/);
  const todas = ok(BASE, { op: "tamano_globos", direccion: 1 });
  assert.deepEqual(todas.tocadas, [ARCO, IZQ, DER]);
  // El motor arma lo que quedó (los globos cambian de tamaño).
  assert.deepEqual(armarDesdeEspec(todas.espec).noRepresentable, []);
});

test("tamano_globos: al pasar de cuartetos a globos de varios tamaños, la medida que no cabe en el rango nuevo se acota y se dice", () => {
  const minClasico = medidasEditables({ oficial: "arco", tamanos: "clasica" }).anchoM![0];
  const minOrganico = medidasEditables({ oficial: "arco", tamanos: "organica_gruesa" }).anchoM![0];
  assert.ok(minClasico < minOrganico, "el arco clásico admite una medida que el orgánico no");
  const chico = { ...BASE, piezas: BASE.piezas.map((p) => (p.id === ARCO ? { ...p, medidas: { ...p.medidas, anchoM: minClasico } } : p)) };
  const r = ok(chico, { op: "tamano_globos", pieza: ARCO, direccion: 1 });
  assert.ok(Math.abs(pieza(r.espec, ARCO).medidas.anchoM! - minOrganico) < 1e-9, "la tarjeta y el armado llevan el ancho del rango nuevo");
  assert.ok(r.avisos.some((a) => /^El ancho del arco quedó en \d/.test(a)), "el cliente lo sabe");
  assert.deepEqual(armarDesdeEspec(r.espec).noRepresentable, []);
});

test("quitar_pieza: la quita; la última no", () => {
  const r = ok(BASE, { op: "quitar_pieza", pieza: DER });
  assert.deepEqual(r.espec.piezas.map((p) => p.id), [ARCO, IZQ]);
  assert.match(r.descripcion, /quité la columna derecha/);
  restoIgual(BASE, r.espec, [DER]);
  noPudo(espec([{ estructura: "arco", cantidad: 1 }]), { op: "quitar_pieza", pieza: ARCO }, /al menos una pieza/);
  noPudo(BASE, { op: "quitar_pieza", pieza: "EST_08_ARCO" }, /no encontré esa pieza/);
});

test("agregar_pieza: suma UNA pieza oficial con id nuevo, lugar libre, colores del plan o los que se piden", () => {
  const r = ok(BASE, { op: "agregar_pieza", oficial: "guirnalda" });
  assert.equal(r.espec.piezas.length, 4);
  const nueva = r.espec.piezas.at(-1)!;
  assert.deepEqual({ id: nueva.id, oficial: nueva.oficial, nombre: nueva.nombre, lugar: nueva.lugar }, { id: "EST_04_GUIRNALDA", oficial: "guirnalda", nombre: "Guirnalda", lugar: "fondo" });
  assert.deepEqual(nombres(nueva), ["azul", "dorado"], "los colores del plan");
  assert.deepEqual(nueva.medidas, { largoM: 2.4 }, "la medida estándar de una guirnalda");
  assert.deepEqual(r.tocadas, [nueva.id]);
  restoIgual(BASE, r.espec, []);
  // Con colores, lugar y medida dichos; una medida fuera de rango se acota.
  const pedida = ok(BASE, { op: "agregar_pieza", oficial: "columna", lugar: "centro", colores: ["rojo", "blanco"], medidas: { altoM: 99 } });
  const columna = pedida.espec.piezas.at(-1)!;
  assert.deepEqual({ lugar: columna.lugar, colores: nombres(columna), alto: columna.medidas.altoM, nombre: columna.nombre }, { lugar: "centro", colores: ["rojo", "blanco"], alto: 5, nombre: "Columna" });
  assert.ok(pedida.avisos.some((a) => /queda fuera de lo que se arma/.test(a)));
  // Sin lugar, una columna toma el lado libre y un nombre que no se repite.
  const sinDerecha = ok(ok(BASE, { op: "quitar_pieza", pieza: DER }).espec, { op: "agregar_pieza", oficial: "columna" });
  assert.deepEqual([sinDerecha.espec.piezas.at(-1)!.lugar, sinDerecha.espec.piezas.at(-1)!.nombre], ["derecha", "Columna derecha"]);
  // Una palabra de color que no se reconoce se dice y se omite; si ninguna se reconoce, no se suma.
  const parcial = ok(BASE, { op: "agregar_pieza", oficial: "arco", colores: ["rojo", "zzz"] });
  assert.deepEqual(nombres(parcial.espec.piezas.at(-1)!), ["rojo"]);
  assert.ok(parcial.avisos.some((a) => /No reconocí el color «zzz»/.test(a)));
  noPudo(BASE, { op: "agregar_pieza", oficial: "arco", colores: ["zzz"] }, /no reconozco ninguno/);
});

test("agregar_pieza: el máximo de piezas y lo que el motor no arma se dicen y no se suman", () => {
  const ocho = espec([{ estructura: "columna", cantidad: 4 }, { estructura: "arco", cantidad: 1 }, { estructura: "guirnalda", cantidad: 1 }, { estructura: "semiarco", cantidad: 2 }]);
  assert.equal(ocho.piezas.length, MAX_PIEZAS_PLAN);
  noPudo(ocho, { op: "agregar_pieza", oficial: "arco" }, new RegExp(`máximo de ${MAX_PIEZAS_PLAN} piezas`));
  noPudo(BASE, { op: "agregar_pieza", oficial: "centro_mesa" }, /todavía no la puedo armar en 3D/);
  noPudo(BASE, { op: "agregar_pieza", oficial: "figura" }, /todavía no la puedo armar en 3D/);
  // Los ids nuevos no chocan aunque se hayan quitado piezas.
  const sinMedio = ok(BASE, { op: "quitar_pieza", pieza: IZQ }).espec;
  assert.equal(ok(sinMedio, { op: "agregar_pieza", oficial: "arco" }).espec.piezas.at(-1)!.id, "EST_04_ARCO");
});

test("agregar_idea: suma las piezas de la idea con ids libres y respeta el tope", () => {
  const ideaId = "deco-real-07-eb12910e210c94b6184d025127acce95";
  const guardado = planGuardadoDeIdea(ideaId);
  assert.ok(guardado, "hay una idea guardada para probar");
  const idea = especDesdeIdeaGuardada(guardado.plan, ideaId).espec;
  const r = aplicarEdicion(BASE, { op: "agregar_idea", ideaId }, { idea: (id) => (id === ideaId ? idea : null) });
  assert.equal(r.noAplicado, undefined);
  assert.equal(r.espec.piezas.length, BASE.piezas.length + idea.piezas.length);
  assert.deepEqual(r.espec.origen.ideaIds, [ideaId]);
  assert.deepEqual(r.espec.piezas.slice(0, BASE.piezas.length), BASE.piezas, "las del plan quedan intactas");
  assert.ok(r.tocadas.every((id) => !BASE.piezas.some((p) => p.id === id)), "las nuevas toman ids libres");
  const lleno = espec([{ estructura: "columna", cantidad: 4 }, { estructura: "arco", cantidad: 1 }, { estructura: "guirnalda", cantidad: 1 }, { estructura: "semiarco", cantidad: 2 }]);
  const tope = aplicarEdicion(lleno, { op: "agregar_idea", ideaId }, { idea: () => idea });
  assert.match(tope.noAplicado!, /máximo de 8 piezas/);
  assert.deepEqual(tope.espec, lleno);
  noPudo(BASE, { op: "agregar_idea", ideaId: "no-existe" }, /no encontré esa idea/);
});

test("flores: las pone, las cambia, las quita; dice cuando no hay nada que hacer", () => {
  const flores = { cantidad: 3, petalos: 3, codigo: "970", centro: "005" };
  const r = ok(BASE, { op: "flores", pieza: ARCO, flores });
  assert.deepEqual(pieza(r.espec, ARCO).flores, flores);
  assert.match(r.descripcion, /puse 3 flores de globo .* con centro/);
  restoIgual(BASE, r.espec, [ARCO]);
  noPudo(r.espec, { op: "flores", pieza: ARCO, flores }, /ya lleva esas flores/);
  const cambia = ok(r.espec, { op: "flores", pieza: ARCO, flores: { ...flores, cantidad: 5 } });
  assert.equal(pieza(cambia.espec, ARCO).flores?.cantidad, 5);
  const quita = ok(r.espec, { op: "flores", pieza: ARCO, flores: null });
  assert.equal(pieza(quita.espec, ARCO).flores, undefined);
  noPudo(BASE, { op: "flores", pieza: ARCO, flores: null }, /no lleva flores de globo/);
  noPudo(BASE, { op: "flores", pieza: "EST_08_ARCO", flores }, /no encontré esa pieza/);
  // Se cuentan en la lista de materiales aunque la pieza no tenga dónde colgarlas.
  const antes = armarDesdeEspec(BASE).bom.total.reduce((s, l) => s + l.cantidad, 0);
  const despues = armarDesdeEspec(r.espec).bom.total.reduce((s, l) => s + l.cantidad, 0);
  assert.equal(despues - antes, 3 * 3 + 3, "3 flores de 3 pétalos y 3 centros");
});

test("lado: pasa la pieza a la izquierda o a la derecha y cambia el lado de su nombre; techo y mesa no", () => {
  const sinDer = ok(BASE, { op: "quitar_pieza", pieza: DER }).espec;
  const r = ok(sinDer, { op: "lado", pieza: IZQ, lado: "derecha" });
  assert.deepEqual([pieza(r.espec, IZQ).lugar, pieza(r.espec, IZQ).nombre], ["derecha", "Columna derecha"]);
  assert.match(r.descripcion, /pasé la columna izquierda a la derecha/);
  restoIgual(sinDer, r.espec, [IZQ]);
  noPudo(BASE, { op: "lado", pieza: IZQ, lado: "izquierda" }, /ya está a la izquierda/);
  const conflicto = ok(BASE, { op: "lado", pieza: IZQ, lado: "derecha" });
  assert.ok(conflicto.avisos.length > 0, "si ya había una pieza igual de ese lado, lo dice");
  const techo = espec([{ estructura: "techo_globos", cantidad: 1 }, { estructura: "arco", cantidad: 1 }]);
  noPudo(techo, { op: "lado", pieza: "EST_01_TECHO_GLOBOS", lado: "derecha" }, /va en el techo/);
  // Un semiarco que pasa a la derecha se arma en espejo (el motor lo lee del lugar).
  const semi = espec([{ estructura: "semiarco", cantidad: 1 }]);
  const derecho = ok(semi, { op: "lado", pieza: "EST_01_SEMIARCO", lado: "derecha" });
  const centroX = (e: EspecClienteV1) => { const caja = armarDesdeEspec(e).armada.piezas[0]!.caja; return (caja[0] + caja[3]) / 2; };
  assert.ok(centroX(derecho.espec) > centroX(semi), "el semiarco que pasa a la derecha se dibuja a la derecha");
  assert.deepEqual(armarDesdeEspec(derecho.espec).noRepresentable, []);
});

test("una tanda es honesta aunque sea parcial: dice lo que hizo y lo que no, y no se detiene en lo que no se puede", () => {
  const r = aplicarEdiciones(BASE, [
    { op: "reemplazar_color", de: "azul", a: "rojo" },
    { op: "quitar_color", color: "verde" },
    { op: "quitar_pieza", pieza: DER },
    { op: "quitar_pieza", pieza: DER },
  ]);
  assert.equal(r.aplicadas, 2);
  assert.equal(r.hechas.length, 2);
  assert.equal(r.noAplicadas.length, 2);
  assert.ok(r.noAplicadas.every((m) => m.startsWith(PREFIJO_NO_PUDE)));
  assert.deepEqual(r.espec.piezas.map((p) => p.id), [ARCO, IZQ]);
  assert.deepEqual(nombres(pieza(r.espec, ARCO)), ["rojo", "dorado"]);
  const nada = aplicarEdiciones(BASE, [{ op: "quitar_color", color: "verde" }]);
  assert.equal(nada.aplicadas, 0);
  assert.deepEqual(nada.espec, BASE);
});

test("una edición con forma inventada no se ejecuta: «No pude: …» y la espec queda igual", () => {
  for (const mala of [{ op: "arrastrar", pieza: ARCO, x: 3 }, { op: "crear_geometria", globos: 400 }, { op: "quitar_pieza", pieza: "arco" }, { op: "tamano_pieza", pieza: ARCO }, { op: "reemplazar_color", de: "azul" }]) {
    const r = aplicarEdicion(BASE, mala as unknown as EdicionEspecV1);
    assert.match(r.noAplicado ?? "", /^No pude: /, JSON.stringify(mala));
    assert.deepEqual(r.espec, BASE);
  }
});

// ── «Sin arrastrar ni crear» ─────────────────────────────────────────────────────────────────────────────────────

test("ninguna operación mueve, arrastra ni crea: la lista de operaciones y lo que cada una puede añadir está cerrada", () => {
  assert.deepEqual([...OPERACIONES_EDICION].sort(), [
    "agregar_color", "agregar_idea", "agregar_pieza", "flores", "lado", "mas_menos_color", "proporcion_color", "quitar_color", "quitar_pieza", "reemplazar_color", "tamano_globos", "tamano_pieza",
  ].sort());
  // Ninguna operación acepta posiciones: ni coordenadas, ni rotaciones, ni geometría suelta, ni globos sueltos.
  const aceptados = (EdicionEspecV1Schema.options as ReadonlyArray<{ shape: Record<string, unknown> }>).flatMap((o) => Object.keys(o.shape));
  for (const prohibido of ["x", "y", "z", "posicion", "posiciones", "coordenadas", "rotacion", "giro", "globos", "geometria", "nodo", "tubos", "arrastrar", "mover"]) assert.ok(!aceptados.includes(prohibido), `una operación acepta «${prohibido}»`);
  // El único campo de lugar es `lado` (izquierda o derecha) y `lugar` al sumar una pieza oficial.
  assert.deepEqual(aceptados.filter((c) => /lug|lad|pos/.test(c)).sort(), ["lado", "lugar"]);
  assert.equal(EdicionEspecV1Schema.safeParse({ op: "lado", pieza: ARCO, lado: "arriba" }).success, false);
  assert.equal(EdicionEspecV1Schema.safeParse({ op: "agregar_pieza", oficial: "estatua_de_globos" }).success, false);
  assert.equal(EdicionEspecV1Schema.safeParse({ op: "agregar_pieza", oficial: "guirnalda", x: 1 }).success, false, "sin campos de más");
});

test("sobre las 28 ideas y las 18 oficiales, toda operación deja una espec válida, que se vuelve a armar, con las piezas no nombradas intactas y sin piezas nuevas que no sean oficiales", () => {
  const casos = todosLosCasos();
  assert.ok(casos.length >= 46);
  let operaciones = 0;
  for (const caso of casos) {
    const base = caso.espec;
    const primera = base.piezas[0]!;
    const ultima = base.piezas.at(-1)!;
    const baterias: EdicionEspecV1[] = [
      { op: "reemplazar_color", de: primera.colores[0]!.codigo, a: "rojo", piezas: [primera.id] },
      { op: "agregar_color", color: "rosado", piezas: [primera.id] },
      { op: "mas_menos_color", color: primera.colores[0]!.codigo, direccion: 1, piezas: [primera.id] },
      { op: "tamano_pieza", pieza: ultima.id, direccion: 1 },
      { op: "tamano_pieza", pieza: ultima.id, direccion: -1 },
      { op: "tamano_globos", pieza: primera.id, direccion: 1 },
      { op: "flores", pieza: primera.id, flores: { cantidad: 2, petalos: 3, codigo: "970" } },
      { op: "lado", pieza: primera.id, lado: "derecha" },
      { op: "agregar_pieza", oficial: "arco" },
      ...(base.piezas.length > 1 ? [{ op: "quitar_pieza", pieza: ultima.id } as const] : []),
    ];
    for (const edicion of baterias) {
      const r = aplicarEdicion(base, edicion);
      operaciones += 1;
      assert.ok(EspecClienteV1Schema.safeParse(r.espec).success, `${caso.id} ${edicion.op}: la espec sigue cumpliendo su contrato`);
      assert.ok(r.espec.piezas.length <= MAX_PIEZAS_PLAN);
      for (const p of r.espec.piezas) assert.ok((ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(p.oficial), `${caso.id}: ${p.oficial} es oficial`);
      const nuevas = r.espec.piezas.filter((p) => !base.piezas.some((q) => q.id === p.id));
      if (edicion.op === "agregar_pieza" && !r.noAplicado) assert.equal(nuevas.length, 1, "una sola pieza nueva");
      else assert.deepEqual(nuevas, [], `${caso.id} ${edicion.op}: solo agregar_pieza y agregar_idea crean piezas`);
      // Lo que no se nombra queda idéntico.
      const tocadas = new Set(r.tocadas);
      for (const q of base.piezas) if (!tocadas.has(q.id) && r.espec.piezas.some((p) => p.id === q.id)) assert.deepEqual(r.espec.piezas.find((p) => p.id === q.id), q, `${caso.id} ${edicion.op}: ${q.id} no se debía tocar`);
      if (r.noAplicado) assert.deepEqual(r.espec, base);
    }
  }
  assert.ok(operaciones >= 400, `operaciones probadas: ${operaciones}`);
});

test("lo editado se vuelve a armar: la lista de materiales cuenta lo nuevo y el total del plan cambia en el sentido pedido", () => {
  const antes = armarDesdeEspec(BASE);
  const total = (r: ReturnType<typeof armarDesdeEspec>) => r.bom.total.reduce((s, l) => s + l.cantidad, 0);
  const mayor = armarDesdeEspec(ok(BASE, { op: "tamano_pieza", pieza: ARCO, direccion: 1 }).espec);
  assert.ok(total(mayor) > total(antes), "un arco un 10 % más grande lleva más globos");
  const sinColumna = armarDesdeEspec(ok(BASE, { op: "quitar_pieza", pieza: DER }).espec);
  assert.ok(total(sinColumna) < total(antes));
  assert.equal(sinColumna.bom.porPieza[DER], undefined);
  const nuevoColor = armarDesdeEspec(ok(BASE, { op: "reemplazar_color", de: "azul", a: "rojo" }).espec);
  assert.ok(nuevoColor.bom.total.some((l) => l.codigo === "015") && !nuevoColor.bom.total.some((l) => l.codigo === "040"));
  assert.notEqual(nuevoColor.especHash, antes.especHash, "otra espec, otro hash: la vista 3D pide su armada nueva");
});

test("la caché de piezas: una edición rearma solo la pieza que cambió y los materiales salen iguales que sin caché", () => {
  const cache = crearCachePiezas(32);
  armarDesdeEspec(BASE, { cachePiezas: cache });
  assert.deepEqual({ ...cache.estadisticas() }, { aciertos: 0, fallos: 3, guardadas: 3 }, "la primera vez se arma todo: el arco y cada columna (cada lado es otra pieza)");
  const editada = ok(BASE, { op: "reemplazar_color", de: "azul", a: "rojo", piezas: [ARCO] }).espec;
  const antes = cache.estadisticas();
  const conCache = armarDesdeEspec(editada, { cachePiezas: cache });
  const despues = cache.estadisticas();
  assert.equal(despues.fallos - antes.fallos, 1, "solo el arco se rearmó");
  assert.equal(despues.aciertos - antes.aciertos, 2, "las dos columnas salieron de la caché");
  const sinCache = armarDesdeEspec(editada);
  assert.deepEqual(conCache.bom, sinCache.bom, "los mismos materiales");
  assert.deepEqual(conCache.armada, sinCache.armada, "la misma armada");
  assert.equal(conCache.especHash, sinCache.especHash);
});
