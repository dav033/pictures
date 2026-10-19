import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { armarEscena, SALA_INICIAL, type Escena, type EscenaArmada, type NodoEscena } from "./escena";
import { arcoOrganico, columnaClasica } from "./escenas-presets";
import { filasBomba, inflablesDeEscena } from "./bomba-segundos";
import type { GloboDePieza, Pieza } from "./piezas";
import { ANCHO_TRAMO_PARED_CM, tramosDeGlobos, tramosPorCapa } from "./hoja-armado-tramos";
import { capasDeAnillos } from "./hoja-armado-capas";
import { agruparDesdePrimero, agruparPorNivel, aparteDe, colorear, secuenciaDeColor, sumaSinRedondear, tamanosDe, textoSobre } from "./hoja-armado-comun";
import { estructuraDeNodo } from "./hoja-armado-estructura";
import { centroDelGlobo, type CentroLocal } from "./hoja-armado-local";
import { textoGiro, textoRango, textoSecuencia, textoTamano } from "./hoja-armado-texto";
import { cuartetosDeNiveles } from "./hoja-armado-trenza";
import { hojaDeEscena, paginasDeHoja, type EstructuraHoja, type HojaArmado, type PaginaHoja } from "./hoja-armado";

// ---------------------------------------------------------------------------------------------------------------------
// Datos de mano: globos cuyo centro queda donde se pide, ya en el espacio de la pieza
// ---------------------------------------------------------------------------------------------------------------------

function globo(codigo: string, nivel?: number, infladoCm = 25, extra: Partial<GloboDePieza> = {}): GloboDePieza {
  return { formatoId: "R-12", infladoCm, codigo, nudo: { x: 0, y: 0, z: 0 }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0, ...(nivel === undefined ? {} : { nivel }), ...extra };
}

/** Un globo cuyo centro es (x, y, z). */
function centro(codigo: string, x: number, y: number, z: number, nivel?: number, infladoCm = 25, extra: Partial<GloboDePieza> = {}): CentroLocal {
  return { globo: globo(codigo, nivel, infladoCm, extra), x, y, z };
}

const aRad = (grados: number) => (grados * Math.PI) / 180;

/** Un cuarteto a `y`, con el globo 1 en el azimut `azimutGrados` (de x hacia z) y los demás de 90° en 90°. */
function cuarteto(nivel: number, y: number, azimutGrados: number, codigos: readonly string[]): CentroLocal[] {
  return codigos.map((codigo, k) => centro(codigo, 15 * Math.cos(aRad(azimutGrados + 90 * k)), y, 15 * Math.sin(aRad(azimutGrados + 90 * k)), nivel));
}

/** Los globos de `tramos` como centros en fila (para las tablas). */
const enFila = (codigos: readonly string[], paso = 17, y = 20): CentroLocal[] => codigos.map((c, i) => centro(c, i * paso, y, 0));

const gradosDe = (g: { x: number; y: number }) => (Math.atan2(g.y, g.x) * 180) / Math.PI;

// ---------------------------------------------------------------------------------------------------------------------
// Capas: por nivel, en el espacio de la pieza, giro y orden de color por capa
// ---------------------------------------------------------------------------------------------------------------------

test("las capas salen del nivel de cada globo, no de su altura", () => {
  // Dos cuartetos con el mismo nivel de globo cada uno: las capas son las del nivel, a cualquier altura.
  const niveles = [cuarteto(0, 0, 45, ["012", "012", "030", "030"]), cuarteto(1, 20, 0, ["012", "012", "030", "030"])];
  const capas = capasDeAnillos(niveles, 4);
  assert.ok(capas);
  // Las dos capas son iguales (el giro de −45° es el de la espiral): se dan juntas.
  assert.deepEqual(capas.map((c) => [c.numero, c.hasta, c.globos.length]), [[1, 2, 4]]);
});

test("una capa que no tiene el tamaño del módulo no se dibuja (se da la tabla)", () => {
  assert.equal(capasDeAnillos([cuarteto(0, 0, 0, ["012", "012", "012", "012"]), cuarteto(1, 20, 0, ["012", "012", "012"]).slice(0, 3)], 4), null);
  assert.equal(capasDeAnillos([], 4), null);
});

