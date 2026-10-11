import assert from "node:assert/strict";
import test from "node:test";
import { armarEscena, SALA_INICIAL, type Escena, type EscenaArmada, type NodoEscena } from "./escena";
import { columnaClasica } from "./escenas-presets";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "./biblioteca";
import { gruposDeHelio, resumenHelio } from "./helio-cinta";
import { hojaDeEscena, paginasDeHoja, type HojaArmado } from "./hoja-armado";
import { marcasDe } from "./hoja-armado-comun";
import { crearEstructura } from "./herramientas-escena-estructuras";
import { textoParteDeTanque } from "./hoja-armado-helio";
import { dondeVaNodo } from "./hoja-armado-lugar";
import { textoUbicacion } from "./hoja-armado-impresos";
import type { Pieza } from "./piezas";
import { textoGlobos } from "./texto-cantidad";

/**
 * Lo que la hoja de armado tiene que traer para armar sin volver a la lista de compra: el helio y la cinta por pieza y en total
 * (las mismas cuentas de la lista), dónde va cada impreso, los metalizados con su compra, el «cómo armar» de lo orgánico y de las
 * formas rellenas, y el singular de «1 globo».
 */

function idea(id: string): { escena: Escena; hoja: HojaArmado } {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === id);
  assert.ok(item, `no está ${id}`);
  const escena = escenaDeItem(item);
  return { escena, hoja: hojaDeEscena(item.nombre ?? id, escena, armarEscena(escena)) };
}

let biblioteca: Array<{ id: string; escena: Escena; armada: EscenaArmada; hoja: HojaArmado }> | undefined;

/** Las hojas de las escenas de la biblioteca, armadas una sola vez para todas las pruebas de este archivo. */
function hojasDeLaBiblioteca(): NonNullable<typeof biblioteca> {
  biblioteca ??= BIBLIOTECA_FABRICA.filter((i) => i.contenido.tipo === "escena" || i.contenido.tipo === "conjunto").map((item) => {
    const escena = escenaDeItem(item);
    const armada = armarEscena(escena);
    return { id: item.id, escena, armada, hoja: hojaDeEscena(item.nombre ?? item.id, escena, armada) };
  });
  return biblioteca;
}

const columna = columnaClasica(120);

