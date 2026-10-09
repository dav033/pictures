/**
 * La foto del cumpleaños (fondo de arco orgánico salvia, champaña y marfil con cortina de flecos, mesa de postres blanca con tres pasteles y dos corazones
 * verdes): los nueve defectos de la modelada, cada uno con una prueba que falla sin su arreglo. Sin red ni IA: la lectura cruda y las detecciones son las
 * del registro real (`scripts/test/fixtures/foto-cumple/`).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-foto-cumple.ts
 *
 * 1 el follaje con color de id («eucalipto verde_gris») no tira la guirnalda; una decoración que falla no tira la pieza
 * 2 el telón colgado no salta delante de una mesa baja (el telón lo dice el catálogo, no el fondo)
 * 3 los pasteles detectados y no leídos son piezas, sobre la mesa; el prompt no manda tortas a «otro»
 * 4 la cortina de flecos existe, tiene tiras verticales y es liviana
 * 5 los montones toman colores de la detección (nude, dorado champaña), y marfil/crema/nude no son el blanco 005
 * 6 los colores de un mueble van por parte (tapa, patas, adorno), no por posición; la mesa de postres puede ser ornamentada
 * 7 los corazones (C-12, cualquier color) son una pieza de la lectura
 * 8 un montón de piso no atraviesa la pared del fondo
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { colorDeFollaje, FLORES_ARTIFICIALES, type TipoFlorArtificial } from "../../src/lib/globos3d/flores-artificiales";
import { floresLeidas, floresPedidas } from "../../src/lib/globos3d/herramientas-escena-trazo";
import { conNotaSiFalla } from "../../src/lib/globos3d/decoracion-segura";
import { LecturaFotoSchema, type ColorLeido, type LecturaFoto, type PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { medirConDetecciones, type FondoDetectado, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";
import { codigoDeBlancoCalido, codigoDeColor } from "../../src/lib/globos3d/colores-lectura";
import { coloresConLaEscena, indiceDeDetectado } from "../../src/lib/globos3d/medir-colores";
import { construirPromptLectura } from "../../src/lib/globos3d/prompt-lectura-foto";
import { idDeFondoConocido } from "../../src/lib/globos3d/fondos-sinonimos";
import { formatoPorId } from "../../src/lib/globos3d/formatos";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import type { SolidoEscenografia } from "../../src/lib/globos3d/escenografia";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { coloresPorParte } from "../../src/lib/globos3d/colores-por-parte";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import { globosDe } from "../../src/lib/globos3d/medir-geometria";

let pruebas = 0, fallos = 0;
const prueba = (nombre: string, fn: () => void) => {
  try { fn(); pruebas += 1; console.log(`  ok  ${nombre}`); } catch (e) { fallos += 1; console.log(`  FALLA ${nombre}: ${e instanceof Error ? e.message.split(String.fromCharCode(10)).slice(0, 3).join(" | ") : String(e)}`); }
};

const F = "scripts/test/fixtures/foto-cumple/";
const json = (nombre: string): unknown => JSON.parse(readFileSync(F + nombre, "utf8"));
const cruda = LecturaFotoSchema.parse(json("lectura-cruda.json"));
const medidaDelRegistro = LecturaFotoSchema.parse(json("lectura-medida.json"));
const detecciones = json("detecciones.json") as GloboDetectado[];
const fondos = json("fondos.json") as FondoDetectado[];

const color = (nombre: string, hex: string, peso = 100, acabado: ColorLeido["acabado"] = "mate"): ColorLeido => ({ nombre, hex, peso, acabado });
const nodo = (e: Escena, id: string) => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta el nodo ${id} (hay ${e.nodos.map((n) => n.id).join(", ")})`);
const cajaDe = (e: Escena, id: string) => armarEscena(e).porNodo.find((n) => n.id === id)!.caja;
const fondoDe = (id: string, extra: Partial<Extract<PiezaLeida, { tipo: "fondo" }>> = {}): PiezaLeida => ({ tipo: "fondo", id, x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.3, colores: [color("blanco", "#f4f2ee")], ...extra });
const lectura = (piezas: PiezaLeida[], cambios: Partial<LecturaFoto> = {}): LecturaFoto => LecturaFotoSchema.parse({ ...medidaDelRegistro, ...cambios, piezas });
const solidosDe = (p: Pieza): SolidoEscenografia[] => armarPieza(p).solidos ?? [];
type Caja = Extract<SolidoEscenografia, { forma: "caja" }>;
const esCaja = (s: SolidoEscenografia): s is Caja => s.forma === "caja";
const guirnaldaDelRegistro = medidaDelRegistro.piezas.find((p) => p.tipo === "guirnalda_organica")!;

// ---------------------------------------------------------------------------------------------------------- 1
prueba("1 · cada follaje × cada color de su catálogo (por id y por nombre) se lee con su color, sin notas", () => {
  let casos = 0;
  for (const [tipo, flor] of Object.entries(FLORES_ARTIFICIALES) as Array<[TipoFlorArtificial, (typeof FLORES_ARTIFICIALES)[TipoFlorArtificial]]>) {
    for (const c of flor.colores) {
      for (const pedido of [`${tipo} ${c.id}`, `${tipo} ${c.nombre}`]) {
        const r = floresLeidas([pedido]);
        assert.deepEqual(r.notas, [], pedido);
        assert.equal(r.flores?.proporcion[0]?.colorId, c.id, pedido);
        assert.equal(floresPedidas([pedido]).proporcion[0]?.colorId, c.id, pedido);
      }
      assert.equal(colorDeFollaje(flor, c.id)?.id, c.id, `${tipo}: colorDeFollaje acepta el id «${c.id}»`);
      casos++;
    }
  }
  assert.ok(casos >= 17, `${casos} combinaciones`);
});

prueba("1 · la lectura del registro (eucalipto, hoja_seca dorada, gypsophila) arma el follaje y la guirnalda se queda", () => {
  const f = floresLeidas(["eucalipto", "hoja_seca dorada", "gypsophila"]);
  assert.deepEqual(f.notas, []);
  assert.deepEqual(f.flores?.proporcion.map((q) => `${q.tipo}/${q.colorId}`), ["eucalipto/verde_gris", "hoja_seca/dorada", "gypsophila/blanca"]);
  const c = compilarLectura(medidaDelRegistro);
  assert.ok(c.escena.nodos.some((n) => n.id === "guirnalda-organica"), "la guirnalda está");
  assert.deepEqual(c.omitidas.filter((o) => o.startsWith("Pieza 1")), []);
});

prueba("1 · una decoración que falla se omite con su nota y la pieza se arma igual", () => {
  const notas: string[] = [];
  const r = conNotaSiFalla("Pieza 1 (guirnalda_organica): el follaje", notas, () => { throw new Error("«Rama de eucalipto» viene en verde grisáceo."); }, "sin follaje");
  assert.equal(r, "sin follaje");
  assert.equal(notas.length, 1);
  assert.match(notas[0]!, /el follaje.*verde grisáceo.*el resto de la pieza se arma igual/);
  assert.equal(conNotaSiFalla("x", notas, () => 7, 0), 7);
  assert.equal(notas.length, 1);
});

// ---------------------------------------------------------------------------------------------------------- 2
prueba("2 · una cortina colgada y una mesa de postres de 31 cm de fondo: la cortina sigue en la pared, detrás de la mesa", () => {
  const c = compilarLectura(medidaDelRegistro);
  const cortina = nodo(c.escena, "cortina-luces");
  assert.equal(cortina.colocacion.en, "pared", "no salta a «libre» delante de la mesa");
  assert.ok(!c.notas.some((n) => /va delante del panel/.test(n)), c.notas.join(" | "));
  const mesa = cajaDe(c.escena, "mesa-postres");
  assert.ok(mesa.max.z - mesa.min.z < 40, `la mesa mide ${mesa.max.z - mesa.min.z} cm de fondo`);
  assert.ok(cajaDe(c.escena, "cortina-luces").max.z <= mesa.min.z, "la cortina queda detrás de la mesa");
});

// ---------------------------------------------------------------------------------------------------------- 3
const medida = medirConDetecciones(cruda, detecciones, fondos);

prueba("3 · tres base_pastel detectados y no leídos son tres pasteles de la lectura, en su x", () => {
  const pasteles = medida.lectura.piezas.filter((p) => p.tipo === "fondo" && p.id === "pastel");
  assert.equal(pasteles.length, 3, medida.notas.join(" | "));
  assert.deepEqual(pasteles.map((p) => (p.tipo === "fondo" ? Math.round(p.x * 100) : 0)).sort((a, b) => a - b), [38, 51, 64]);
  assert.ok(medida.notas.some((n) => /pastel.*detectado/.test(n)));
});

prueba("3 · una caja detectada de un fondo que no va sobre una mesa y no se leyó no se inventa", () => {
  const extra: FondoDetectado[] = [...fondos, { box_2d: [500, 100, 900, 250], id: "sofa" }, { box_2d: [100, 100, 300, 300], id: "arcos_chiara" }];
  const m = medirConDetecciones(cruda, detecciones, extra);
  assert.deepEqual(m.lectura.piezas.filter((p) => p.tipo === "fondo").map((p) => (p.tipo === "fondo" ? p.id : "")).sort(), ["cortina_luces", "mesa_postres", "pastel", "pastel", "pastel", "rotulo_acrilico"]);
});

prueba("3 · los pasteles quedan SOBRE la mesa de postres, a su altura y dentro de su tapa", () => {
  const c = compilarLectura(medida.lectura);
  const mesa = cajaDe(c.escena, "mesa-postres");
  const pasteles = c.escena.nodos.filter((n) => n.id.startsWith("pastel"));
  assert.equal(pasteles.length, 3);
  for (const p of pasteles) {
    assert.equal(p.colocacion.en, "sobre");
    assert.equal(p.colocacion.en === "sobre" ? p.colocacion.padreId : "", "mesa-postres");
    const caja = cajaDe(c.escena, p.id);
    assert.ok(Math.abs(caja.min.y - mesa.max.y) < 3, `${p.id} apoya en la tapa: ${caja.min.y} vs ${mesa.max.y}`);
    assert.ok(caja.min.x >= mesa.min.x - 1 && caja.max.x <= mesa.max.x + 1, `${p.id} dentro de la tapa en x`);
    assert.ok(caja.min.z >= mesa.min.z - 1 && caja.max.z <= mesa.max.z + 1, `${p.id} dentro de la tapa en z`);
  }
  assert.ok(new Set(pasteles.map((p) => Math.round(cajaDe(c.escena, p.id).min.x))).size === 3, "cada uno en su sitio");
  assert.ok(c.omitidas.every((o) => !/pastel|torta.*arm/i.test(o) || /tortas y postres/.test(o)));
});

prueba("3 · sin mesa debajo, el pastel va al piso con su nota; el pastel de 1 a 3 pisos sale de su alto", () => {
  const c = compilarLectura(lectura([fondoDe("pastel", { ancho: 0.1, alto: 0.1 })]));
  assert.equal(nodo(c.escena, "pastel").colocacion.en, "piso");
  assert.ok(c.notas.some((n) => /no hay una mesa/.test(n)));
  const pieza = (alto: number) => solidosDe(piezaDeMueble(muebleDe("pastel")!, { anchoCm: 28, fondoCm: 28, altoCm: alto, colores: ["#f4efe4", "#d6b25a"] }));
  const pisos = (alto: number) => pieza(alto).filter((s) => s.forma === "cilindro" && s.radioCm > 5 && s.altoCm > 5).length;
  assert.deepEqual([pisos(20), pisos(30), pisos(40)], [1, 2, 3]);
});

prueba("3 · el prompt de la lectura ya no manda las tortas a «otro»", () => {
  const prompt = construirPromptLectura();
  assert.ok(!/- otro:[^\n]*torta/.test(prompt), "otro no menciona la torta");
  assert.match(prompt, /fondo pastel/);
  assert.match(prompt, /cortina_flecos/);
});

// ---------------------------------------------------------------------------------------------------------- 4
prueba("4 · cortina de flecos: el lector la nombra de varias formas y todas van al mismo id", () => {
  for (const nombre of ["cortina_flecos", "cortina de flecos", "cortina de tiras", "Cortina de tinsel", "fringe curtain", "cortina_shimmer"]) assert.equal(idDeFondoConocido(nombre), "cortina_flecos", nombre);
  assert.ok(muebleDe("cortina_flecos")?.telon, "es un telón de pared");
});

prueba("4 · la geometría tiene tiras verticales (muchas, delgadas, de arriba a abajo) y es liviana", () => {
  const c = compilarLectura(lectura([fondoDe("cortina_flecos", { x: 0.5, yBase: 0.92, ancho: 0.6, alto: 0.7, colores: [color("salvia", "#9caf88", 70, "brillante"), color("verde oliva", "#7a8b69", 30)] })]));
  const n = nodo(c.escena, "cortina-flecos");
  assert.equal(n.colocacion.en, "pared");
  const a = armarEscena(c.escena).porNodo.find((x) => x.id === "cortina-flecos")!;
  const tiras = a.solidos.filter(esCaja).filter((s) => s.tamano.y > 15 * s.tamano.x && s.tamano.x < 2);
  assert.ok(tiras.length >= 40, `${tiras.length} tiras`);
  assert.ok(tiras.every((s) => s.tamano.y > 0.9 * Math.max(...tiras.map((t) => t.tamano.y)) * 0.9), "caen casi hasta abajo, todas");
  const materiales = new Set(a.solidos.map((s) => `${s.acabado}|${s.hex}`));
  assert.ok(materiales.size <= 8, `${materiales.size} materiales distintos: el visor junta lo que comparte material`);
  assert.ok(a.solidos.length <= 200, `${a.solidos.length} sólidos`);
  // Con un segundo color lleva el drapeado de raso detrás; sin él, solo tiras.
  const sinRaso = solidosDe(piezaDeMueble(muebleDe("cortina_flecos")!));
  assert.ok(a.solidos.length > sinRaso.length - 1 && a.solidos.some((s) => s.acabado === "satinado"), "el drapeado de raso sale con el segundo color");
  assert.ok(!sinRaso.some((s) => s.acabado === "satinado"));
});

// ---------------------------------------------------------------------------------------------------------- 5
prueba("5 · un montón toma de la detección los colores que el lector no puso, aun con pocos globos", () => {
  const paleta = guirnaldaDelRegistro.colores;
  const pocos: GloboDetectado[] = [{ box_2d: [800, 100, 860, 160], color: "nude" }, { box_2d: [800, 170, 860, 230], color: "nude" }, { box_2d: [800, 240, 860, 300], color: "verde" }, { box_2d: [800, 310, 860, 370], color: "blanco" }];
  const heap = [color("Fashion Eucalipto", "#7a9882", 60), color("Fashion Blanco", "#f4f2ee", 40)];
  const r = coloresConLaEscena(heap, globosDe(pocos, 1), paleta);
  assert.deepEqual(r.nuevos, ["nude"]);
  assert.equal(r.colores.reduce((s, c) => s + c.peso, 0) >= 99 && r.colores.reduce((s, c) => s + c.peso, 0) <= 101, true);
  const sinNude = coloresConLaEscena(heap, globosDe(pocos.slice(2), 1), paleta);
  assert.deepEqual(sinNude.nuevos, []);
});

prueba("5 · el nude y el beige detectados no se toman por el blanco; el dorado detectado es el champaña cromado (971)", () => {
  const heap = [color("Fashion Eucalipto", "#7a9882", 60), color("Fashion Blanco", "#f4f2ee", 40)];
  const indice = indiceDeDetectado(heap);
  assert.equal(indice("nude"), -1);
  assert.equal(indice("beige"), -1);
  assert.equal(indice("blanco"), 1);
  const champana = color("Reflex Champaña", "#cfbc9a", 30, "cromado");
  assert.equal(indiceDeDetectado([color("Fashion Blanco", "#f4f2ee", 70), champana])("dorado"), 1, "el dorado casa con el cromado");
  const detectados: GloboDetectado[] = [{ box_2d: [700, 100, 760, 160], color: "dorado" }, { box_2d: [700, 170, 760, 230], color: "dorado" }, { box_2d: [700, 240, 760, 300], color: "blanco" }];
  const r = coloresConLaEscena(heap, globosDe(detectados, 1), [...heap, champana]);
  const dorado = r.colores.find((c) => c.acabado === "cromado")!;
  assert.equal(dorado.nombre, "Reflex Champaña");
  assert.equal(codigoDeColor(dorado, ["R-12"], []), "971");
});

prueba("5 · con las detecciones de esta foto, los montones llevan nude (661) y la guirnalda conserva el champaña 971", () => {
  const montones = medida.lectura.piezas.filter((p): p is Extract<PiezaLeida, { tipo: "racimo_piso" }> => p.tipo === "racimo_piso");
  assert.ok(montones.some((m) => m.colores.some((c) => c.nombre === "nude")), JSON.stringify(montones.map((m) => m.colores.map((c) => c.nombre))));
  const nude = montones.flatMap((m) => m.colores).find((c) => c.nombre === "nude")!;
  assert.equal(codigoDeColor(nude, ["R-12"], []), "661");
  const guirnalda = medida.lectura.piezas.find((p) => p.tipo === "guirnalda_organica")!;
  const champana = guirnalda.colores.find((c) => c.nombre === "Reflex Champaña")!;
  assert.equal(codigoDeColor(champana, ["R-12"], []), "971");
  const c = compilarLectura(medida.lectura);
  const codigos = new Set(armarEscena(c.escena).materiales.map((m) => m.codigo));
  for (const k of ["027", "971", "661"]) assert.ok(codigos.has(k), `${k} en ${[...codigos].join(",")}`);
});

prueba("5 · marfil, ivory, crema y blanco crema son el crema 107 (o el perla 873), nunca el blanco 005 ni un satín", () => {
  for (const nombre of ["marfil", "Ivory", "crema", "blanco crema", "Blanco Marfil", "hueso"]) {
    assert.equal(codigoDeColor(color(nombre, "#efe6d2"), ["R-12"], []), "107", nombre);
  }
  assert.equal(codigoDeColor(color("marfil", "#efe6d2", 100, "perla"), ["R-12"], []), "873");
  assert.equal(codigoDeBlancoCalido(color("blanco", "#f4f2ee"), ["R-12"]), null, "el blanco sigue siendo 005");
  assert.equal(codigoDeColor(color("blanco", "#f4f2ee"), ["R-12"], []), "005");
  assert.equal(codigoDeColor(color("arena", "#d8c3a0"), ["R-12"], []), "071");
  assert.equal(codigoDeColor(color("nude", "#e3c2a8"), ["R-12"], []), "661");
});

// ---------------------------------------------------------------------------------------------------------- 6
prueba("6 · 90 % blanco + 10 % dorado: tapa y patas blancas, el dorado de adorno (no patas doradas)", () => {
  const c = compilarLectura(medidaDelRegistro);
  const opciones = (nodo(c.escena, "mesa-postres").pieza as Extract<ReturnType<typeof piezaDeMueble>, { tipo: "escenografia" }>).mueble!.opciones!;
  assert.deepEqual(opciones.colores, ["#f0ebdf", "#f0ebdf", "#c5a76e"]);
});

prueba("6 · colores por parte: acento sin parte de adorno se avisa; pesos parecidos conservan el orden", () => {
  const blanco = color("blanco", "#ffffff", 90), oro = color("dorado", "#c5a76e", 10);
  assert.deepEqual(coloresPorParte(["tapa", "patas", "adorno (opcional)"], [blanco, oro]).porParte, [blanco, blanco, oro]);
  const sinAdorno = coloresPorParte(["tapa", "patas"], [blanco, oro]);
  assert.deepEqual(sinAdorno.porParte, [blanco, blanco]);
  assert.deepEqual(sinAdorno.sobran, [oro]);
  const parejo = [color("crema", "#e9dfcd", 60), color("dorado", "#c9a14a", 40)];
  assert.deepEqual(coloresPorParte(["tapa", "patas", "adorno (opcional)"], parejo).porParte, [parejo[0], parejo[1], undefined]);
  // Una silla: la estructura y el cojín siguen el orden de la lectura aunque el cojín sea poco.
  const silla = coloresPorParte(["estructura", "cojín"], [color("dorado", "#d6b25a", 85), color("crema", "#f4efe4", 15)]);
  assert.equal(silla.porParte[1]?.nombre, "crema");
});

prueba("6 · la mesa de postres con adorno es la ornamentada (patas torneadas); sin él, la consola de siempre", () => {
  const mesa = muebleDe("mesa_postres")!;
  const lisa = solidosDe(piezaDeMueble(mesa, { ...mesa.medidas, colores: ["#f0ebdf", "#f0ebdf"] }));
  const ornada = solidosDe(piezaDeMueble(mesa, { ...mesa.medidas, colores: ["#f0ebdf", "#f0ebdf", "#c5a76e"] }));
  const patas = (s: typeof lisa) => s.filter((x) => x.forma === "cilindro" && x.altoCm > 3).length;
  assert.ok(patas(ornada) >= 4 * 5, `${patas(ornada)} piezas de pata torneada`);
  assert.ok(patas(lisa) <= 4, `${patas(lisa)} en la lisa`);
  assert.ok(ornada.some((s) => s.hex === "#c5a76e"), "lleva el filete dorado");
  assert.ok(!lisa.some((s) => s.hex === "#c5a76e"));
});

// ---------------------------------------------------------------------------------------------------------- 7
const corazon = (cantidad: number, colores: ColorLeido[], extra: Partial<Extract<PiezaLeida, { tipo: "corazon" }>> = {}): PiezaLeida => ({ tipo: "corazon", x: 0.5, y: 0.7, en: "piso", cantidad, colores, ...extra });

prueba("7 · dos corazones verdes: dos mallas de corazón en la escena y dos C-12 verdes en la lista de materiales", () => {
  const c = compilarLectura(lectura([corazon(2, [color("verde", "#3a9d5d", 100)])]));
  const a = armarEscena(c.escena);
  const globos = a.globos.filter((g) => formatoPorId(g.formatoId)?.tipo === "corazon");
  assert.equal(globos.length, 2);
  assert.equal(a.globos.length, 2);
  assert.ok(globos.every((g) => g.formatoId === "C-12"));
  const verde = codigoDeColor(color("verde", "#3a9d5d", 100), ["R-12"], []);
  assert.deepEqual(a.materiales.map((m) => `${m.formatoId} ${m.codigo} ×${m.cantidad}`), [`C-12 ${verde} ×2`]);
  assert.equal(c.omitidas.length, 0);
});

prueba("7 · cada color de la paleta Sempertex arma un corazón C-12 (y los colores se reparten por peso)", () => {
  const codigos = [...new Set(TABLA_SEMPERTEX.referencias.map((r) => r.codigo))];
  assert.ok(codigos.length > 60);
  for (const r of TABLA_SEMPERTEX.referencias) {
    const c = compilarLectura(lectura([corazon(1, [color(r.nombreCompleto, r.hexGlobo, 100, "mate")])]));
    const a = armarEscena(c.escena);
    assert.equal(a.globos.length, 1, `${r.codigo} ${r.nombreCompleto}`);
    assert.equal(formatoPorId(a.globos[0]!.formatoId)?.tipo, "corazon");
  }
  const mezcla = compilarLectura(lectura([corazon(5, [color("rojo", "#c8102e", 60), color("blanco", "#f4f2ee", 40)])]));
  const materiales = armarEscena(mezcla.escena).materiales;
  assert.deepEqual(materiales.map((m) => m.cantidad).sort(), [2, 3]);
});

prueba("7 · un corazón sobre un montón de piso va en ese montón (delante de su centro)", () => {
  const monton = medidaDelRegistro.piezas.filter((p) => p.tipo === "racimo_piso")[0]!;
  const c = compilarLectura(lectura([monton, corazon(2, [color("verde", "#3a9d5d")], { x: monton.tipo === "racimo_piso" ? monton.x : 0.15, y: 0.85 })]));
  const m = nodo(c.escena, "racimo-piso").colocacion;
  const h = nodo(c.escena, "corazon").colocacion;
  assert.ok(m.en === "piso" && h.en === "libre" && h.zCm > m.zCm, `${JSON.stringify(m)} ${JSON.stringify(h)}`);
  assert.ok(c.notas.some((n) => /corazon.*montón/.test(n)));
});

// ---------------------------------------------------------------------------------------------------------- 8
prueba("8 · ningún montón de piso atraviesa la pared del fondo ni los costados", () => {
  const c = compilarLectura(medida.lectura);
  const { fondoCm, anchoCm } = c.escena.sala;
  for (const n of c.escena.nodos.filter((x) => x.id.startsWith("racimo-piso"))) {
    const caja = cajaDe(c.escena, n.id);
    assert.ok(caja.min.z >= -fondoCm / 2 - 0.5, `${n.id}: z desde ${caja.min.z} (pared en ${-fondoCm / 2})`);
    assert.ok(caja.min.x >= -anchoCm / 2 && caja.max.x <= anchoCm / 2, `${n.id}: x ${caja.min.x}..${caja.max.x} en una sala de ${anchoCm}`);
  }
  assert.ok(c.notas.some((x) => /se salía de la sala/.test(x)), "avisa que lo corrió");
  // La lectura del registro (escala 303) ya no deja el montón de la derecha 19 cm dentro de la pared.
  const r = compilarLectura(medidaDelRegistro);
  for (const n of r.escena.nodos.filter((x) => x.id.startsWith("racimo-piso"))) assert.ok(cajaDe(r.escena, n.id).min.z >= -r.escena.sala.fondoCm / 2 - 0.5, n.id);
});

console.log(`test-foto-cumple: ${pruebas} pruebas ok, ${fallos} con fallas`);
if (fallos) process.exit(1);