test("cada globo del anillo tiene un número único, todos tocan el círculo y el 1 de la primera capa queda arriba", () => {
  const capas = capasDeAnillos([cuarteto(0, 0, 45, ["012", "030", "012", "030"])], 4);
  assert.ok(capas);
  const [capa] = capas;
  assert.deepEqual(capa.globos.map((g) => g.numero), [1, 2, 3, 4]);
  for (const g of capa.globos) assert.ok(Math.abs(Math.hypot(g.x, g.y) - capa.radioAnilloCm) < 1e-9);
  assert.ok(Math.abs(gradosDe(capa.globos[0]!) + 90) < 1e-6, "el 1 está arriba");
  // Sentido horario visto desde arriba: en el dibujo (y hacia abajo) el ángulo crece de globo en globo.
  assert.ok(Math.abs(gradosDe(capa.globos[1]!) - 0) < 1e-6);
  assert.ok(capa.extensionCm > capa.radioAnilloCm + 25 / 2);
});

test("los vecinos de un anillo se tocan sin montarse, también con 3 y 6 globos", () => {
  for (const n of [3, 4, 5, 6]) {
    const grupo = Array.from({ length: n }, (_, k) => centro("012", 15 * Math.cos(aRad((360 * k) / n)), 0, 15 * Math.sin(aRad((360 * k) / n)), 0));
    const [capa] = capasDeAnillos([grupo], n)!;
    for (let k = 0; k < n; k++) {
      const a = capa!.globos[k]!, b = capa!.globos[(k + 1) % n]!;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 25 - 1e-6, `${n} globos: se montan`);
    }
  }
});

test("espiral: cada capa gira 45° a la izquierda y el 1 de la capa de arriba se dibuja en su azimut real", () => {
  // Salvavidas: dos capas rojas y dos blancas; cada una girada −45° respecto a la de abajo (antihorario visto desde arriba).
  const niveles = [0, 1, 2, 3].map((k) => cuarteto(k, 20 * k, 45 - 45 * k, k < 2 ? ["012", "012", "012", "012"] : ["030", "030", "030", "030"]));
  const capas = capasDeAnillos(niveles, 4)!;
  assert.deepEqual(capas.map((c) => [c.numero, c.hasta, c.giroGrados]), [[1, 2, -45], [3, 4, -45]]);
  // La primera capa tiene el 1 arriba (−90°); la tercera está girada −45° dos veces: −180°.
  assert.ok(Math.abs(gradosDe(capas[0]!.globos[0]!) + 90) < 1e-6);
  const tercera = gradosDe(capas[1]!.globos[0]!);
  assert.ok(Math.abs(Math.abs(tercera) - 180) < 1e-6, `la capa 3 tiene el 1 a ${tercera}°`);
  assert.match(textoGiro(-45), /45° a la izquierda \(sentido antihorario\)/);
  assert.match(textoGiro(45), /a la derecha \(sentido horario\)/);
});

test("las capas seguidas que son iguales se dan juntas; si el giro cambia, no", () => {
  const iguales = [0, 1, 2, 3, 4].map((k) => cuarteto(k, 20 * k, 45 - 45 * k, ["012", "030", "012", "030"]));
  const unBloque = capasDeAnillos(iguales, 4)!;
  assert.deepEqual(unBloque.map((c) => [c.numero, c.hasta, c.repeticiones, c.giroGrados]), [[1, 5, 5, -45]]);
  // Zig-zag: dos capas a la izquierda y dos a la derecha (el giro cambia de signo).
  const giros = [0, -45, -90, -45, 0];
  const zigzag = giros.map((g, k) => cuarteto(k, 20 * k, 45 + g, ["012", "030", "012", "030"]));
  const bloques = capasDeAnillos(zigzag, 4)!;
  assert.deepEqual(bloques.map((c) => [c.numero, c.hasta, c.giroGrados]), [[1, 3, -45], [4, 5, 45]]);
});

