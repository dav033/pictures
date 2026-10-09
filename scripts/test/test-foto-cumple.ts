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
import { readdirSync, readFileSync } from "node:fs";
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
import { COLORES_ATESTIGUADOS, colorSeVendeEnFormato, coloresDelFormato, corazonesSinCobertura } from "../../src/lib/globos3d/formatos";
import { presentaciones, type Crosswalk } from "../../src/lib/globos3d/motor/crosswalk-variantes";
import { planearCompra } from "../../src/lib/globos3d/motor/plan-de-compra";
import { globosDe, kMedias1D } from "../../src/lib/globos3d/medir-geometria";
import { escalaPorMesas, escalaReconciliada } from "../../src/lib/globos3d/escala-por-muebles";
import { medirTamanos } from "../../src/lib/globos3d/medir-tamanos";
import { centroDe } from "../../src/lib/globos3d/letras";

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
  const notas: string[] = [], omitidas: string[] = [];
  const r = conNotaSiFalla("Pieza 1 (guirnalda_organica): el follaje", notas, omitidas, () => { throw new Error("«Rama de eucalipto» viene en verde grisáceo."); }, "sin follaje");
  assert.equal(r, "sin follaje");
  assert.equal(notas.length, 1);
  assert.match(notas[0]!, /el follaje.*verde grisáceo.*el resto de la pieza se arma igual/);
  assert.deepEqual(omitidas.length, 1, "además de la nota, queda entre lo que no se armó");
  assert.match(omitidas[0]!, /el follaje: no se armó.*verde grisáceo/);
  assert.equal(conNotaSiFalla("x", notas, omitidas, () => 7, 0), 7);
  assert.equal(notas.length, 1);
  assert.equal(omitidas.length, 1);
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

