/**
 * Guía de escena (`GUIA_ESCENA_V1`). Determinista y sin red: Python y fal se sustituyen con dobles de `fetch`.
 *
 * - La composición: cada instancia cae dentro de la caja de su elemento en la foto; una pieza repetida toma las
 *   cajas de la foto de izquierda a derecha y la derecha va en espejo; sin elemento en la foto, la caja del plan.
 * - El SVG: determinista, solo un fondo, una franja de piso y círculos lisos con un borde fino de su tono (sin
 *   texto, sin degradados, sin silueta ni marcas); el PNG mide el encuadre de salida.
 * - Los colores claros: el relleno queda intacto, el borde es más oscuro, de su tono y contrasta ≥ 1,5 (WCAG) con
 *   el fondo y el piso; con blancos el fondo baja a un gris neutro medio.
 * - El anclaje: una pieza `flotante` (bouquet de helio) queda `elevacion_m` sobre el fondo de su caja, dentro de
 *   ella y sin tocar la franja de piso; el `anclaje` de Python manda sobre la ubicación del plan.
 * - Los datos de cada pieza para Python: líneas del catálogo, leyenda del bouquet y proporción de la caja de la foto.
 * - El adaptador de Python: la operación, el scope y la validación de la respuesta.
 * - El camino de `/api/generate` (caso de uso `guiaEscenaParaGeneracion` + `generarConSempertexLora`): `/edit`
 *   recibe EXACTAMENTE una imagen, la guía, y ningún byte de la foto de referencia; el caption va primero y la nota
 *   después; si la guía no se puede construir, se genera sin ella y el resumen lo dice.
 * - Las banderas: `GUIA_ESCENA_V1` encendida por defecto y `REFERENCIA_EN_ETAPA1_V1` apagada.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-guia-escena.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { ANALISIS_EJEMPLOS } from "@/lib/ia/amaterasu/analisis-ejemplos";
import { FONDO_GUIA, PISO_GUIA, tamanoGuia } from "@/lib/ia/kagutsuchi/guia-estructura";
import { contrasteWcag, encaje, generacionAdmiteGuiaEscena, instanciasDeEscena, lDeHex, planConReferencia, svgGuiaEscena, type InstanciaGuia } from "@/lib/ia/kagutsuchi/guia-escena";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { LORA_PROMPT_MAX_LENGTH } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks, findLoraPromptProductLeaks, preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { datosDePiezas, guiaEscenaParaGeneracion, prepararGuiaEscena } from "@/lib/ia/kagutsuchi/preparar-guia-escena";
import { buildLoraEditPrompt, generarConSempertexLora, imageSizeFor, NOTA_GUIA_ESCENA, NOTA_GUIA_ESCENA_SIN_ESTRUCTURA, notaGuiaEscena, reservaNotaGuiaEscena, type ImagenGuiaLora } from "@/lib/ia/kagutsuchi/sempertex-lora";
import { featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { llamarPythonPlanGuiaEscena, PYTHON_PLAN_GUIA_ESCENA_PATH, PYTHON_PLAN_GUIA_ESCENA_SCOPE } from "@/lib/ia/nucleo/python-adapter";
import { PlanGuiaEscenaResultV1Schema, type PiezaGuiaEscena, type PlanGuiaEscenaResultV1 } from "@/lib/plan/guia-escena";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { capturarPeticion, imagenDePrueba, LORA_DE_PRUEBA } from "../lib/capturar-peticion-lora";
import { captionDeCaso, casoArcoPatron } from "../lib/escenas-guia-estructura";

configurarPersistenciaTelemetria(undefined);

const EDIT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const TAMANO = tamanoGuia(imageSizeFor("3:2"));
const EJEMPLO_01 = ANALISIS_EJEMPLOS.ejemplos.find((ejemplo) => ejemplo.id === "ejemplo-01")!.resultado.blueprint;
const IZQUIERDA = "REF_01_E02";
const DERECHA = "REF_01_E03";

type EstructuraPlan = PlanResuelto["plan"]["estructuras"][number];

/** Una pieza alta y estrecha (una columna), asimétrica a propósito para que se note el espejo: más masa a la derecha. */
function columna(estructuraId: string, hex = "#f2b6c8"): PiezaGuiaEscena {
  const discos = [
    { x_m: -0.2, y_m: 0.2, r_m: 0.2, hex },
    { x_m: 0.1, y_m: 0.6, r_m: 0.2, hex },
    { x_m: 0.2, y_m: 1.4, r_m: 0.2, hex: "#c0c0c0" },
    { x_m: 0.2, y_m: 2.0, r_m: 0.2, hex },
  ];
  return { estructura_id: estructuraId, fuente: "motor", ancho_m: 0.8, alto_m: 2.2, discos };
}

/** Una estructura del plan con lo que la guía lee de ella. */
function estructura(estructuraId: string, extra: Partial<EstructuraPlan> = {}): EstructuraPlan {
  const base = casoArcoPatron().plan.plan.estructuras[0]!;
  return { ...base, estructura_id: estructuraId, tipo: "columna", ubicacion: "lateral_izquierdo", repeticiones: 1, ...extra } as EstructuraPlan;
}