test("el orden de color es de cada capa: no se unen tramos de capas distintas", () => {
  const niveles = [cuarteto(0, 0, 0, ["012", "012", "012", "012"]), cuarteto(1, 20, 0, ["012", "012", "030", "030"])];
  const capas = capasDeAnillos(niveles, 4)!;
  assert.deepEqual(capas[0]!.secuencia.map((t) => [t.codigo, t.veces, t.desde]), [["012", 4, 1]]);
  assert.deepEqual(capas[1]!.secuencia.map((t) => [t.codigo, t.veces, t.desde]), [["012", 2, 1], ["030", 2, 3]]);
  assert.equal(textoSecuencia(capas[1]!.secuencia).split(" · ").length, 2);
  assert.equal(textoRango(3, 2), "3–4");
  assert.equal(textoRango(3, 1), "3");
});

test("el helio aparece en el dibujo pero no suma a la bomba", () => {
  const grupo = [centro("012", 15, 0, 0, 0), centro("012", 0, 0, 15, 0), centro("012", -15, 0, 0, 0, 25, { helio: true }), centro("012", 0, 0, -15, 0)];
  const [capa] = capasDeAnillos([grupo], 4)!;
  assert.equal(capa!.globos.filter((g) => g.helio).length, 1);
  assert.equal(capa!.filasBomba.reduce((s, f) => s + f.cantidad, 0), 3);
});