function escenaCon(...piezas: ReadonlyArray<readonly [string, Pieza]>): Escena {
  return { sala: SALA_INICIAL, nodos: piezas.map(([nombre, pieza], k) => ({ id: `p${k}`, nombre, pieza, colocacion: { en: "piso", xCm: k * 120, zCm: 0, giroGrados: 0 } })) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Helio y cinta
// ---------------------------------------------------------------------------------------------------------------------

test("el helio de la hoja es el de la lista de compra, cuenta por cuenta, en todas las escenas de la biblioteca", () => {
  let conHelio = 0;
  for (const { id, escena, armada, hoja } of hojasDeLaBiblioteca()) {
    const lista = resumenHelio(gruposDeHelio(escena.nodos, armada.porNodo)) ?? undefined;
    assert.deepEqual(hoja.helio, lista, id);
    if (!lista) continue;
    conHelio += 1;
    const enEstructuras = hoja.estructuras.reduce((suma, e) => suma + (e.helio?.globos ?? 0), 0);
    assert.ok(enEstructuras <= lista.globos, `${id}: las estructuras no pueden llevar más helio que la escena`);
  }
  assert.ok(conHelio > 50, `${conHelio} escenas con helio`);
});

test("una estructura con globos de helio dice sus litros, su cinta y la parte de un tanque; las demás no llevan bloque", () => {
  const { escena, hoja } = idea("idea:graduacion");
  const conHelio = hoja.estructuras.filter((e) => e.helio);
  assert.ok(conHelio.length > 0, "la graduación tiene estructuras de helio");
  const armada = armarEscena(escena);
  for (const e of conHelio) {
    const nodo = armada.porNodo.find((n) => n.id === e.id)!;
    const esperado = resumenHelio(gruposDeHelio([{ id: e.id, pieza: escena.nodos.find((n) => n.id === e.id)!.pieza }], [nodo]));
    assert.equal(e.helio!.litros, esperado!.litros, e.nombre);
    assert.equal(e.helio!.metrosCinta, esperado!.metrosCinta, e.nombre);
  }
  assert.ok(hoja.estructuras.some((e) => !e.helio), "las estructuras sin helio no llevan bloque");
});

test("el total de helio es lo último de la hoja, después de la lista, y solo si la escena lleva helio", () => {
  const conHelio = idea("idea:columna-feliz-cumpleanos-organico").hoja;
  const trozos = paginasDeHoja(conHelio).flatMap((p) => p.trozos);
  assert.deepEqual(trozos.slice(-2).map((t) => t.tipo), ["lista", "helio"]);
  const sinHelio = idea("idea:columna-organica").hoja;
  assert.equal(sinHelio.helio, undefined);
  assert.ok(!paginasDeHoja(sinHelio).flatMap((p) => p.trozos).some((t) => t.tipo === "helio"));
});

test("la parte de un tanque se escribe sin redondear a tanques enteros", () => {
  assert.equal(textoParteDeTanque(73.8), "0,7 % de un tanque de 10.000 L");
  assert.equal(textoParteDeTanque(2), "menos de 0,1 % de un tanque de 10.000 L");
  assert.equal(textoParteDeTanque(13000), "1,3 tanques de 10.000 L");
});

// ---------------------------------------------------------------------------------------------------------------------
// Dónde va cada impreso
// ---------------------------------------------------------------------------------------------------------------------

const impreso = { clave: "x", texto: "impreso «X»" };
const globoCon = (conImpreso: boolean) => ({ helio: false, confeti: false, ...(conImpreso ? { impreso } : {}) });

test("un impreso dice en qué globo de la capa o del cuarteto va; si el motor no lo fija, dice «cualquier posición»", () => {
  const anillo = [globoCon(false), globoCon(true), globoCon(false), globoCon(true)];
  assert.deepEqual(marcasDe(anillo, { tipo: "posicion", de: "de la capa" }), ["2 con impreso «X» (globos 2 y 4 de la capa)"]);
  assert.deepEqual(marcasDe(anillo.slice(0, 2), { tipo: "posicion", de: "de cada cuarteto" }), ["1 con impreso «X» (globo 2 de cada cuarteto)"]);
  assert.deepEqual(marcasDe(anillo, { tipo: "libre", de: "del tramo" }), ["2 con impreso «X» (cualquier posición del tramo)"]);
  assert.deepEqual(marcasDe([globoCon(true), globoCon(true)], { tipo: "posicion", de: "de la capa" }), ["2 con impreso «X» (todos los globos de la capa)"]);
  const pared = [{ ...globoCon(true), numero: 12 }, { ...globoCon(false), numero: 13 }, { ...globoCon(true), numero: 15 }];
  assert.deepEqual(marcasDe(pared, { tipo: "numerados", de: "de la pared" }), ["2 con impreso «X» (globos 12 y 15 de la pared)"]);
});

test("si la parte de la pieza distingue al impreso (los ojos de una figura), la hoja dice la parte, no «cualquier posición»", () => {
  const con = (parte: string, conImpreso: boolean) => ({ ...globoCon(conImpreso), parte });
  const figura = [con("copa", false), con("copa/ojos", true), con("copa/ojos", true), con("copa", false)];
  assert.deepEqual(marcasDe(figura, { tipo: "libre", de: "del tramo" }), ["2 con impreso «X» (la parte «copa/ojos»)"]);
  // Una columna orgánica: el impreso cae en una parte que también tienen globos sin él, así que la parte no dice dónde.
  const columna = [con("columna", false), con("columna", true), con("columna", false)];
  assert.deepEqual(marcasDe(columna, { tipo: "libre", de: "del tramo" }), ["1 con impreso «X» (cualquier posición del tramo)"]);
});

test("una lista larga de posiciones se corta: «1, 2, 3, 4, 5, 6 y 4 más»", () => {
  assert.equal(textoUbicacion({ tipo: "posicion", de: "de la capa" }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 24), "globos 1, 2, 3, 4, 5, 6 y 4 más de la capa");
});

test("en la biblioteca, los impresos de las capas, los cuartetos y los tramos dicen dónde van", () => {
  const textos = { capa: new Set<string>(), cuarteto: new Set<string>(), tramo: new Set<string>() };
  for (const { hoja: { estructuras } } of hojasDeLaBiblioteca()) {
    for (const e of estructuras) {
      for (const m of e.capas.flatMap((c) => c.marcas)) if (m.includes("con impreso")) textos.capa.add(m);
      for (const m of e.cuartetos.flatMap((c) => c.marcas)) if (m.includes("con impreso")) textos.cuarteto.add(m);
      for (const m of e.tramos.flatMap((t) => t.marcas)) if (m.includes("con impreso")) textos.tramo.add(m);
    }
  }
  const sinLugar = (m: string) => !/\((?:globos? [\d, y]+(?: y \d+ más)? de(?:l| la| cada) |todos los globos de(?:l| la| cada) |cualquier posición de(?:l| la) |la parte «|las partes «)/.test(m);
  for (const [donde, marcas] of Object.entries(textos)) {
    assert.ok(marcas.size > 0, `hay impresos en ${donde}`);
    assert.deepEqual([...marcas].filter(sinLugar), [], `impresos sin lugar en ${donde}`);
  }
  assert.ok([...textos.capa].some((m) => /\(globos? \d/.test(m)), "una capa con unos globos impresos y otros no dice cuáles");
  assert.ok([...textos.cuarteto].every((m) => /de(?:l| cada) cuarteto\)$/.test(m)));
});

test("las piezas pequeñas con globos impresos dicen dónde van; las demás filas no", () => {
  const { hoja } = idea("idea:columna-feliz-cumpleanos-organico");
  const conImpreso = hoja.compactas.filter((f) => f.contenido.some((l) => l.impreso));
  assert.ok(conImpreso.length >= 3, `${conImpreso.length} filas con impresos`);
  for (const f of conImpreso) {
    assert.ok(f.lugares.length > 0, f.nombres.join("; "));
    assert.ok(f.lugares.every((l) => !/Amarre/i.test(l)), "un amarre escondido no es un sitio");
  }
  assert.ok(hoja.compactas.filter((f) => !f.contenido.some((l) => l.impreso)).every((f) => f.lugares.length === 0));
});

test("dónde va una pieza: sobre cuál, en el piso o la pared, y el sitio que le puso su autor entre paréntesis", () => {
  const nodos = new Map([
    ["col", { id: "col", nombre: "Columna", pieza: columna, colocacion: { en: "piso" as const, xCm: 0, zCm: 0, giroGrados: 0 } }],
    ["amarre", { id: "amarre", nombre: "Amarre del ramo (no se ve)", pieza: columna, colocacion: { en: "piso" as const, xCm: 0, zCm: 0, giroGrados: 0 } }],
  ]);
  const hijo = (nombre: string, colocacion: NodoEscena["colocacion"]): NodoEscena => ({ id: "h", nombre, pieza: columna, colocacion });
  const punto = { x: 0, y: 50, z: 0 };
  assert.equal(dondeVaNodo(hijo("R-12 grande (arriba a la izquierda)", { en: "sobre", padreId: "col", puntoCm: punto, normal: punto, giroGrados: 0 }), nodos), "sobre «Columna» (arriba a la izquierda)");
  assert.equal(dondeVaNodo(hijo("R-12 grande (abajo)", { en: "sobre", padreId: "amarre", puntoCm: punto, normal: punto, giroGrados: 0 }), nodos), "abajo");
  assert.equal(dondeVaNodo(hijo("Globo", { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 }), nodos), "en el piso");
  assert.equal(dondeVaNodo(hijo("Abeja (insecto)", { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 }), nodos), "en el piso", "un paréntesis que no es un sitio no se copia");
  assert.equal(dondeVaNodo(hijo("Globo", { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 }), nodos), undefined);
});

// ---------------------------------------------------------------------------------------------------------------------
// Metalizados y formas rellenas
// ---------------------------------------------------------------------------------------------------------------------

test("los metalizados de la columna de cumpleaños salen con su compra y no como «otras piezas»", () => {
  const { hoja } = idea("idea:columna-feliz-cumpleanos-organico");
  assert.deepEqual(hoja.metalizados.map((l) => [l.cantidad, l.nombre]), [[1, "Número 4 plata 26\""], [1, "Número 0 plata 26\""]]);
  assert.equal(hoja.metalizados[0]!.producto, "GLOBO METALIZADO NUMERO 4 PLATA");
  assert.equal(hoja.metalizados[0]!.tallas, "la escena lo pide de 26\", pero la tienda lo vende en 16\" y 32\"", "el producto existe, pero no en la talla del pedido: se dice");
  assert.equal(hoja.metalizados[1]!.producto, null, "el 0 no tiene producto igual en la tienda: se dice");
  assert.equal(hoja.metalizados[1]!.tallas, null);
  assert.ok(hoja.metalizados.every((l) => l.comoArmar.some((paso) => /^Mide unos \d+ cm de alto/.test(paso))));
  assert.ok(!hoja.otrasPiezas.some((n) => /metaliz/i.test(n)));
  const trozos = paginasDeHoja(hoja).flatMap((p) => p.trozos).map((t) => t.tipo);
  assert.ok(trozos.indexOf("metalizados") >= 0 && trozos.indexOf("metalizados") < trozos.indexOf("lista"));
});

test("unas letras de foil con cinta dicen una letra por globo y cuánto mide la cinta", () => {
  const letras = crearEstructura("metalizado", { texto: "HBD" }, []);
  const pieza: Pieza = letras.pieza.tipo === "metalizado" ? { ...letras.pieza, metalizado: { ...letras.pieza.metalizado, cinta: { largoCm: 120, hex: "#ffffff" } } } : letras.pieza;
  const escena = escenaCon(["Letras", pieza]);
  const { metalizados } = hojaDeEscena("hbd", escena, armarEscena(escena));
  assert.equal(metalizados.length, 1);
  assert.equal(metalizados[0]!.cantidad, 3, "tres letras, tres globos");
  assert.ok(metalizados[0]!.comoArmar.includes("Una letra por globo, en fila y en orden: «HBD»."));
  assert.ok(metalizados[0]!.comoArmar.includes("Flota con helio: la cinta mide 120 cm y baja hasta el peso."));
});

test("un número relleno de globos dice su contorno y su técnica, y no se da por capas", () => {
  const numero = crearEstructura("forma", { texto: "40", alto_cm: 160, tecnica: "organico", colores: ["blanco"] }, []);
  const escena = escenaCon(["Número 40", numero.pieza]);
  const [e] = hojaDeEscena("40", escena, armarEscena(escena)).estructuras;
  assert.equal(e!.modo, "alturas");
  assert.match(e!.comoArmar?.[0] ?? "", /^Forma rellena de globos: «40» de unos \d+ cm de alto/);
  assert.match(e!.comoArmar?.[1] ?? "", /^Capa orgánica de unos \d+ cm de grueso, sobre el esqueleto de la forma: globos de tamaños mezclados \(R-12 33 %, R-5 67 %\)/);
  assert.match(e!.nota ?? "", /No sirve para armar por capas/);
});

// ---------------------------------------------------------------------------------------------------------------------
// «Cómo armar» de lo orgánico
// ---------------------------------------------------------------------------------------------------------------------

test("cada franja de un arco o una columna orgánicos dice el orden: anclas, estructura y relleno, con sus tamaños", () => {
  const { hoja } = idea("idea:graduacion");
  const torre = hoja.estructuras.find((e) => e.nombre.startsWith("Torre orgánica"))!;
  assert.match(torre.nota ?? "", /No sirve para armar por capas/);
  const conOrden = torre.tramos.filter((t) => t.comoArmar);
  assert.ok(conOrden.length >= torre.tramos.length - 2, `${conOrden.length} de ${torre.tramos.length} franjas`);
  for (const t of conOrden) {
    assert.match(t.comoArmar!, /^Orden: 1\.º (?:anclas|estructura): \d+ × R-\d+ .*· \d\.º (?:estructura|relleno): /, t.etiqueta);
    assert.ok(!/estructura: [^·]*racimitos/.test(t.comoArmar!), "los racimitos son del relleno, no de la estructura");
  }
});

test("un formato es ancla o es estructura en toda la pieza (por su inflado nominal), no según lo que mide cada globo con su variación", () => {
  const { hoja } = idea("idea:graduacion");
  const torre = hoja.estructuras.find((e) => e.nombre.startsWith("Torre orgánica"))!;
  const formatos = (linea: string, paso: string) => new Set([...(new RegExp(`${paso}: ([^·]*)`).exec(linea)?.[1] ?? "").matchAll(/× (R-\d+)/g)].map((m) => m[1]));
  const anclas = new Set<string>(), estructura = new Set<string>();
  for (const t of torre.tramos) {
    for (const f of formatos(t.comoArmar ?? "", "anclas")) anclas.add(f);
    for (const f of formatos(t.comoArmar ?? "", "estructura")) estructura.add(f);
  }
  assert.deepEqual([...anclas].filter((f) => estructura.has(f)), [], "el mismo formato en los dos pasos");
});

test("el relleno de R-5 de una columna orgánica va en racimitos, y solo el relleno", () => {
  const { hoja } = idea("idea:columna-feliz-cumpleanos-organico");
  const columna = hoja.estructuras.find((e) => e.nombre.startsWith("Columna orgánica"))!;
  const lineas = columna.tramos.flatMap((t) => (t.comoArmar ? [t.comoArmar] : []));
  assert.ok(lineas.length > 0);
  assert.ok(lineas.some((l) => /relleno: [^·]*R-5 [^·]*\(en racimitos de hasta 3\)/.test(l)));
  assert.ok(lineas.every((l) => !/estructura: [^·]*racimitos/.test(l)), "los racimitos son del relleno, no de la estructura");
});

test("lo que no es orgánico ni forma rellena no inventa un «cómo armar»", () => {
  const { hoja } = idea("idea:mural-neon");
  for (const e of hoja.estructuras) {
    assert.equal(e.comoArmar, undefined, e.nombre);
    assert.ok(e.tramos.every((t) => t.comoArmar === undefined), e.nombre);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Singular
// ---------------------------------------------------------------------------------------------------------------------

test("«1 globo», no «1 globos»", () => {
  assert.equal(textoGlobos(0), "0 globos");
  assert.equal(textoGlobos(1), "1 globo");
  assert.equal(textoGlobos(2), "2 globos");
});