type Circulo = { cx: number; cy: number; r: number; fill: string; stroke: string; ancho: number };

/** Cada disco con su borde; `r` es el radio exterior (el trazo va por dentro). Falla si algún círculo no lleva borde. */
function circulos(svg: string): Circulo[] {
  const todos = svg.match(/<circle /g)?.length ?? 0;
  const leidos = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)" fill="(#[0-9a-f]{6})" stroke="(#[0-9a-f]{6})" stroke-width="([\d.]+)"\/>/g)].map((m) => ({
    cx: Number(m[1]),
    cy: Number(m[2]),
    r: Number(m[3]) + Number(m[6]) / 2,
    fill: m[4]!,
    stroke: m[5]!,
    ancho: Number(m[6]),
  }));
  assert.equal(leidos.length, todos, "todos los discos llevan relleno y borde");
  return leidos;
}

function fondoDe(svg: string): { fondo: string; piso: string } {
  const rects = [...svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"\/>/g)].map((m) => m[1]!);
  assert.equal(rects.length, 2, "un fondo y un piso");
  return { fondo: rects[0]!, piso: rects[1]! };
}

/** Tono (grados) y croma en CIELAB. */
function tonoYCroma(hex: string): { tono: number; croma: number } {
  const entero = Number.parseInt(hex.slice(1), 16);
  const [, a, b] = labDeRgb((entero >> 16) & 255, (entero >> 8) & 255, entero & 255);
  return { tono: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, croma: Math.hypot(a, b) };
}

/**
 * Lo que hace separable a cada disco sin tocar su color: el relleno es el hex de Python tal cual, el borde existe,
 * es de la misma familia de tono, más oscuro que el relleno (más claro solo en los casi negros) y contrasta ≥ 1,5
 * (WCAG) con el fondo y con el piso de la escena.
 */
function bordesSeparables(svg: string, rellenos: ReadonlySet<string>): void {
  const escena = fondoDe(svg);
  const discos = circulos(svg);
  assert.ok(discos.length > 0);
  for (const disco of discos) {
    assert.ok(rellenos.has(disco.fill), `relleno ${disco.fill} intacto`);
    assert.ok(disco.ancho > 0 && disco.ancho <= disco.r * 0.3 + 0.01, `borde de ${disco.fill} con grosor ${disco.ancho}`);
    assert.notEqual(disco.stroke, disco.fill);
    const lRelleno = lDeHex(disco.fill);
    const lBorde = lDeHex(disco.stroke);
    if (lRelleno >= 28) assert.ok(lBorde < lRelleno - 5, `el borde de ${disco.fill} (${disco.stroke}) es más oscuro`);
    else assert.ok(lBorde > lRelleno + 5, `el borde del casi negro ${disco.fill} (${disco.stroke}) es más claro`);
    const relleno = tonoYCroma(disco.fill);
    const borde = tonoYCroma(disco.stroke);
    if (relleno.croma >= 10) {
      const diferencia = Math.abs(((relleno.tono - borde.tono + 540) % 360) - 180);
      assert.ok(diferencia <= 20, `el borde de ${disco.fill} (${disco.stroke}) es de su tono: ${diferencia.toFixed(1)}°`);
    } else {
      assert.ok(borde.croma < 10, `el borde del neutro ${disco.fill} (${disco.stroke}) es neutro`);
    }
    assert.ok(contrasteWcag(disco.stroke, escena.fondo) >= 1.5, `borde ${disco.stroke} contra el fondo ${escena.fondo}: ${contrasteWcag(disco.stroke, escena.fondo).toFixed(2)}`);
    assert.ok(contrasteWcag(disco.stroke, escena.piso) >= 1.5, `borde ${disco.stroke} contra el piso ${escena.piso}`);
  }
}

function dentroDeCaja(svg: string, caja: InstanciaGuia["caja"], hex: string): void {
  const tolerancia = 1.5;
  const propios = circulos(svg).filter((circulo) => circulo.fill === hex);
  assert.ok(propios.length > 0, `no hay círculos ${hex}`);
  for (const circulo of propios) {
    assert.ok(circulo.cx - circulo.r >= caja.x * TAMANO.ancho - tolerancia && circulo.cx + circulo.r <= (caja.x + caja.width) * TAMANO.ancho + tolerancia, `círculo ${JSON.stringify(circulo)} fuera de la caja en x`);
    assert.ok(circulo.cy - circulo.r >= caja.y * TAMANO.alto - tolerancia && circulo.cy + circulo.r <= (caja.y + caja.height) * TAMANO.alto + tolerancia, `círculo ${JSON.stringify(circulo)} fuera de la caja en y`);
  }
}

function testComposicion(): void {
  // Dos columnas que la foto tiene a los lados de la mesa: una estructura repetida dos veces que materializa la izquierda.
  const pareja = [estructura("EST_01_COLUMNAS", { repeticiones: 2, referencia_element_id: IZQUIERDA })];
  const instancias = instanciasDeEscena(pareja, EJEMPLO_01);
  const izquierda = EJEMPLO_01.elements.find((elemento) => elemento.element_id === IZQUIERDA)!.reference_bbox;
  const derecha = EJEMPLO_01.elements.find((elemento) => elemento.element_id === DERECHA)!.reference_bbox;
  assert.deepEqual(instancias.map((instancia) => [instancia.instancia, instancia.caja, instancia.fuente, instancia.espejo]), [[1, izquierda, "foto", false], [2, derecha, "foto", true]]);
  assert.ok(instancias.every((instancia) => instancia.apoyo === "piso"));
  console.log("[PASS] una pieza repetida toma las dos cajas de la foto, izquierda y derecha, y la derecha va en espejo");

  // Cada instancia en su caja: dos colores distintos para poder separarlas en el SVG.
  const unaPorLado = [estructura("EST_01_IZQ", { referencia_element_id: IZQUIERDA }), estructura("EST_02_DER", { ubicacion: "lateral_derecho", referencia_element_id: DERECHA })];
  const porLado = instanciasDeEscena(unaPorLado, EJEMPLO_01);
  const svgLados = svgGuiaEscena([columna("EST_01_IZQ", "#f2b6c8"), columna("EST_02_DER", "#9ec5e8")], porLado, TAMANO);
  dentroDeCaja(svgLados, izquierda, "#f2b6c8");
  dentroDeCaja(svgLados, derecha, "#9ec5e8");
  console.log("[PASS] cada pieza se dibuja dentro de la caja de su elemento en la foto");

  // El espejo: en la pareja, la masa de la izquierda queda a la derecha en la copia de la izquierda y al revés.
  const svgPareja = svgGuiaEscena([columna("EST_01_COLUMNAS")], instancias, TAMANO);
  const plateados = circulos(svgPareja).filter((circulo) => circulo.fill === "#c0c0c0").sort((a, b) => a.cx - b.cx);
  const centroIzq = (izquierda.x + izquierda.width / 2) * TAMANO.ancho;
  const centroDer = (derecha.x + derecha.width / 2) * TAMANO.ancho;
  assert.equal(plateados.length, 2);
  assert.ok(plateados[0]!.cx > centroIzq, "la columna izquierda conserva su lado");
  assert.ok(plateados[1]!.cx < centroDer, "la columna derecha va en espejo");
  console.log("[PASS] la copia derecha de una pieza repetida es su espejo");

  // Determinista y plano: el único trazo es el borde liso de cada disco.
  assert.equal(svgGuiaEscena([columna("EST_01_COLUMNAS")], instancias, TAMANO), svgPareja, "el mismo plan da el mismo SVG");
  assert.doesNotMatch(svgPareja, /<text|<tspan|Gradient|url\(#|<path|<line|<polyline|<g[ >]|<image|filter|opacity|stroke-dasharray|stroke-opacity/i);
  const etiquetas = new Set([...svgPareja.matchAll(/<([a-z]+)[ >]/g)].map((m) => m[1]));
  assert.deepEqual([...etiquetas].sort(), ["circle", "rect", "svg"]);
  assert.equal(svgPareja.match(/stroke=/g)?.length, circulos(svgPareja).length, "solo los discos llevan trazo");
  assert.deepEqual(fondoDe(svgPareja), { fondo: FONDO_GUIA, piso: PISO_GUIA }, "sin discos claros, el fondo de siempre");
  bordesSeparables(svgPareja, new Set(["#f2b6c8", "#c0c0c0"]));
  console.log("[PASS] SVG determinista: fondo, piso y círculos lisos con su borde; sin texto, degradados ni silueta");

  // Los colores claros: el relleno queda intacto (un blanco es #ffffff), cada disco lleva un borde de su tono,
  // más oscuro, que contrasta con el fondo; y el fondo baja a un gris neutro que separa también los rellenos.
  const claros = ["#ffffff", "#fff8e7", "#f4f4f4", "#e6cfd6", "#a3d1ed", "#c0c0c0", "#ffd700", "#1a237e", "#000000"];
  const paleta = (hexes: readonly string[]): PiezaGuiaEscena => ({
    estructura_id: "EST_01_COLUMNAS",
    fuente: "motor",
    ancho_m: 0.8,
    alto_m: 0.4 * hexes.length,
    discos: hexes.map((hex, indice) => ({ x_m: 0, y_m: 0.2 + 0.4 * indice, r_m: 0.2, hex })),
  });
  for (const escena of [claros, ["#ffffff"], ["#ffffff", "#c0c0c0"], ["#fff8e7", "#e6cfd6", "#a3d1ed"]]) {
    const svg = svgGuiaEscena([paleta(escena)], instancias, TAMANO);
    bordesSeparables(svg, new Set(escena));
    const { fondo } = fondoDe(svg);
    assert.notEqual(fondo, FONDO_GUIA, `con ${escena.join(",")} el fondo deja de ser el casi blanco`);
    assert.ok(tonoYCroma(fondo).croma < 2, `el fondo ${fondo} es neutro`);
    assert.ok(lDeHex(fondo) >= 69, `el fondo ${fondo} es un tono medio, no oscuro`);
    assert.ok(contrasteWcag("#ffffff", fondo) > contrasteWcag("#ffffff", FONDO_GUIA), "un blanco se separa del fondo mejor que antes");
    assert.equal(svgGuiaEscena([paleta(escena)], instancias, TAMANO), svg, "el fondo y los bordes son deterministas");
  }
  assert.ok(circulos(svgGuiaEscena([paleta(["#ffffff"])], instancias, TAMANO)).every((disco) => disco.fill === "#ffffff"), "un blanco se dibuja #ffffff");
  // El fondo sale de los colores, no del orden ni de la cantidad de discos.
  const fondoA = fondoDe(svgGuiaEscena([paleta(["#ffffff", "#c0c0c0"])], instancias, TAMANO)).fondo;
  const fondoB = fondoDe(svgGuiaEscena([paleta(["#c0c0c0", "#ffffff", "#c0c0c0"])], instancias, TAMANO)).fondo;
  assert.equal(fondoA, fondoB);
  console.log("[PASS] colores claros: relleno intacto, borde de su tono más oscuro con contraste ≥ 1,5 y fondo neutro medio");

  // Sin elemento en la foto (o sin foto), la caja sale de la geometría del plan.
  const sinFoto = instanciasDeEscena([estructura("EST_03_ARCO", { tipo: "arco", ubicacion: "fondo_pared", referencia_element_id: "REF_NO_EXISTE" })], EJEMPLO_01);
  assert.equal(sinFoto.length, 1);
  assert.equal(sinFoto[0]!.fuente, "plan");
  console.log("[PASS] sin elemento en la foto, la caja es la del plan");

  // Colgada del techo: arriba en su caja.
  const techo = instanciasDeEscena([estructura("EST_04_TECHO", { tipo: "guirnalda", ubicacion: "techo" })], undefined);
  assert.equal(techo[0]!.apoyo, "techo");
  const svgTecho = svgGuiaEscena([columna("EST_04_TECHO")], techo, TAMANO);
  const arriba = Math.min(...circulos(svgTecho).map((circulo) => circulo.cy - circulo.r));
  assert.ok(Math.abs(arriba - techo[0]!.caja.y * TAMANO.alto) < 1.5, "una pieza del techo cuelga desde arriba de su caja");
  console.log("[PASS] una pieza del techo se alinea arriba");

  assert.throws(() => svgGuiaEscena([{ ...columna("EST_01_COLUMNAS"), discos: [{ x_m: 0, y_m: 0.2, r_m: 0.2, hex: "red" }] }], instancias, TAMANO), /GUIA_ESCENA_INVALIDA/);
  assert.throws(() => svgGuiaEscena([], instancias, TAMANO), /GUIA_ESCENA_INVALIDA/);
  console.log("[PASS] un color fuera de formato o una escena sin piezas fallan cerradas");
}

/** La `y` (px) donde empieza la franja de piso del SVG. */
function pisoDe(svg: string): number {
  const rects = [...svg.matchAll(/<rect x="0" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(rects.length, 2, "un fondo y un piso");
  return rects[1]!;
}

function testAnclaje(): void {
  const caja = EJEMPLO_01.elements.find((elemento) => elemento.element_id === IZQUIERDA)!.reference_bbox;
  const instancias = instanciasDeEscena([estructura("EST_05_BOUQUET", { referencia_element_id: IZQUIERDA })], EJEMPLO_01);
  assert.equal(instancias[0]!.apoyo, "piso", "por la ubicación del plan, de piso");
  const hex = "#e05a8a";
  const ramo: PiezaGuiaEscena = {
    estructura_id: "EST_05_BOUQUET",
    fuente: "dibujo",
    ancho_m: 0.8,
    alto_m: 0.8,
    discos: [
      { x_m: -0.2, y_m: 0.2, r_m: 0.2, hex },
      { x_m: 0.2, y_m: 0.2, r_m: 0.2, hex },
      { x_m: 0, y_m: 0.6, r_m: 0.2, hex },
    ],
  };
  const fondoCaja = (caja.y + caja.height) * TAMANO.alto;

  // Sin anclaje: apoyada en el fondo de su caja, que es el piso.
  const svgDePiso = svgGuiaEscena([ramo], instancias, TAMANO);
  const abajoDePiso = Math.max(...circulos(svgDePiso).map((c) => c.cy + c.r));
  assert.ok(Math.abs(abajoDePiso - fondoCaja) < 1.5, "sin anclaje la pieza toca el fondo de su caja");
  assert.ok(Math.abs(pisoDe(svgDePiso) - fondoCaja) < 1.5, "y la franja de piso empieza ahí");

  // Flotante: los globos quedan a `elevacion_m` sobre el piso, a la escala de la pieza y dentro de su caja.
  const flotante: PiezaGuiaEscena = { ...ramo, anclaje: "flotante", elevacion_m: 1.2 };
  const svgFlotante = svgGuiaEscena([flotante], instancias, TAMANO);
  dentroDeCaja(svgFlotante, caja, hex);
  const piso = pisoDe(svgFlotante);
  const abajo = Math.max(...circulos(svgFlotante).map((c) => c.cy + c.r));
  const { escala } = encaje(flotante, "flotante", { x: caja.x * TAMANO.ancho, y: caja.y * TAMANO.alto, ancho: caja.width * TAMANO.ancho, alto: caja.height * TAMANO.alto });
  assert.ok(Math.abs(piso - fondoCaja) < 1.5, "la pesa de una pieza flotante está en el piso: la franja no se mueve");
  assert.ok(abajo < piso - 10, `el globo más bajo (${abajo.toFixed(1)}) no toca la franja de piso (${piso})`);
  assert.ok(Math.abs(piso - abajo - 1.2 * escala) < 1.5, "la separación es elevacion_m a la escala de la pieza");
  assert.ok(Math.abs((piso - abajo) / (circulos(svgFlotante)[0]!.r * 2) - 1.2 / 0.4) < 0.1, "y guarda la proporción con el tamaño de sus globos");
  console.log("[PASS] una pieza flotante queda elevacion_m sobre el piso, dentro de su caja y sin tocar la franja de piso");

  // El anclaje de Python manda sobre la ubicación del plan.
  const svgTecho = svgGuiaEscena([{ ...ramo, anclaje: "techo" }], instancias, TAMANO);
  const arriba = Math.min(...circulos(svgTecho).map((c) => c.cy - c.r));
  assert.ok(Math.abs(arriba - caja.y * TAMANO.alto) < 1.5, "anclaje techo: arriba de su caja aunque el plan diga piso");
  console.log("[PASS] el anclaje de Python manda sobre la ubicación del plan");

  // El contrato: elevacion_m solo con anclaje flotante.
  const resultado = (pieza: PiezaGuiaEscena) => ({ operation_schema_version: "plan-guia-escena-result.v1", piezas: [pieza], omitidas: [], total_discos: pieza.discos.length });
  assert.equal(PlanGuiaEscenaResultV1Schema.safeParse(resultado(flotante)).success, true);
  assert.equal(PlanGuiaEscenaResultV1Schema.safeParse(resultado({ ...ramo, elevacion_m: 1 })).success, false, "elevacion_m sin anclaje flotante");
  assert.equal(PlanGuiaEscenaResultV1Schema.safeParse(resultado({ ...ramo, anclaje: "colgando" } as unknown as PiezaGuiaEscena)).success, false, "anclaje fuera del enum");
  console.log("[PASS] contrato: anclaje en su enum y elevacion_m solo si flota");
}

function testDatosDePiezas(): void {
  const plan = planDeEjemplo();
  const instancias = instanciasDeEscena(plan.plan.estructuras, EJEMPLO_01);
  const caja = EJEMPLO_01.elements.find((elemento) => elemento.element_id === IZQUIERDA)!.reference_bbox;
  const leyenda = [{ codigo: 1, material: 0, product_id: "p", variant_id: "v", descripcion: "Corazón metalizado 18 in", tipo_globo: "metalizado", color: "dorado", acabado: null, tamano_pulg: 18, digito: null, unidades_por_grupo: 1, unidades_total: 1 }];
  const conLeyenda = { ...plan, armados_bouquet: [{ estructura_id: "EST_01_COLUMNAS", leyenda }] } as unknown as PlanResuelto;
  const [datos] = datosDePiezas(conLeyenda, instancias, TAMANO);
  assert.equal(datos!.estructura_id, "EST_01_COLUMNAS");
  assert.deepEqual(datos!.mezcla_real, plan.estructuras[0]!.mezcla_real);
  assert.equal(datos!.lineas!.length, plan.estructuras[0]!.lineas.length);
  assert.deepEqual(Object.keys(datos!.lineas![0]!).sort(), ["acabado", "color", "diam_pulg", "forma", "product_id", "tamano_codigo", "titulo", "variant_id"]);
  assert.deepEqual(datos!.leyenda, [{ material: 0, tipo_globo: "metalizado", tamano_pulg: 18, digito: null }]);
  assert.ok(Math.abs(datos!.aspecto_caja! - (caja.height * TAMANO.alto) / (caja.width * TAMANO.ancho)) < 1e-9, "alto sobre ancho de la caja de la foto, en píxeles de la guía");
  const sinFoto = datosDePiezas(plan, instanciasDeEscena(plan.plan.estructuras, undefined), TAMANO)[0]!;
  assert.equal(sinFoto.aspecto_caja, undefined, "una caja del plan no dice la forma de la pieza");
  assert.equal(sinFoto.leyenda, undefined);
  console.log("[PASS] datos por pieza: mezcla_real, catálogo de sus líneas, leyenda del bouquet y proporción de la caja de la foto");
}

function testCuandoSeUsa(): void {
  const base = { bandera: true, usarLora: true, hibrido: false, fotoEspacio: false, resultadoPrevio: false, editApagado: false, formatoTexto: true, conReferencia: true };
  assert.equal(generacionAdmiteGuiaEscena(base), true);
  for (const [campo, valor] of [["bandera", false], ["usarLora", false], ["hibrido", true], ["fotoEspacio", true], ["resultadoPrevio", true], ["editApagado", true], ["formatoTexto", false], ["conReferencia", false]] as const) {
    assert.equal(generacionAdmiteGuiaEscena({ ...base, [campo]: valor }), false, campo);
  }
  assert.equal(planConReferencia([estructura("A", { referencia_element_id: IZQUIERDA })]), true);
  assert.equal(planConReferencia([estructura("A")]), false);
  const previaEscena = process.env.GUIA_ESCENA_V1;
  delete process.env.GUIA_ESCENA_V1;
  assert.equal(featureEnabled("GUIA_ESCENA_V1"), true, "GUIA_ESCENA_V1 va encendida por defecto");
  if (previaEscena !== undefined) process.env.GUIA_ESCENA_V1 = previaEscena;
  console.log("[PASS] cuándo se usa: bandera (encendida por defecto), FLUX directo, sin venue ni previo, texto y con foto de referencia");
}

// --- Python ------------------------------------------------------------------------------------

const ENV = { PYTHON_BACKEND_URL: "http://python.test", INTERNAL_HMAC_SECRET: "local-only-secret-0123456789abcdef" };

function respuestaPython(payload: unknown): Response {
  return Response.json({ schema_version: "operational.v1", request_id: "00000000-0000-4000-8000-000000000001", correlation_id: "00000000-0000-4000-8000-000000000002", payload });
}

function resultadoPython(piezas: PiezaGuiaEscena[]): PlanGuiaEscenaResultV1 {
  return PlanGuiaEscenaResultV1Schema.parse({ operation_schema_version: "plan-guia-escena-result.v1", piezas, omitidas: [{ estructura_id: "EST_09_BOUQUET", motivo: "sin_dibujo" }], total_discos: piezas.reduce((suma, pieza) => suma + pieza.discos.length, 0) });
}

function planDeEjemplo(): PlanResuelto {
  const plan = casoArcoPatron().plan;
  const estructuras = [estructura("EST_01_COLUMNAS", { repeticiones: 2, referencia_element_id: IZQUIERDA })];
  return { ...plan, plan: { ...plan.plan, estructuras } as PlanResuelto["plan"], estructuras: [{ ...plan.estructuras[0]!, estructura_id: "EST_01_COLUMNAS", repeticiones: 2 }] };
}

async function testAdaptador(): Promise<void> {
  const llamadas: Array<{ url: string; cuerpo: Record<string, unknown>; scopes: string | null }> = [];
  const plan = planDeEjemplo();
  const fetchImpl: typeof fetch = async (entrada, init) => {
    llamadas.push({ url: String(entrada), cuerpo: JSON.parse(String(init?.body)) as Record<string, unknown>, scopes: new Headers(init?.headers).get("x-internal-scopes") });
    return respuestaPython(resultadoPython([columna("EST_01_COLUMNAS")]));
  };
  const mezclas = datosDePiezas(plan, instanciasDeEscena(plan.plan.estructuras, EJEMPLO_01), TAMANO);
  const { resultado } = await llamarPythonPlanGuiaEscena({ plan: plan.plan, mezclas, requestId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002", env: ENV, fetchImpl });
  assert.equal(resultado.piezas.length, 1);
  assert.equal(new URL(llamadas[0]!.url).pathname, PYTHON_PLAN_GUIA_ESCENA_PATH);
  assert.equal(llamadas[0]!.scopes, PYTHON_PLAN_GUIA_ESCENA_SCOPE);
  assert.equal(llamadas[0]!.cuerpo.schema_version, "plan-guia-escena.v1");
  assert.deepEqual(llamadas[0]!.cuerpo.plan, plan.plan);
  assert.deepEqual(llamadas[0]!.cuerpo.mezclas, JSON.parse(JSON.stringify(mezclas)), "las líneas, la leyenda y la proporción de la caja viajan tal cual");
  assert.ok((mezclas[0]!.lineas?.length ?? 0) > 0 && mezclas[0]!.aspecto_caja !== undefined);
  const invalida: typeof fetch = async () => respuestaPython({ operation_schema_version: "plan-guia-escena-result.v1", piezas: [], omitidas: [], total_discos: 7 });
  await assert.rejects(llamarPythonPlanGuiaEscena({ plan: plan.plan, requestId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002", env: ENV, fetchImpl: invalida }), /PYTHON_INVALID_RESPONSE|inválid|invalid/i);
  console.log("[PASS] adaptador: ruta, scope y cuerpo de plan-guia-escena.v1; una respuesta que no suma sus discos se rechaza");
}

// --- El camino de /api/generate ----------------------------------------------------------------

/** Bytes inconfundibles de la "foto de referencia" del cliente: no pueden aparecer en nada de lo que sale hacia fal. */
const FOTO_REFERENCIA = Buffer.from("FOTO-DEL-CLIENTE-NO-SALE-".repeat(40)).toString("base64");

async function testCaminoDeGeneracion(): Promise<void> {
  const plan = planDeEjemplo();
  const caso = casoArcoPatron();
  const pedidos: unknown[] = [];
  const pedirDiscos = async (planPedido: PlanResuelto["plan"], mezclas: readonly unknown[]) => {
    pedidos.push({ planPedido, mezclas });
    const fetchImpl: typeof fetch = async () => respuestaPython(resultadoPython([columna("EST_01_COLUMNAS")]));
    return (await llamarPythonPlanGuiaEscena({ plan: planPedido, requestId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002", env: ENV, fetchImpl })).resultado;
  };
  const compilar = (maxLength: number) => captionDeCaso(caso, maxLength);
  const cabe = (compilacion: ReturnType<typeof compilar>, imagenes: readonly ImagenGuiaLora[]) => preflightLoraPrompt({
    sceneSpec: caso.escena,
    clauses: compilacion.clauses,
    prompt: buildLoraEditPrompt(compilacion.prompt, imagenes)
}).ok;
  const guia = await guiaEscenaParaGeneracion({ admite: true, plan, foto: EJEMPLO_01, aspecto: "3:2", pedirDiscos, maximo: LORA_PROMPT_MAX_LENGTH, compilar, cabe, largo: (c) => c.prompt.length });
  assert.equal(pedidos.length, 1);
  assert.ok(guia.imagenes && guia.compilacion && guia.resumen);
  assert.deepEqual(guia.resumen, { usada: true, guia_sha256: guia.preparada!.sha256, piezas: 1, discos: 4, omitidas: [{ estructura_id: "EST_09_BOUQUET", motivo: "sin_dibujo" }], cajas_de_la_foto: 2, cajas_del_plan: 0, coste_entradas_extra_usd_estimado: 0.021 });
  assert.equal(guia.imagenes.length, 1);
  assert.equal(guia.imagenes[0]!.role, "scene_guide");
  const png = await sharp(Buffer.from(guia.imagenes[0]!.base64, "base64")).metadata();
  assert.deepEqual([png.width, png.height, png.format], [TAMANO.ancho, TAMANO.alto, "png"]);
  console.log("[PASS] el caso de uso pide los discos una vez, compone la escena y devuelve un PNG del encuadre de salida");

  // Lo que la ruta manda a fal: la guía como ÚNICA imagen de /edit, aunque la petición traiga la foto de referencia.
  const referencia = imagenDePrueba("composition_reference", 2, "REF_01", FOTO_REFERENCIA);
  const producto = imagenDePrueba("catalog_product_reference", 3, "CATALOG_01", Buffer.from("FOTO-DE-PRODUCTO").toString("base64"));
  for (const loras of [[], [LORA_DE_PRUEBA]]) {
    const caption = guia.compilacion.prompt;
    const capturada = await capturarPeticion(generarConSempertexLora, caption, "3:2", [referencia, producto], { loras, seed: 7, imagenesEdit: guia.imagenes });
    const cuerpo = capturada.cuerpo as { prompt: string; image_urls?: string[] };
    assert.equal(capturada.destino, EDIT);
    assert.deepEqual(cuerpo.image_urls, [`data:image/png;base64,${guia.imagenes[0]!.base64}`], "exactamente una imagen: la guía");
    const enviado = JSON.stringify(capturada.cuerpo);
    assert.ok(!enviado.includes(FOTO_REFERENCIA), "ningún byte de la foto de referencia sale hacia fal");
    assert.ok(!enviado.includes(Buffer.from("FOTO-DE-PRODUCTO").toString("base64")));
    // El caption primero y la nota después; la nota es la que corresponde a lo que la guía dibuja.
    const nota = notaGuiaEscena(guia.imagenes![0]!.conEstructura);
    assert.ok(cuerpo.prompt.endsWith(`\n\n${nota}`), "la nota va al final");
    assert.ok(cuerpo.prompt.indexOf(guia.compilacion.prompt.replace(/^eventdecor_[a-z0-9]+_v\d+\s*,\s*/i, "").slice(0, 40)) < cuerpo.prompt.indexOf(nota), "el caption va antes de la nota");
    assert.equal(cuerpo.prompt.startsWith(nota), false);
    if (!loras.length) assert.doesNotMatch(cuerpo.prompt, /eventdecor_/, "el modo base no lleva trigger");
  }
  console.log("[PASS] /edit recibe solo la guía (modo base y entrenado), ningún byte de la foto, y la nota sigue al caption");

  // El prompt final cabe y no filtra nada.
  const final = buildLoraEditPrompt(guia.compilacion.prompt, guia.imagenes);
  assert.ok(final.length <= LORA_PROMPT_MAX_LENGTH, `el prompt con la nota mide ${final.length}`);
  assert.deepEqual([...findLoraPromptLanguageLeaks(final), ...findLoraPromptProductLeaks(final)], []);
  assert.ok(reservaNotaGuiaEscena() === Math.max(NOTA_GUIA_ESCENA.length, NOTA_GUIA_ESCENA_SIN_ESTRUCTURA.length) + 2);
  // CASE-005 de images-judge: sin aro, poste ni cintas dibujados, la nota no le sugiere a FLUX un aro con marco y
  // poste (unía dos piezas separadas en un arco), y dice que las piezas separadas siguen separadas.
  assert.match(notaGuiaEscena(true), /metal hoop frame and stand/);
  assert.doesNotMatch(notaGuiaEscena(false), /hoop|stand/);
  assert.match(notaGuiaEscena(false), /pieces drawn apart stay apart/);
  assert.equal(notaGuiaEscena(undefined), NOTA_GUIA_ESCENA, "sin dato, la nota de siempre");
  const sinEstructura = buildLoraEditPrompt("caption", [{ ...guia.imagenes![0]!, conEstructura: false }]);
  assert.ok(sinEstructura.endsWith(NOTA_GUIA_ESCENA_SIN_ESTRUCTURA));
  assert.throws(() => buildLoraEditPrompt("caption", [...(guia.imagenes ?? []), referencia]), /LORA_GUIA_INVALIDA/, "la guía de escena viaja sola");
  console.log("[PASS] el prompt con la nota cabe en el presupuesto, pasa el preflight y la guía no admite compañía");

  // Si Python falla, se genera sin guía y la respuesta lo dice; nunca en silencio.
  const caida = await guiaEscenaParaGeneracion({ admite: true, plan, foto: EJEMPLO_01, aspecto: "3:2", pedirDiscos: async () => { throw new Error("motor_ocupado"); }, maximo: LORA_PROMPT_MAX_LENGTH, compilar, cabe, largo: (c) => c.prompt.length });
  assert.equal(caida.imagenes, undefined);
  assert.equal(caida.compilacion, undefined);
  assert.equal(caida.resumen?.usada, false);
  assert.match(caida.resumen?.motivo ?? "", /no se pudo construir la guía de escena: motor_ocupado/);
  const sinGuia = await capturarPeticion(generarConSempertexLora, guia.compilacion.prompt, "3:2", [referencia, producto], { loras: [], seed: 7 });
  assert.ok(!JSON.stringify(sinGuia.cuerpo).includes(FOTO_REFERENCIA), "sin guía tampoco sale la foto");
  assert.equal((sinGuia.cuerpo as { image_urls?: unknown }).image_urls, undefined);
  // Una cancelación no es un fallo de la guía: se relanza.
  const corte = new AbortController();
  corte.abort();
  await assert.rejects(guiaEscenaParaGeneracion({ admite: true, plan, foto: EJEMPLO_01, aspecto: "3:2", pedirDiscos: async () => { throw new Error("cancelada"); }, maximo: LORA_PROMPT_MAX_LENGTH, compilar, cabe, largo: (c) => c.prompt.length, signal: corte.signal }), /cancelada/);
  // Si no cabe la nota, tampoco se usa, y se dice.
  const sinSitio = await guiaEscenaParaGeneracion({ admite: true, plan, foto: EJEMPLO_01, aspecto: "3:2", pedirDiscos, maximo: LORA_PROMPT_MAX_LENGTH, compilar, cabe: () => false, largo: (c) => c.prompt.length });
  assert.equal(sinSitio.imagenes, undefined);
  assert.match(sinSitio.resumen?.motivo ?? "", /no cabe/);
  assert.deepEqual(await guiaEscenaParaGeneracion({ admite: false, plan, foto: EJEMPLO_01, aspecto: "3:2", pedirDiscos, maximo: LORA_PROMPT_MAX_LENGTH, compilar, cabe, largo: (c) => c.prompt.length }), {});
  console.log("[PASS] sin guía (Python caído o nota sin sitio) se genera solo con texto y el resumen dice por qué; cancelar se relanza");

  const preparada = await prepararGuiaEscena({ plan, foto: undefined, aspecto: "2:3", pedirDiscos });
  const vertical = await sharp(Buffer.from(preparada.imagen.base64, "base64")).metadata();
  assert.deepEqual([vertical.width, vertical.height], [tamanoGuia(imageSizeFor("2:3")).ancho, tamanoGuia(imageSizeFor("2:3")).alto]);
  assert.equal(preparada.cajasDelPlan, 2, "sin el análisis de la foto, las cajas del plan");
  console.log("[PASS] el PNG sigue el aspecto pedido y, sin análisis de la foto, usa las cajas del plan");
}

async function main(): Promise<void> {
  testComposicion();
  testAnclaje();
  testDatosDePiezas();
  testCuandoSeUsa();
  await testAdaptador();
  await testCaminoDeGeneracion();
}

main().catch((error: unknown) => {
  console.error("[FAIL] guía de escena", error);
  process.exitCode = 1;
});