test("el remate de una columna y los globos sin capa van aparte", () => {
  const centros = [...cuarteto(0, 0, 0, ["012", "012", "012", "012"]), centro("030", 0, 40, 0, undefined, 42, { parte: "remate" })];
  const { niveles, aparte } = agruparPorNivel(centros);
  assert.deepEqual(niveles.map((n) => n.length), [4]);
  assert.equal(aparte.length, 1);
  assert.deepEqual(aparteDe(aparte).map((a) => [a.etiqueta, a.cantidad, a.infladoCm]), [["remate", 1, 42]]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Tablas: paredes, alturas y capas irregulares
// ---------------------------------------------------------------------------------------------------------------------

test("una pared se numera de un extremo al otro: el número sube con la posición", () => {
  const datos: CentroLocal[] = [];
  for (let i = 0; i < 30; i++) datos.push(centro("012", (i * 17) % 300, 20 + (i % 3) * 25, 0));
  const tramos = tramosDeGlobos(datos, "paredes");
  const enOrden = tramos.flatMap((t) => t.globos);
  assert.equal(enOrden.length, 30);
  assert.deepEqual(enOrden.map((g) => g.numero), Array.from({ length: 30 }, (_, i) => i + 1));
  for (let i = 1; i < enOrden.length; i++) assert.ok(enOrden[i]!.posicionCm >= enOrden[i - 1]!.posicionCm, `número ${i + 1} antes de su posición`);
  for (const t of tramos) assert.ok(t.hastaCm - t.desdeCm <= ANCHO_TRAMO_PARED_CM);
});

test("una pieza que no es anillo ni pared se da en franjas de altura sobre su punto más bajo", () => {
  const datos = [centro("012", 0, 20, 0), centro("030", 30, 22, 0), centro("012", 60, 80, 0), centro("012", 90, 83, 0)];
  const tramos = tramosDeGlobos(datos, "alturas");
  assert.equal(tramos.length, 2);
  assert.deepEqual(tramos.map((t) => t.globos.length), [2, 2]);
  assert.equal(tramos[0]!.etiqueta, "Tramo 1: de 0 a 2 cm de altura");
});

test("las capas irregulares (un cono) se dan como una tabla por capa, de la base a la punta", () => {
  const tabla = tramosPorCapa([enFila(["012", "012", "012", "012", "012"], 17, 12), enFila(["030", "030", "030"], 17, 30)]);
  assert.deepEqual(tabla.map((t) => t.globos.length), [5, 3]);
  assert.match(tabla[0]!.etiqueta, /^Capa 1: a \d+ cm de la base$/);
  assert.deepEqual(tabla.flatMap((t) => t.globos).map((g) => g.numero), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("los cuartetos de una trenza se dan en el orden del recorrido y los iguales seguidos se juntan", () => {
  const todos = [0, 1, 2, 3, 4, 5].map((k) => cuarteto(k, 20 * k, 0, k < 4 ? ["012", "012", "012", "012"] : ["030", "030", "030", "030"]));
  const bloques = cuartetosDeNiveles(todos);
  assert.deepEqual(bloques.map((b) => [b.desde, b.hasta, b.repeticiones]), [[1, 4, 4], [5, 6, 2]]);
});

test("los colores, los tamaños y la secuencia cuentan cada globo una vez", () => {
  const datos = [centro("012", 0, 20, 0), centro("030", 0, 20, 30), centro("030", 0, 20, 60), centro("030", 0, 20, 90, undefined, 12)];
  const globos = datos.map((c) => ({ formatoId: "R-12", codigo: c.globo.codigo, nombreColor: c.globo.codigo, hex: "#000000", infladoCm: c.globo.infladoCm }));
  assert.deepEqual(colorear(globos).map((c) => [c.codigo, c.cantidad]), [["030", 3], ["012", 1]]);
  assert.deepEqual(tamanosDe(globos).map((t) => [t.infladoCm, t.hastaCm, t.cantidad]), [[12, 12, 1], [25, 25, 3]]);
  // Un formato con muchos tamaños (un racimo orgánico) se da como un rango.
  const mezcla = [21, 22, 23, 24, 24, 29].map((cm) => ({ formatoId: "R-12", infladoCm: cm }));
  assert.deepEqual(tamanosDe(mezcla), [{ formatoId: "R-12", infladoCm: 21, hastaCm: 29, cantidad: 6 }]);
  assert.equal(textoTamano(tamanosDe(mezcla)[0]!), "6 × R-12 de 21 a 29 cm");
  assert.equal(textoTamano(tamanosDe(globos)[1]!), "3 × R-12 a 25 cm");
  assert.deepEqual(secuenciaDeColor(globos).map((t) => [t.codigo, t.veces, t.desde]), [["012", 1, 1], ["030", 3, 2]]);
});

test("el texto del número se lee sobre el globo", () => {
  assert.equal(textoSobre("#ffffff"), "#000000");
  assert.equal(textoSobre("#101010"), "#ffffff");
});

// ---------------------------------------------------------------------------------------------------------------------
// Escenas armadas a mano: copias y columnas acostadas
// ---------------------------------------------------------------------------------------------------------------------

/** Una columna parada y otra colgada de sus anclas: las copias de la segunda quedan acostadas (su eje es horizontal). */
function escenaConRamas(): { escena: Escena; armada: EscenaArmada } {
  const escena: Escena = {
    sala: SALA_INICIAL,
    nodos: [
      { id: "base", nombre: "Base", pieza: columnaClasica(180), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "rama", nombre: "Rama", pieza: columnaClasica(100, ["609", "005"]), colocacion: { en: "ancla", padreId: "base", ancla: 2, cada: 8, giroGrados: 0 } },
    ],
  };
  return { escena, armada: armarEscena(escena) };
}

test("columnas acostadas con varias copias: una estructura de capas de 4, por copia, no un anillo con todas juntas", () => {
  const { escena, armada } = escenaConRamas();
  const rama = armada.porNodo.find((n) => n.id === "rama")!;
  assert.ok(rama.copias >= 3, "hay varias copias");
  assert.ok(rama.puestas.every((p) => Math.abs(p.marco.m[4]) < 0.5), "las copias están acostadas");
  const hoja = hojaDeEscena("ramas", escena, armada);
  const e = hoja.estructuras.find((x) => x.id === "rama")!;
  assert.equal(e.modo, "anillos");
  assert.equal(e.unidades, rama.copias);
  assert.equal(e.globosPorUnidad * rama.copias, rama.globos.length);
  assert.ok(e.capas.every((c) => c.globos.length === 4), "todas las capas son cuartetos");
  assert.equal(e.capas.reduce((s, c) => s + c.repeticiones, 0) * 4, e.globosPorUnidad);
  // Lo que se hacía antes: agrupar por la altura en el mundo, con las copias juntas. Con columnas acostadas no da capas de 4.
  const porAltura = agruparDesdePrimero(rama.globos.map((g) => ({ y: centroDelGlobo(g).y })), (c) => c.y, 5);
  assert.ok(porAltura.some((grupo) => grupo.length !== 4), "agrupar por altura del mundo rompería las capas");
});

test("la bomba de la hoja es la de la escena, copia por copia", () => {
  const { escena, armada } = escenaConRamas();
  const hoja = hojaDeEscena("ramas", escena, armada);
  const esperado = sumaSinRedondear(filasBomba(inflablesDeEscena(armada)));
  assert.ok(Math.abs(hoja.segundosBomba - esperado) < 0.05, `${hoja.segundosBomba} vs ${esperado}`);
});

/** Una escena de columnas en el piso, una junto a otra, con los nombres dados. */
const escenaDeColumnas = (piezas: ReadonlyArray<readonly [string, Pieza]>): Escena => ({
  sala: SALA_INICIAL,
  nodos: piezas.map(([nombre, pieza], k) => ({ id: `n${k}`, nombre, pieza, colocacion: { en: "piso", xCm: -200 + k * 90, zCm: 0, giroGrados: 0 } })),
});

test("una columna con capas que no son del tamaño del módulo no se dibuja: una tabla por capa", () => {
  const escena = escenaDeColumnas([["Columna", columnaClasica(120)]]);
  const nodo = armarEscena(escena).porNodo[0]!;
  const rota = { ...nodo, globos: nodo.globos.slice(1) };
  const e = estructuraDeNodo(rota, escena.nodos[0]!.pieza, {});
  assert.equal(e.modo, "capas");
  assert.equal(e.capas.length, 0);
  assert.equal(e.tramos[0]!.globos.length, 3, "la primera capa quedó con 3 globos");
  assert.match(e.nota ?? "", /no son del tamaño de un módulo/);
  assert.equal(e.tramos.reduce((s, t) => s + t.globos.length, 0), e.globosPorUnidad);
});

test("dos columnas con los mismos colores pero armadas distinto (espiral y zig-zag) no se juntan, y el título dice cuál es cuál", () => {
  const espiral = columnaClasica(120);
  const zigzag: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 120, patron: "zigzag", colores: ["609", "005", "570", "010"] };
  const escena = escenaDeColumnas([["Columna 1", espiral], ["Columna 2", espiral], ["Columna 3", zigzag], ["Columna 4", zigzag]]);
  const hoja = hojaDeEscena("c", escena, armarEscena(escena));
  assert.deepEqual(hoja.estructuras.map((e) => [e.nombre, e.unidades]), [["Columna 1; Columna 2", 2], ["Columna 3; Columna 4", 2]]);
  assert.notDeepEqual(hoja.estructuras[0]!.capas.map((c) => c.giroGrados), hoja.estructuras[1]!.capas.map((c) => c.giroGrados));
});

test("las piezas iguales se juntan con su nombre, sin contar piezas: el encabezado ya cuenta las copias", () => {
  const escena = escenaDeColumnas([["Columna 1", columnaClasica(120)], ["Columna 2", columnaClasica(120)], ["Columna 3", columnaClasica(120)]]);
  const armada = armarEscena(escena);
  const hoja = hojaDeEscena("c", escena, armada);
  assert.deepEqual(hoja.estructuras.map((e) => [e.nombre, e.unidades, e.totalGlobos]), [["Columna", 3, armada.globos.length]]);
});

test("una pieza de franjas de altura es la misma estando de pie, girada o colgada del techo: no se parte en variantes", () => {
  const arco = arcoOrganico(240, 200);
  const escena: Escena = {
    sala: SALA_INICIAL,
    nodos: [
      { id: "a", nombre: "Arco 1", pieza: arco, colocacion: { en: "piso", xCm: -150, zCm: -100, giroGrados: 0 } },
      { id: "b", nombre: "Arco 2", pieza: arco, colocacion: { en: "piso", xCm: 100, zCm: -100, giroGrados: 37 } },
      { id: "c", nombre: "Arco 3", pieza: arco, colocacion: { en: "techo", xCm: 0, zCm: 50, cuelgaCm: 0, giroGrados: 271, volteada: true } },
    ],
  };
  const hoja = hojaDeEscena("arcos", escena, armarEscena(escena));
  assert.equal(hoja.estructuras.length, 1);
  assert.equal(hoja.estructuras[0]!.modo, "alturas");
  assert.equal(hoja.estructuras[0]!.unidades, 3);
});

test("una pieza que no se pudo poner no se cuenta como pieza sin globos: sus avisos ya salen arriba", () => {
  const escena: Escena = {
    sala: SALA_INICIAL,
    nodos: [
      { id: "ok", nombre: "Columna", pieza: columnaClasica(120), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "huerfana", nombre: "Columna huérfana", pieza: columnaClasica(120), colocacion: { en: "ancla", padreId: "no-existe", ancla: 0, cada: 1, giroGrados: 0 } },
    ],
  };
  const armada = armarEscena(escena);
  const hoja = hojaDeEscena("c", escena, armada);
  assert.ok(!hoja.otrasPiezas.some((n) => n.includes("huérfana")));
  assert.ok(hoja.avisos.some((a) => a.includes("Columna huérfana")), "el aviso de la pieza está en la hoja");
  assert.equal(hoja.globos, armada.porNodo[0]!.globos.length);
});

test("un módulo de 4 o más globos es un solo anillo (3 o menos van a la tabla) y su remate va aparte", () => {
  const colores = ["609", "005", "570", "010", "609", "005"];
  const modulo = (modulo: "pareja" | "trio" | "cuarteto" | "sexteto", n: number, remate?: boolean): NodoEscena => ({
    id: modulo, nombre: modulo,
    pieza: { tipo: "modulo", modulo, formatoId: "R-12", infladoCm: 25, colores: colores.slice(0, n), ...(remate ? { remate: { formatoId: "R-18", codigo: "005" } } : {}) },
    colocacion: { en: "piso", xCm: n * 60, zCm: 0, giroGrados: 0 },
  });
  const escena: Escena = { sala: SALA_INICIAL, nodos: [modulo("pareja", 2), modulo("trio", 3), modulo("cuarteto", 4, true), modulo("sexteto", 6)] };
  const hoja = hojaDeEscena("módulos", escena, armarEscena(escena));
  assert.deepEqual(hoja.estructuras.map((e) => [e.id, e.modo, e.capas.map((c) => c.globos.length)]), [["cuarteto", "anillos", [4]], ["sexteto", "anillos", [6]]]);
  assert.deepEqual(hoja.compactas.flatMap((f) => f.nombres).sort(), ["pareja", "trio"]);
  const cuartetoConRemate = hoja.estructuras[0]!;
  assert.equal(cuartetoConRemate.globosPorUnidad, 5);
  assert.deepEqual(cuartetoConRemate.aparte.map((a) => [a.etiqueta, a.formatoId, a.cantidad]), [["remate", "R-18", 1]]);
  assert.match(cuartetoConRemate.modulo?.etiqueta ?? "", /Cuarteto/);
});

test("una columna con remate: las capas siguen siendo de 4 y el remate va aparte, una vez", () => {
  const columna = { ...columnaClasica(120), remate: { formatoId: "R-18", codigo: "005" } };
  const escena: Escena = { sala: SALA_INICIAL, nodos: [{ id: "c", nombre: "Columna con remate", pieza: columna, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  const armada = armarEscena(escena);
  const [e] = hojaDeEscena("c", escena, armada).estructuras;
  assert.equal(e!.modo, "anillos");
  assert.ok(e!.capas.every((c) => c.globos.length === 4));
  assert.deepEqual(e!.aparte.map((a) => [a.etiqueta, a.cantidad]), [["remate", 1]]);
  assert.equal(e!.capas.reduce((s, c) => s + c.repeticiones * 4, 0) + 1, armada.globos.length);
});

// ---------------------------------------------------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------------------------------------------------

const estructuraFalsa = (id: string, capas: number, tramos = 0): EstructuraHoja => ({
  id, nombre: id, unidades: 1, modo: capas ? "anillos" : "alturas", avisos: [],
  capas: Array.from({ length: capas }, (_, i) => ({ numero: i + 1, hasta: i + 1, repeticiones: 1, alturaCm: i, giroGrados: null, globos: [], sentidoNumeracion: "horario", radioAnilloCm: 0, extensionCm: 0, dibujable: true, colores: [], marcas: [], secuencia: [], filasBomba: [], segundosBomba: 0 })),
  tramos: Array.from({ length: tramos }, (_, i) => ({ numero: i + 1, etiqueta: "", desdeCm: 0, hastaCm: 0, globos: [], colores: [], tamanos: [], marcas: [], filasBomba: [], segundosBomba: 0 })),
  cuartetos: [], aparte: [], colores: [], tubos: [], flores: [], globosPorUnidad: 4, filasBomba: [], totalGlobos: 4, segundosPorUnidad: 0, segundosBomba: 0, firma: id,
});

const hojaFalsa = (estructuras: EstructuraHoja[]): HojaArmado => ({ nombre: "x", piezas: estructuras.length, globos: 0, estructuras, compactas: [], metalizados: [], otrasPiezas: [], lista: [], segundosBomba: 0, avisos: [] });

const trozosDe = (paginas: PaginaHoja[], id: string) => paginas.flatMap((p) => p.trozos).filter((t) => t.tipo === "estructura" && t.estructura.id === id);

test("una estructura grande pasa de página y dice «(continúa)»; ninguna capa se pierde ni se repite", () => {
  const paginas = paginasDeHoja(hojaFalsa([estructuraFalsa("grande", 20)]));
  const trozos = trozosDe(paginas, "grande");
  assert.ok(trozos.length > 1);
  assert.deepEqual(trozos.map((t) => t.tipo === "estructura" && t.primero), [true, ...trozos.slice(1).map(() => false)]);
  assert.deepEqual(trozos.flatMap((t) => (t.tipo === "estructura" ? t.capas.map((c) => c.numero) : [])), Array.from({ length: 20 }, (_, i) => i + 1));
});

test("las estructuras pequeñas comparten página y la lista de compra siempre va en página nueva", () => {
  const paginas = paginasDeHoja(hojaFalsa([estructuraFalsa("a", 0, 1), estructuraFalsa("b", 0, 1), estructuraFalsa("c", 0, 1)]));
  assert.equal(paginas.length, 2, "cabe todo en una página y la lista en otra");
  assert.deepEqual(paginas[0]!.trozos.map((t) => (t.tipo === "estructura" ? t.estructura.id : t.tipo)), ["a", "b", "c"]);
  assert.deepEqual(paginas[1]!.trozos.map((t) => t.tipo), ["lista"]);
  assert.deepEqual(paginas.map((p) => p.numero), [1, 2]);
});

test("una lista de compra larga se parte en páginas: la bomba total va con la última línea y nunca queda sola", () => {
  for (const n of [1, 30, 36, 37, 38, 39, 40, 80, 120]) {
    const lista = Array.from({ length: n }, (_, i) => ({ formatoId: "R-12", codigo: String(i), nombreColor: "x", hex: "#000000", cantidad: 1 }));
    const trozos = paginasDeHoja({ ...hojaFalsa([]), lista }).flatMap((pg) => pg.trozos);
    const listas = trozos.flatMap((t) => (t.tipo === "lista" ? [t] : []));
    assert.equal(listas.length, trozos.length, `${n} líneas`);
    assert.deepEqual(listas.map((t) => t.ultimo), listas.map((_, i) => i === listas.length - 1), `${n} líneas: solo la última cierra`);
    assert.ok(listas.every((t) => t.lineas.length > 0), `${n} líneas: ninguna página de la lista queda sin líneas`);
    assert.equal(listas.reduce((s, t) => s + t.lineas.length, 0), n);
  }
});

test("una hoja sin estructuras tiene solo la página de la lista", () => {
  const paginas = paginasDeHoja(hojaFalsa([]));
  assert.deepEqual(paginas.map((p) => p.trozos.map((t) => t.tipo)), [["lista"]]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Papel: la hoja no fuerza A4 (en Colombia se imprime en Carta)
// ---------------------------------------------------------------------------------------------------------------------

test("la hoja no fuerza el tamaño del papel", () => {
  for (const archivo of ["HojaArmadoEscena", "HojaArmadoPagina", "HojaArmadoEstructura", "HojaArmadoCompacta", "HojaArmadoLista"]) {
    const fuente = readFileSync(new URL(`../../components/tres-d/${archivo}.tsx`, import.meta.url), "utf8");
    assert.ok(!/@page/.test(fuente) && !/size:\s*A4/i.test(fuente), `${archivo} fija el papel`);
  }
});