prueba("3 · sin mesa debajo no se inventa el pastel (queda en lo no armado con su motivo); el pastel de 1 a 3 pisos sale de su alto", () => {
  const c = compilarLectura(lectura([fondoDe("pastel", { ancho: 0.1, alto: 0.1 })]));
  assert.ok(!c.escena.nodos.some((n) => n.id.startsWith("pastel")), "no hay pastel flotando ni en el piso");
  assert.ok(c.omitidas.some((n) => /pastel.*no hay una mesa debajo/.test(n)), c.omitidas.join(" | "));
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

prueba("6 · colores por parte: solo con una parte de adorno se reparte por parte; sin ella, el orden de la lectura", () => {
  const blanco = color("blanco", "#ffffff", 90), oro = color("dorado", "#c5a76e", 10);
  assert.deepEqual(coloresPorParte(["tapa", "patas", "adorno (opcional)"], [blanco, oro]).porParte, [blanco, blanco, oro]);
  const sinAdorno = coloresPorParte(["tapa", "patas"], [blanco, oro]);
  assert.deepEqual(sinAdorno.porParte, [blanco, oro], "sin adorno: la tapa blanca y las patas doradas, como lo leyó el lector");
  assert.deepEqual(sinAdorno.sobran, []);
  const parejo = [color("crema", "#e9dfcd", 60), color("dorado", "#c9a14a", 40)];
  assert.deepEqual(coloresPorParte(["tapa", "patas", "adorno (opcional)"], parejo).porParte, [parejo[0], parejo[1], undefined]);
});

prueba("6 · con pesos reales (90/10 y 85/15), las patas doradas de una silla, el sofá y la mesa sin adorno siguen como se leyeron", () => {
  const compilar = (id: string, colores: ColorLeido[]) => {
    const c = compilarLectura(lectura([fondoDe(id, { colores })]));
    const n = c.escena.nodos[0]!;
    return { colores: n.pieza.tipo === "escenografia" ? n.pieza.mueble?.opciones?.colores : undefined, notas: c.notas };
  };
  const dorado = (peso: number) => color("dorado", "#d6b25a", peso, "cromado"), crema = (peso: number) => color("crema", "#f4efe4", peso);
  // Silla Tiffany: estructura dorada (85) y cojín crema (15): el cojín crema no se pierde ni se avisa como «sin usar».
  const silla = compilar("silla_tiffany", [dorado(85), crema(15)]);
  assert.deepEqual(silla.colores, ["#d6b25a", "#f4efe4"]);
  assert.ok(!silla.notas.some((n) => /es un acento/.test(n)), silla.notas.join(" | "));
  // Silla con patas doradas (85) y asiento blanco (15), el orden del catálogo de la moderna: patas primero.
  const moderna = compilar("silla_moderna", [dorado(85), crema(15)]);
  assert.deepEqual(moderna.colores, ["#d6b25a", "#f4efe4"], "patas doradas, asiento crema");
  // Un sofá: estructura (90) y cojín (10): cada uno el suyo.
  const sofa = compilar("sofa", [color("gris", "#8a8a8a", 90), color("blanco", "#ffffff", 10)]);
  assert.equal(sofa.colores?.[0], "#8a8a8a");
  assert.equal(sofa.colores?.[1], "#ffffff");
  // Una mesa sin parte de adorno (mesa de centro: tapa, patas): blanca 90 + dorada 10 = tapa blanca, patas doradas, y no se dice «acento sin usar».
  const mesa = compilar("mesa_centro", [color("blanco", "#ffffff", 90), dorado(10)]);
  assert.deepEqual(mesa.colores, ["#ffffff", "#d6b25a"]);
  assert.ok(!mesa.notas.some((n) => /es un acento/.test(n)), mesa.notas.join(" | "));
  // Y la de postres sí tiene adorno: tapa y patas blancas y el dorado de filete.
  assert.deepEqual(compilar("mesa_postres", [color("blanco", "#ffffff", 90), dorado(10)]).colores, ["#ffffff", "#ffffff", "#d6b25a"]);
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

// ---------------------------------------------------------------------------------------------------------- 9
prueba("9 · la foto con las detecciones reconstruidas mide ~300 cm de alto (no 480): los globos chicos no son el R-12", () => {
  const final = compilarLectura(medida.lectura);
  assert.ok(final.escena.nodos.length > 5);
  assert.ok(medida.lectura.escala.altoImagenCm >= 255 && medida.lectura.escala.altoImagenCm <= 345, `${medida.lectura.escala.altoImagenCm} cm: ${medida.notas.filter((n) => /Escala/.test(n)).join(" | ")}`);
  // Los globos de la guirnalda forman tres tamaños (≈ 5, 9 y 12 % del alto), no unos chicos partidos en dos y medianos y grandes juntos.
  const guirnalda = cruda.piezas.find((p) => p.tipo === "guirnalda_organica")!;
  const t = medirTamanos(guirnalda.mezcla, globosDe(detecciones, cruda.aspecto).filter((g) => g.y < 0.75), cruda.pisoY, true);
  assert.ok(Math.abs(t.reparto.medianos - 55) <= 12 && t.reparto.chicos < 35, JSON.stringify(t.reparto));
  assert.deepEqual(t.escalones, ["chicos", "medianos", "grandes"]);
  assert.ok(t.escalaCm! > 230 && t.escalaCm! < 320, `${t.escalaCm}`);
});

prueba("9 · la k-medias no mueve lo que ya medía bien: con tres modos separados da los mismos centros que el arranque de siempre", () => {
  const modos = [...Array.from({ length: 20 }, (_, i) => Math.log(0.05 + i * 0.0005)), ...Array.from({ length: 20 }, (_, i) => Math.log(0.1 + i * 0.0007)), ...Array.from({ length: 8 }, (_, i) => Math.log(0.17 + i * 0.001))];
  const c = kMedias1D(modos, 3).map((x) => Math.exp(x));
  assert.ok(Math.abs(c[0]! - 0.055) < 0.006 && Math.abs(c[1]! - 0.107) < 0.006 && Math.abs(c[2]! - 0.1735) < 0.006, c.map((x) => x.toFixed(3)).join(" "));
  // El caso partido de la foto del cumpleaños (dos chicos al lado de nueve un poco mayores): se rehace con el otro arranque.
  const logs = globosDe(detecciones, cruda.aspecto).filter((g) => g.y < 0.75).map((g) => Math.log(g.d));
  const centros = kMedias1D(logs, 3).map((x) => Math.exp(x));
  assert.ok(centros[1]! > 0.07 && centros[0]! < 0.07, centros.map((x) => x.toFixed(3)).join(" "));
});

prueba("9 · solo las mesas que el lector confirmó, de altura conocida y con la caja entera dan escala; pasteles, cortina, rótulo y corazones no la mueven", () => {
  // La caja de la mesa de esta foto llega a 0,981 (toca el borde de abajo): no se fía.
  assert.equal(escalaPorMesas(fondos, cruda.piezas, cruda.aspecto), null, "la mesa de esta foto sale cortada por abajo");
  const mesaEntera: FondoDetectado = { box_2d: [650, 307, 940, 709], id: "mesa_postres" };
  const leidaEntera = lectura([fondoDe("mesa_postres", { x: 0.51, yBase: 0.94, ancho: 0.4, alto: 0.29 })]).piezas;
  assert.ok(Math.abs(escalaPorMesas([mesaEntera], leidaEntera, 1)! - 90 / 0.29) < 1, "una caja entera da 90 cm / su alto");
  assert.equal(escalaPorMesas([mesaEntera], lectura([fondoDe("mesa_coctel", { x: 0.51, yBase: 0.94, ancho: 0.4, alto: 0.29 })]).piezas, 1), null, "una mesa de cóctel que la detección llamó «de postres» no mueve la escala");
  assert.equal(escalaPorMesas([mesaEntera], lectura([fondoDe("pastel")]).piezas, 1), null, "sin la mesa leída no hay escala");
  assert.equal(escalaPorMesas([{ ...mesaEntera, box_2d: [650, 307, 985, 709] }], leidaEntera, 1), null, "una caja que toca el borde de abajo no vale");
  assert.equal(escalaPorMesas([{ ...mesaEntera, box_2d: [100, 800, 300, 950] }], leidaEntera, 1), null, "una caja que no cae sobre lo leído no vale");
  const sinMesa = fondos.filter((f) => f.id !== "mesa_postres");
  assert.equal(escalaPorMesas(sinMesa, cruda.piezas, cruda.aspecto), null, "sin la mesa no hay escala por muebles");
  const solo = medirConDetecciones(cruda, detecciones, fondos.filter((f) => f.id === "mesa_postres"));
  assert.equal(solo.lectura.escala.altoImagenCm, medida.lectura.escala.altoImagenCm, "la escala es la misma con o sin pasteles, cortina y rótulo detectados");
  const enormes: FondoDetectado[] = [...fondos, { box_2d: [100, 100, 150, 200], id: "pastel" }, { box_2d: [10, 10, 990, 990], id: "cortina_luces" }];
  assert.equal(medirConDetecciones(cruda, detecciones, enormes).lectura.escala.altoImagenCm, medida.lectura.escala.altoImagenCm);
});

prueba("9 · globos y mesa: de acuerdo valen los dos; si no, manda la mediana con la del lector (un fallo no manda)", () => {
  assert.equal(Math.round(escalaReconciliada(251, 318, 260)), 283);
  assert.equal(escalaReconciliada(472, 318, 260), 318, "los globos a 472 (grupos mal puestos) pierden contra la mesa y el lector");
  assert.equal(escalaReconciliada(251, null, 260), 251, "sin mesa, los globos como siempre");
});

// ---------------------------------------------------------------------------------------------------------- 10
const GUIRNALDA_ARCO = medidaDelRegistro.piezas.find((p) => p.tipo === "guirnalda_organica")!;
const letrasDeFoil = (texto = "Happy Birthday"): PiezaLeida => ({ tipo: "metalizado", texto, cursiva: false, x: 0.5, y: 0.46, alto: 0.1, colores: [color("Reflex Dorado", "#d8b668", 100, "cromado")] });

prueba("10 · las letras de foil de un rótulo van delante de los globos del arco que las tapan, todas a la misma profundidad", () => {
  const c = compilarLectura(lectura([GUIRNALDA_ARCO, letrasDeFoil()]));
  const letras = c.escena.nodos.filter((n) => n.id.startsWith("metalizado"));
  assert.equal(letras.length, 2, "Happy y Birthday");
  const armada = armarEscena(c.escena);
  const globos = armada.porNodo.find((n) => n.id === "guirnalda-organica")!.globos.map((g) => ({ c: centroDe(g), r: g.infladoCm / 2 }));
  const cajas = letras.map((n) => armada.porNodo.find((x) => x.id === n.id)!.caja);
  for (const caja of cajas) {
    const tapan = globos.filter((g) => g.c.x + g.r > caja.min.x && g.c.x - g.r < caja.max.x && g.c.y + g.r > caja.min.y && g.c.y - g.r < caja.max.y);
    assert.ok(Math.max(...tapan.map((g) => g.c.z + g.r)) <= caja.min.z + 0.6, `las letras (z desde ${caja.min.z}) quedan delante de los globos que las cruzan`);
  }
  assert.ok(Math.abs(cajas[0]!.min.z - cajas[1]!.min.z) < 1, "la misma profundidad");
  assert.ok(c.notas.some((n) => /va delante de ellos/.test(n)), c.notas.join(" | "));
  // Y sin globos detrás (un rótulo suelto) no se mueve nada.
  const sola = compilarLectura(lectura([letrasDeFoil()]));
  assert.ok(!sola.notas.some((n) => /va delante de ellos/.test(n)));
});

prueba("10 · un rótulo de foil que cabe entre los brazos del arco queda dentro de su abertura", () => {
  const c = compilarLectura(lectura([GUIRNALDA_ARCO, letrasDeFoil("Hola")]));
  const armada = armarEscena(c.escena);
  const globos = armada.porNodo.find((n) => n.id === "guirnalda-organica")!.globos.map((g) => ({ c: centroDe(g), r: g.infladoCm / 2 }));
  const caja = armada.porNodo.find((n) => n.id.startsWith("metalizado"))!.caja;
  const banda = globos.filter((g) => g.c.y + g.r > caja.min.y && g.c.y - g.r < caja.max.y);
  const izq = banda.filter((g) => g.c.x < (caja.min.x + caja.max.x) / 2), der = banda.filter((g) => g.c.x >= (caja.min.x + caja.max.x) / 2);
  assert.ok(caja.min.x >= Math.max(...izq.map((g) => g.c.x + g.r)) - 0.6 || izq.length === 0, "no pisa el brazo izquierdo");
  assert.ok(caja.max.x <= Math.min(...der.map((g) => g.c.x - g.r)) + 0.6 || der.length === 0, "no pisa el brazo derecho");
});

prueba("10 · un «Happy Birthday» leído como nombre de acrílico (cursiva) o neón sigue en cursiva: no se vuelve letras de foil", () => {
  for (const id of ["rotulo_acrilico", "neon_cursiva"]) {
    const c = compilarLectura(lectura([GUIRNALDA_ARCO, fondoDe(id, { texto: "Happy Birthday", x: 0.5, yBase: 0.5, ancho: 0.44, alto: 0.12, colores: [color("Reflex Dorado", "#d8b668", 100, "cromado")] })]));
    assert.ok(!c.escena.nodos.some((n) => n.pieza.tipo === "metalizado"), `${id}: sin letras de foil`);
    const n = c.escena.nodos.find((x) => x.pieza.tipo === "escenografia" && x.pieza.mueble?.id === id)!;
    assert.equal(n.pieza.tipo === "escenografia" ? n.pieza.mueble?.opciones?.texto : "", "Happy Birthday");
    const armada = armarEscena(c.escena);
    const letrero = armada.porNodo.find((x) => x.id === n.id)!;
    assert.ok(letrero.solidos.some((s) => s.motivo?.texto === "Happy Birthday" || s.rotulo?.texto === "Happy Birthday"), `${id}: el texto en cursiva sigue en el sólido`);
  }
});

// ---------------------------------------------------------------------------------------------------------- 11
prueba("11 · el corazón C-12 queda atestiguado en todos los colores (decisión del dueño); lo que la tienda no vende como corazón sale «sin cobertura»", () => {
  assert.equal(coloresDelFormato("C-12").length, TABLA_SEMPERTEX.referencias.length, "todos los colores de la paleta");
  assert.ok(COLORES_ATESTIGUADOS["C-12"]!.every((c) => /dueño 2026-10-09: todos los colores, un tamaño/.test(c.fuente)));
  assert.equal(COLORES_ATESTIGUADOS["C-12"]!.length, TABLA_SEMPERTEX.referencias.length);
  const noVendido = TABLA_SEMPERTEX.referencias.find((r) => !colorSeVendeEnFormato("C-12", r.codigo))!;
  const vendido = TABLA_SEMPERTEX.referencias.find((r) => colorSeVendeEnFormato("C-12", r.codigo))!;
  assert.ok(!colorSeVendeEnFormato("C-12", noVendido.codigo) && colorSeVendeEnFormato("C-12", vendido.codigo));
  const lista = [{ formatoId: "C-12", codigo: noVendido.codigo, cantidad: 2 }, { formatoId: "C-12", codigo: vendido.codigo, cantidad: 1 }, { formatoId: "R-12", codigo: noVendido.codigo, cantidad: 9 }, { formatoId: "C-6", codigo: "012", cantidad: 1 }];
  assert.deepEqual(corazonesSinCobertura(lista).map((m) => m.codigo), [noVendido.codigo], "solo el corazón C-12 en un color que no se vende así");
  // Y la lista de compra de la escena de dos corazones en un color que la tienda no vende como corazón lo trae.
  const c = compilarLectura(lectura([corazon(2, [color(noVendido.nombreCompleto, noVendido.hexGlobo, 100, "mate")])]));
  assert.equal(corazonesSinCobertura(armarEscena(c.escena).materiales).reduce((s, m) => s + m.cantidad, 0), 2);
});

prueba("11 · lo que la tienda vende como Corazón 12 coincide con el cruce incluido del catálogo (ni de más ni de menos)", () => {
  const archivo = readdirSync("data/motor").find((f) => /^crosswalk-.*\.json$/.test(f));
  assert.ok(archivo, "falta el cruce incluido en data/motor");
  const cruce = JSON.parse(readFileSync(`data/motor/${archivo}`, "utf8")) as Crosswalk;
  const conVariante = Object.keys(cruce.entradas).filter((k) => k.startsWith("C-12|")).map((k) => k.slice(5));
  for (const codigo of conVariante) assert.ok(colorSeVendeEnFormato("C-12", codigo), `C-12 ${codigo} tiene variante en la tienda`);
  const declarados = TABLA_SEMPERTEX.referencias.filter((r) => colorSeVendeEnFormato("C-12", r.codigo)).map((r) => r.codigo);
  for (const codigo of declarados) assert.ok(conVariante.includes(codigo) || `C-12|${codigo}` in cruce.sinCobertura, `C-12 ${codigo} está en el cruce`);
});

prueba("11 · en el cruce de la guiada, un corazón en un color que no se vende dice «el corazón en ese color no se vende», no «desconocida»", () => {
  const cruce: Crosswalk = { version: 1, snapshot: "prueba", entradas: {}, sinCobertura: {} };
  const noVendido = TABLA_SEMPERTEX.referencias.find((r) => !colorSeVendeEnFormato("C-12", r.codigo))!;
  assert.deepEqual(presentaciones(cruce, "C-12", noVendido.codigo), { ok: false, motivo: "corazon_color_no_vendido" });
  assert.deepEqual(presentaciones(cruce, "R-12", noVendido.codigo), { ok: false, motivo: "desconocida" }, "lo que no es corazón sigue como antes");
  const plan = planearCompra([{ formatoId: "C-12", codigo: noVendido.codigo, cantidad: 3 }], cruce);
  assert.deepEqual(!plan.ok ? plan.faltantes : null, [{ formatoId: "C-12", codigo: noVendido.codigo, motivo: "corazon_color_no_vendido" }]);
});

// ---------------------------------------------------------------------------------------------------------- 12
prueba("12 · un neón colgado de la pared delante de una cortina de flecos queda delante de las tiras", () => {
  const c = compilarLectura(lectura([
    fondoDe("cortina_flecos", { x: 0.5, yBase: 0.92, ancho: 0.6, alto: 0.7, colores: [color("plata", "#c9cfd0", 100, "cromado")] }),
    fondoDe("neon_cursiva", { texto: "Happy Birthday", x: 0.5, yBase: 0.55, ancho: 0.3, alto: 0.1, colores: [color("blanco", "#ffffff", 100)] }),
  ]));
  const cortina = armarEscena(c.escena).porNodo.find((n) => n.id === "cortina-flecos")!;
  const neon = nodo(c.escena, "neon-cursiva");
  const caja = cajaDe(c.escena, "neon-cursiva");
  assert.equal(neon.colocacion.en, "libre", "pasó de la pared a suelto, delante");
  assert.ok(caja.min.z >= cortina.caja.max.z, `el neón (z desde ${caja.min.z}) está delante de las tiras (hasta ${cortina.caja.max.z})`);
  assert.equal(nodo(c.escena, "cortina-flecos").colocacion.en, "pared", "la cortina se queda en la pared");
  assert.ok(c.notas.some((n) => /Letrero de neón.*delante del panel/.test(n)), c.notas.join(" | "));
  // Un letrero colgado SOLO (sin cortina) no se mueve.
  const sola = compilarLectura(lectura([fondoDe("neon_cursiva", { texto: "Hola", x: 0.5, yBase: 0.55, ancho: 0.3, alto: 0.1 })]));
  assert.equal(nodo(sola.escena, "neon-cursiva").colocacion.en, "pared");
});

// ---------------------------------------------------------------------------------------------------------- 13
prueba("13 · el pastel solo se crea con una mesa debajo (en x y a la altura de su tapa); si no, queda en lo no armado con su motivo", () => {
  const mesa = medidaDelRegistro.piezas.find((p) => p.tipo === "fondo" && p.id === "mesa_postres")!;
  const flotando: FondoDetectado[] = [{ box_2d: [100, 100, 240, 200], id: "base_pastel" }, { box_2d: [525, 458, 663, 552], id: "base_pastel" }];
  const m = medirConDetecciones(lectura([mesa, guirnaldaDelRegistro]), detecciones, [fondos.find((f) => f.id === "mesa_postres")!, ...flotando]);
  const pasteles = m.lectura.piezas.filter((p) => p.tipo === "fondo" && p.id === "pastel");
  assert.equal(pasteles.length, 1, "solo el que está sobre la mesa");
  const otros = m.lectura.piezas.filter((p) => p.tipo === "otro");
  assert.ok(otros.some((o) => o.tipo === "otro" && /pastel.*sin una mesa debajo/.test(o.descripcion)), JSON.stringify(otros));
  assert.ok(compilarLectura(m.lectura).omitidas.some((o) => /pastel.*sin una mesa debajo/.test(o)));
  // Una mesa a otro lado (el pastel cae fuera de su tapa en x) tampoco lo recibe.
  const lejos = medirConDetecciones(lectura([{ ...mesa, x: 0.12, ancho: 0.15 } as PiezaLeida, guirnaldaDelRegistro]), detecciones, [{ box_2d: [525, 458, 663, 552], id: "base_pastel" }]);
  assert.ok(!lejos.lectura.piezas.some((p) => p.tipo === "fondo" && p.id === "pastel"));
});

prueba("13 · los pasteles que ya están sobre la tapa cuentan: dos juntos no se encaraman (se corre uno o se omite) y el color es el de catálogo, dicho como tal", () => {
  const mesa = fondoDe("mesa_postres", { x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.28 });
  const pastel = (x: number) => fondoDe("pastel", { x, yBase: 0.64, ancho: 0.09, alto: 0.13 });
  const c = compilarLectura(lectura([mesa, pastel(0.5), pastel(0.51), pastel(0.52)], { aspecto: 1 }));
  const pasteles = c.escena.nodos.filter((n) => n.id.startsWith("pastel"));
  assert.ok(pasteles.length >= 2 && pasteles.length <= 3, `${pasteles.length} pasteles`);
  for (let i = 0; i < pasteles.length; i++) for (let j = i + 1; j < pasteles.length; j++) {
    const a = cajaDe(c.escena, pasteles[i]!.id), b = cajaDe(c.escena, pasteles[j]!.id);
    assert.ok(a.max.x <= b.min.x + 0.5 || b.max.x <= a.min.x + 0.5, `${pasteles[i]!.id} y ${pasteles[j]!.id} no se solapan en x`);
  }
  if (pasteles.length < 3) assert.ok(c.omitidas.some((o) => /no cabe.*sin encimarse/.test(o)), c.omitidas.join(" | "));
  // El color de un pastel detectado sin leer es el de catálogo y la lectura lo dice así.
  const sin = medida.lectura.piezas.find((p) => p.tipo === "fondo" && p.id === "pastel")!;
  assert.ok(sin.tipo === "fondo" && /catálogo/.test(sin.colores[0]!.nombre) && /color es el de catálogo/.test(sin.nota ?? ""), JSON.stringify(sin));
  assert.ok(!sin.tipo || sin.tipo !== "fondo" || sin.colores[0]!.nombre.toLowerCase() !== "marfil");
});

// ---------------------------------------------------------------------------------------------------------- 14
prueba("14 · lo omitido por fallar una decoración entra en lo no armado (omitidas), de donde sale el resumen de la persona", () => {
  const notas: string[] = [], omitidas: string[] = [];
  conNotaSiFalla("Pieza 3 (panel_redondo): el rótulo «Ñ»", notas, omitidas, () => { throw new Error("letra no admitida"); }, null);
  assert.equal(omitidas.length, 1);
  assert.match(omitidas[0]!, /Pieza 3.*rótulo.*letra no admitida/);
  assert.deepEqual(compilarLectura(medidaDelRegistro).decoracionesOmitidas, [], "sin fallos, no hay nada que decir");
});

console.log(`test-foto-cumple: ${pruebas} pruebas ok, ${fallos} con fallas`);
if (fallos) process.exit(1);
