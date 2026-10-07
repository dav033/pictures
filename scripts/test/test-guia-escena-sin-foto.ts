/**
 * La guía de escena para los planes SIN foto (`GUIA_ESCENA_SIN_FOTO_V1`, 2026-10-07: «¿O sea FLUX también debería
 * recibir el gráfico, no?»).
 *
 * Caso del dueño (guiada-20261007-071126-x7w4dx): un «Semiarco» orgánico de 2,46 × 2,91 m (101 globos de 5/12/18″,
 * verde metal, azul naval, azul reflex, verde lima reflex y dorado reflex), de una idea del catálogo, sin foto. FLUX
 * solo recibió texto («A one-sided curved organic balloon garland … at one side of the rear wall») y pintó un arco
 * completo de dos patas. Ahora FLUX recibe por `/edit` el dibujo del motor (la receta, la misma de la gráfica del
 * plan), con cada pieza a su escala real en metros y en la zona que dice su ubicación.
 *
 * Se comprueba, sin red ni coste (Python y su receta son dobles):
 * - semiarco solo, semiarco + columna izquierda + columna derecha, guirnalda de 2,4 m y un par de columnas: la
 *   escala común (px por metro), las posiciones (centro, lados, huecos, piso, altura de pared) y los colores (los
 *   del motor, intactos en el SVG y en el PNG);
 * - la receta del motor llega a Python solo para las piezas sin armado (`piezasSinArmadoDelMotor`), y si falla la
 *   pieza va solo con texto y queda dicho; lo que Python omite queda en `omitidas`;
 * - cuándo se admite (bandera `sinFoto`), la nota de la guía (forma exacta + entorno) y el respaldo en texto del
 *   semiarco solo (una pata, la punta en el aire).
 *
 *   npx tsx --conditions=react-server scripts/test/test-guia-escena-sin-foto.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { ESCENA_SIN_FOTO, generacionAdmiteGuiaEscena, instanciasAEscala, svgGuiaEscena, type InstanciaGuia } from "@/lib/ia/kagutsuchi/guia-escena";
import { guiaEscenaParaGeneracion, piezasSinArmadoDelMotor, prepararGuiaEscena, type CompletarRecetas } from "@/lib/ia/kagutsuchi/preparar-guia-escena";
import { tamanoGuia } from "@/lib/ia/kagutsuchi/guia-estructura";
import { imageSizeFor, NOTA_GUIA_ESCENA, NOTA_GUIA_ESCENA_SIN_ESTRUCTURA } from "@/lib/ia/kagutsuchi/flux";
import type { PiezaGuiaEscena, PlanGuiaEscenaResultV1 } from "@/lib/plan/guia-escena";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { captionDeCuerpoGenerate } from "../lib/caption-de-cuerpo-generate";
import { casoArcoPatron } from "../lib/escenas-guia-estructura";

configurarPersistenciaTelemetria(undefined);

const TAMANO = tamanoGuia(imageSizeFor("3:2"));
type EstructuraPlan = PlanResuelto["plan"]["estructuras"][number];

let fallos = 0;
async function caso(nombre: string, prueba: () => Promise<void> | void): Promise<void> {
  try {
    await prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

// ── Piezas como las publica Python (metros, origen abajo al centro), con discos que no se tocan ─────────────────
/** Los cinco colores del semiarco del dueño, como los publica Python (`hexGlobo` de cada referencia). */
const COLORES_SEMIARCO = ["#158536", "#172c59", "#417693", "#83a35a", "#a08344"] as const;

/** Un semiarco del motor: una pata a la izquierda que sube y se curva hacia la derecha, la punta en el aire. */
function semiarco(id: string): PiezaGuiaEscena {
  const discos = [
    { x_m: -1.1, y_m: 0.25, r_m: 0.2, hex: COLORES_SEMIARCO[0] },
    { x_m: -1.05, y_m: 0.9, r_m: 0.2, hex: COLORES_SEMIARCO[1] },
    { x_m: -0.9, y_m: 1.6, r_m: 0.2, hex: COLORES_SEMIARCO[2] },
    { x_m: -0.4, y_m: 2.3, r_m: 0.2, hex: COLORES_SEMIARCO[3] },
    { x_m: 0.4, y_m: 2.55, r_m: 0.2, hex: COLORES_SEMIARCO[4] },
    { x_m: 1.1, y_m: 2.2, r_m: 0.2, hex: COLORES_SEMIARCO[0] },
  ];
  return { estructura_id: id, fuente: "motor", ancho_m: 2.69, alto_m: 2.79, discos };
}

function columna(id: string, hexes: readonly string[] = ["#1e8a3c", "#111111", "#ffffff"]): PiezaGuiaEscena {
  const discos = [0.2, 0.75, 1.3, 1.8].map((y, indice) => ({ x_m: 0, y_m: y, r_m: 0.2, hex: hexes[indice % hexes.length]! }));
  return { estructura_id: id, fuente: "motor", ancho_m: 0.6, alto_m: 2.05, discos };
}

function guirnalda(id: string): PiezaGuiaEscena {
  const hexes = ["#e6cfd6", "#a08344", "#ffffff"];
  const discos = [-0.95, -0.45, 0.05, 0.55, 1.0].map((x, indice) => ({ x_m: x, y_m: 0.4, r_m: 0.18, hex: hexes[indice % hexes.length]! }));
  return { estructura_id: id, fuente: "motor", ancho_m: 2.4, alto_m: 0.81, discos };
}

/** Una estructura del plan (sobre la del fixture de siempre) con lo que la guía lee de ella. */
function estructura(id: string, extra: Partial<EstructuraPlan>): EstructuraPlan {
  const base = casoArcoPatron().plan.plan.estructuras[0]!;
  const { armado_arco: _armadoArco, ...sinArmado } = base as EstructuraPlan & { armado_arco?: unknown };
  return { ...sinArmado, estructura_id: id, repeticiones: 1, referencia_element_id: undefined, ...extra } as EstructuraPlan;
}

function planCon(estructuras: EstructuraPlan[]): PlanResuelto {
  const base = casoArcoPatron().plan;
  return { ...base, plan: { ...base.plan, estructuras }, estructuras: [], patrones_color: [] } as PlanResuelto;
}

const SEMIARCO = estructura("EST_01_SEMIARCO", { tipo: "semiarco", ubicacion: "fondo_pared", mezcla: "organica_fina", estructura_oficial: "semiarco", medidas: { ancho_m: 2.46, alto_m: 2.91 } } as Partial<EstructuraPlan>);
const COLUMNA_IZQ = estructura("EST_02_COLUMNA", { tipo: "columna", ubicacion: "lateral_izquierdo", mezcla: "clasica", estructura_oficial: "columna", medidas: { alto_m: 2 } } as Partial<EstructuraPlan>);
const COLUMNA_DER = estructura("EST_03_COLUMNA", { tipo: "columna", ubicacion: "lateral_derecho", mezcla: "clasica", estructura_oficial: "columna", medidas: { alto_m: 2 } } as Partial<EstructuraPlan>);
const GUIRNALDA = estructura("EST_01_GUIRNALDA", { tipo: "guirnalda", ubicacion: "fondo_pared", mezcla: "organica_fina", estructura_oficial: "guirnalda", medidas: { largo_m: 2.4 } } as Partial<EstructuraPlan>);

const resultado = (piezas: PiezaGuiaEscena[], omitidas: PlanGuiaEscenaResultV1["omitidas"] = []): PlanGuiaEscenaResultV1 => ({
  operation_schema_version: "plan-guia-escena-result.v1",
  piezas,
  omitidas,
  total_discos: piezas.reduce((suma, pieza) => suma + pieza.discos.length, 0),
});

const cerca = (a: number, b: number, tolerancia = 1e-6) => Math.abs(a - b) <= tolerancia;
const derechaDe = (instancia: InstanciaGuia) => instancia.caja.x + instancia.caja.width;
const baseDe = (instancia: InstanciaGuia) => instancia.caja.y + instancia.caja.height;
const centroXDe = (instancia: InstanciaGuia) => instancia.caja.x + instancia.caja.width / 2;
/** Píxeles por metro de una instancia: los dos lados de su caja dan la misma escala (la pieza la llena justa). */
function escalaDe(instancia: InstanciaGuia, pieza: PiezaGuiaEscena): number {
  const porAncho = (instancia.caja.width * TAMANO.ancho) / pieza.ancho_m;
  const porAlto = (instancia.caja.height * TAMANO.alto) / (pieza.alto_m + (instancia.apoyo === "flotante" ? pieza.elevacion_m ?? 0 : 0));
  assert.ok(cerca(porAncho, porAlto, 1e-6), `la caja de ${instancia.estructura_id} encaja la pieza justa (${porAncho} vs ${porAlto})`);
  return porAncho;
}

/** El color del PNG en el centro de cada disco: el hex de Python, intacto. */
async function coloresEnElPng(base64: string, puntos: ReadonlyArray<{ x: number; y: number; hex: string }>): Promise<void> {
  const { data, info } = await sharp(Buffer.from(base64, "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const punto of puntos) {
    const indice = (Math.round(punto.y) * info.width + Math.round(punto.x)) * info.channels;
    const leido = `#${[data[indice]!, data[indice + 1]!, data[indice + 2]!].map((canal) => canal.toString(16).padStart(2, "0")).join("")}`;
    assert.equal(leido, punto.hex, `el PNG pinta ${punto.hex} en (${Math.round(punto.x)}, ${Math.round(punto.y)})`);
  }
}

/** El centro en píxeles de cada disco de una pieza en su instancia (sin espejo). */
function centrosDe(pieza: PiezaGuiaEscena, instancia: InstanciaGuia, pxPorMetro: number): Array<{ x: number; y: number; hex: string }> {
  const centro = centroXDe(instancia) * TAMANO.ancho;
  const base = baseDe(instancia) * TAMANO.alto;
  return pieza.discos.map((disco) => ({ x: centro + (instancia.espejo ? -disco.x_m : disco.x_m) * pxPorMetro, y: base - disco.y_m * pxPorMetro, hex: disco.hex }));
}

async function main(): Promise<void> {
  await caso("semiarco solo: centrado, de pie en el piso y a su escala real (5,5 m de pared a lo ancho)", async () => {
    const pieza = semiarco("EST_01_SEMIARCO");
    const escena = instanciasAEscala([SEMIARCO], [pieza], TAMANO);
    assert.equal(escena.instancias.length, 1);
    const [instancia] = escena.instancias as [InstanciaGuia];
    assert.equal(instancia.apoyo, "piso");
    assert.equal(instancia.espejo, false, "la pata a la izquierda como la dibuja el motor");
    assert.ok(cerca(centroXDe(instancia), 0.5), "centrado en la pared del fondo");
    assert.ok(cerca(baseDe(instancia), ESCENA_SIN_FOTO.piso), "apoyado en la línea del piso");
    assert.ok(cerca(escalaDe(instancia, pieza), escena.pxPorMetro));
    assert.ok(cerca(escena.anchoVisibleM, ESCENA_SIN_FOTO.anchoVisibleMinimoM, 1e-9), `enseña 5,5 m de pared (${escena.anchoVisibleM})`);
    // 2,69 m de 5,5 m: menos de la mitad del ancho; 2,79 m de ~3,15 m sobre el piso.
    assert.ok(cerca(instancia.caja.width, 2.69 / 5.5, 1e-9));
    assert.ok(escena.altoVisibleM > 2.79 + ESCENA_SIN_FOTO.margenSuperiorM - 1e-9 && escena.altoVisibleM < 3.4, `alto visible ${escena.altoVisibleM}`);
    const preparada = await prepararGuiaEscena({ plan: planCon([SEMIARCO]), foto: undefined, aspecto: "3:2", pedirDiscos: async () => resultado([pieza]) });
    assert.equal(preparada.composicion, "escala");
    assert.deepEqual(preparada.cajas.map((caja) => caja.estructura_id), ["EST_01_SEMIARCO"]);
    assert.ok(preparada.escala && cerca(preparada.escala.px_por_m, escena.pxPorMetro, 1e-3));
    await coloresEnElPng(preparada.imagen.base64, centrosDe(pieza, instancia, escena.pxPorMetro));
    // El piso del PNG empieza en la línea del piso: un píxel por encima es pared, uno por debajo, piso.
    const svg = svgGuiaEscena([pieza], escena.instancias, TAMANO, { lineaPiso: escena.lineaPiso });
    assert.match(svg, new RegExp(`<rect x="0" y="${Math.round(TAMANO.alto * ESCENA_SIN_FOTO.piso * 100) / 100}"`));
  });

  await caso("semiarco + columna izquierda + columna derecha: una escala, columnas a cada lado con aire, todas en el piso", async () => {
    const piezas = [semiarco("EST_01_SEMIARCO"), columna("EST_02_COLUMNA"), columna("EST_03_COLUMNA")];
    const escena = instanciasAEscala([SEMIARCO, COLUMNA_IZQ, COLUMNA_DER], piezas, TAMANO);
    const porId = new Map(escena.instancias.map((instancia) => [instancia.estructura_id, instancia] as const));
    const arco = porId.get("EST_01_SEMIARCO")!;
    const izquierda = porId.get("EST_02_COLUMNA")!;
    const derecha = porId.get("EST_03_COLUMNA")!;
    for (const [instancia, pieza] of [[arco, piezas[0]!], [izquierda, piezas[1]!], [derecha, piezas[2]!]] as const) {
      assert.ok(cerca(escalaDe(instancia, pieza), escena.pxPorMetro), `${instancia.estructura_id} a la escala común`);
      assert.ok(cerca(baseDe(instancia), ESCENA_SIN_FOTO.piso), `${instancia.estructura_id} en el piso`);
    }
    assert.ok(cerca(centroXDe(arco), 0.5), "el semiarco en el centro");
    const huecoM = (a: number, b: number) => ((b - a) * TAMANO.ancho) / escena.pxPorMetro;
    assert.ok(cerca(huecoM(derechaDe(izquierda), arco.caja.x), ESCENA_SIN_FOTO.huecoEntrePiezasM), "aire entre la columna izquierda y el semiarco");
    assert.ok(cerca(huecoM(derechaDe(arco), derecha.caja.x), ESCENA_SIN_FOTO.huecoEntrePiezasM), "aire entre el semiarco y la columna derecha");
    assert.ok(izquierda.caja.x > 0 && derechaDe(derecha) < 1, "todo dentro del lienzo");
    // La columna de 2,05 m es más baja que el semiarco de 2,79 m, en la misma proporción.
    assert.ok(cerca(izquierda.caja.height / arco.caja.height, 2.05 / 2.79, 1e-9));
    const preparada = await prepararGuiaEscena({ plan: planCon([SEMIARCO, COLUMNA_IZQ, COLUMNA_DER]), foto: undefined, aspecto: "3:2", pedirDiscos: async () => resultado(piezas) });
    assert.equal(preparada.piezas, 3);
    assert.equal(preparada.cajasDelPlan, 3);
    await coloresEnElPng(preparada.imagen.base64, [
      ...centrosDe(piezas[0]!, arco, escena.pxPorMetro),
      ...centrosDe(piezas[1]!, izquierda, escena.pxPorMetro),
      ...centrosDe(piezas[2]!, derecha, escena.pxPorMetro),
    ]);
  });

  await caso("guirnalda de 2,4 m: colgada en la pared a ~1,9 m, centrada y del 44 % del ancho (no de pared a pared)", async () => {
    const pieza = guirnalda("EST_01_GUIRNALDA");
    const escena = instanciasAEscala([GUIRNALDA], [pieza], TAMANO);
    const [instancia] = escena.instancias as [InstanciaGuia];
    assert.equal(instancia.apoyo, "pared");
    assert.ok(cerca(escalaDe(instancia, pieza), escena.pxPorMetro));
    assert.ok(cerca(instancia.caja.width, 2.4 / 5.5, 1e-9), `ancho ${instancia.caja.width}`);
    assert.ok(cerca(centroXDe(instancia), 0.5));
    const centroSobrePisoM = ((ESCENA_SIN_FOTO.piso - (instancia.caja.y + instancia.caja.height / 2)) * TAMANO.alto) / escena.pxPorMetro;
    assert.ok(cerca(centroSobrePisoM, ESCENA_SIN_FOTO.alturaCentroParedM, 1e-6), `centro a ${centroSobrePisoM} m del piso`);
    const preparada = await prepararGuiaEscena({ plan: planCon([GUIRNALDA]), foto: undefined, aspecto: "3:2", pedirDiscos: async () => resultado([pieza]) });
    await coloresEnElPng(preparada.imagen.base64, centrosDe(pieza, instancia, escena.pxPorMetro));
  });

  await caso("piezas pareja: dos columnas de una misma estructura van una a cada lado, en espejo, con la mesa en medio", () => {
    const par = estructura("EST_01_COLUMNAS", { tipo: "columna", ubicacion: "lateral_izquierdo", repeticiones: 2, mezcla: "clasica", estructura_oficial: "columna" } as Partial<EstructuraPlan>);
    const escena = instanciasAEscala([par], [columna("EST_01_COLUMNAS")], TAMANO);
    assert.equal(escena.instancias.length, 2);
    const [primera, segunda] = escena.instancias as [InstanciaGuia, InstanciaGuia];
    assert.ok(centroXDe(primera) < 0.5 && centroXDe(segunda) > 0.5, "una a cada lado");
    assert.ok(cerca(centroXDe(primera) + centroXDe(segunda), 1, 1e-9), "simétricas");
    assert.equal(segunda.espejo, true, "la derecha en espejo");
    const huecoM = ((segunda.caja.x - derechaDe(primera)) * TAMANO.ancho) / escena.pxPorMetro;
    assert.ok(cerca(huecoM, ESCENA_SIN_FOTO.huecoCentralM, 1e-6), `hueco central de ${huecoM} m`);
  });

  await caso("una pieza de techo cuelga arriba y una de mesa se apoya a la altura de la mesa; el piso no se mueve", () => {
    const techo = estructura("EST_01_TECHO", { tipo: "guirnalda", ubicacion: "techo", estructura_oficial: "guirnalda" } as Partial<EstructuraPlan>);
    const mesa = estructura("EST_02_CENTRO", { tipo: "centro_mesa", ubicacion: "sobre_mesa_principal", estructura_oficial: undefined } as Partial<EstructuraPlan>);
    const escena = instanciasAEscala([techo, mesa], [guirnalda("EST_01_TECHO"), { ...columna("EST_02_CENTRO"), alto_m: 0.6, ancho_m: 0.5 }], TAMANO);
    const porId = new Map(escena.instancias.map((instancia) => [instancia.estructura_id, instancia] as const));
    assert.equal(porId.get("EST_01_TECHO")!.apoyo, "techo");
    assert.ok(cerca(porId.get("EST_01_TECHO")!.caja.y, 0));
    const mesaM = ((ESCENA_SIN_FOTO.piso - baseDe(porId.get("EST_02_CENTRO")!)) * TAMANO.alto) / escena.pxPorMetro;
    assert.ok(cerca(mesaM, ESCENA_SIN_FOTO.alturaMesaM, 1e-6), `sobre la mesa a ${mesaM} m`);
    assert.equal(escena.lineaPiso, ESCENA_SIN_FOTO.piso);
  });

  await caso("la receta del motor llega a Python solo para las piezas sin armado; lo omitido va solo con texto y se dice", async () => {
    const aro = estructura("EST_04_ARO", { tipo: "arco", ubicacion: "fondo_pared", estructura_oficial: "aro_circular" } as Partial<EstructuraPlan>);
    const conArmadoDeFoto = estructura("EST_05_GUIRNALDA", { tipo: "guirnalda", ubicacion: "fondo_pared", estructura_oficial: "guirnalda", armado_guirnalda: { version: "x" } } as unknown as Partial<EstructuraPlan>);
    assert.deepEqual(piezasSinArmadoDelMotor([SEMIARCO, COLUMNA_IZQ, aro, conArmadoDeFoto]), ["EST_01_SEMIARCO", "EST_02_COLUMNA"]);
    const plan = planCon([SEMIARCO, COLUMNA_IZQ, COLUMNA_DER]);
    const pedidas: string[][] = [];
    const completarRecetas: CompletarRecetas = async (declarado, ids) => {
      pedidas.push([...ids]);
      return { ...declarado, estructuras: declarado.estructuras.map((item) => (ids.includes(item.estructura_id) ? { ...item, armado_arco_organico: { receta: true } } : item)) } as PlanResuelto["plan"];
    };
    let recibido: PlanResuelto["plan"] | undefined;
    const pedirDiscos = async (declarado: PlanResuelto["plan"]) => {
      recibido = declarado;
      return resultado([semiarco("EST_01_SEMIARCO"), columna("EST_02_COLUMNA")], [{ estructura_id: "EST_03_COLUMNA", motivo: "sin_dibujo" }]);
    };
    const preparada = await prepararGuiaEscena({ plan, foto: undefined, aspecto: "3:2", pedirDiscos, completarRecetas });
    assert.deepEqual(pedidas, [["EST_01_SEMIARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"]]);
    assert.ok(recibido?.estructuras.every((item) => "armado_arco_organico" in item), "Python recibe el plan con la receta");
    assert.ok(!plan.plan.estructuras.some((item) => "armado_arco_organico" in item), "el plan aprobado no cambia");
    assert.deepEqual(preparada.recetas, { pedidas: ["EST_01_SEMIARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"], usadas: ["EST_01_SEMIARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"] });
    assert.deepEqual(preparada.omitidas, [{ estructura_id: "EST_03_COLUMNA", motivo: "sin_dibujo" }]);
    assert.deepEqual(preparada.cajas.map((caja) => caja.estructura_id), ["EST_01_SEMIARCO", "EST_02_COLUMNA"], "la omitida no tiene caja");
    // Si la receta no llega, la guía sigue con lo que Python sepa dibujar y lo dice.
    const sinReceta = await prepararGuiaEscena({ plan, foto: undefined, aspecto: "3:2", pedirDiscos, completarRecetas: async () => { throw new Error("motor_ocupado"); } });
    assert.equal(sinReceta.recetas?.motivo, "motor_ocupado");
    assert.deepEqual(sinReceta.recetas?.usadas, []);
    // Una cancelación no es un fallo de la receta: se relanza.
    const corte = new AbortController();
    corte.abort();
    await assert.rejects(prepararGuiaEscena({ plan, foto: undefined, aspecto: "3:2", pedirDiscos, completarRecetas: async () => { throw new Error("cancelada"); }, signal: corte.signal }), /cancelada/);
  });

  await caso("el resumen para el registro (`regla:guia_escena`) dice la composición, las piezas, las omitidas y la caja de cada una", async () => {
    const plan = planCon([SEMIARCO, COLUMNA_IZQ, COLUMNA_DER]);
    const guia = await guiaEscenaParaGeneracion({
      admite: true,
      plan,
      foto: undefined,
      aspecto: "3:2",
      pedirDiscos: async () => resultado([semiarco("EST_01_SEMIARCO"), columna("EST_02_COLUMNA"), columna("EST_03_COLUMNA")]),
      maximo: 1500 + NOTA_GUIA_ESCENA_SIN_ESTRUCTURA.length + 2,
      compilar: (maxLength) => ({ prompt: `A balloon decoration (${maxLength}).` }),
      cabe: () => true,
      largo: (compilacion) => compilacion.prompt.length,
    });
    assert.equal(guia.resumen?.usada, true);
    assert.equal(guia.resumen?.composicion, "escala");
    assert.equal(guia.resumen?.piezas, 3);
    assert.deepEqual(guia.resumen?.cajas?.map((caja) => [caja.estructura_id, caja.apoyo]), [["EST_01_SEMIARCO", "piso"], ["EST_02_COLUMNA", "piso"], ["EST_03_COLUMNA", "piso"]]);
    assert.ok(guia.resumen?.cajas?.every((caja) => caja.caja.width > 0 && caja.caja.x >= 0 && caja.caja.x + caja.caja.width <= 1));
    assert.ok((guia.resumen?.escala?.px_por_m ?? 0) > 0);
  });

  await caso("se admite sin foto solo con `sinFoto` (GUIA_ESCENA_SIN_FOTO_V1); con foto, como siempre", () => {
    const base = { bandera: true, usarFlux: true, hibrido: false, fotoEspacio: false, resultadoPrevio: false, editApagado: false, formatoTexto: true, conReferencia: false };
    assert.equal(generacionAdmiteGuiaEscena(base), false, "sin foto y sin la bandera nueva: solo texto, como antes");
    assert.equal(generacionAdmiteGuiaEscena({ ...base, sinFoto: true }), true);
    assert.equal(generacionAdmiteGuiaEscena({ ...base, sinFoto: true, bandera: false }), false, "GUIA_ESCENA_V1 apagada lo apaga todo");
    assert.equal(generacionAdmiteGuiaEscena({ ...base, sinFoto: true, fotoEspacio: true }), false, "con foto del espacio la escena ya existe");
    assert.equal(generacionAdmiteGuiaEscena({ ...base, conReferencia: true }), true);
  });

  await caso("la nota de la guía pide la forma exacta, globos reales y el entorno completo en lugar del fondo del mapa", () => {
    for (const nota of [NOTA_GUIA_ESCENA, NOTA_GUIA_ESCENA_SIN_ESTRUCTURA]) {
      assert.match(nota, /keep exactly the shape, position, size and colors of every balloon piece/);
      assert.match(nota, /real latex balloon/);
      assert.match(nota, /plain background and floor strip are only placeholders: replace them with the complete event setting described above/);
      assert.match(nota, /never reproduce the flat map/i);
    }
  });

  await caso("respaldo en texto: el semiarco solo dice una pata en un lado y la punta en el aire (caso x7w4dx)", async () => {
    const raiz = process.cwd();
    const guardado = JSON.parse(readFileSync(path.join(raiz, "data", "biblioteca-real", "analisis", "real-04-71mp5umakml-ac-uf894-1000-ql80.plan.json"), "utf8")) as { plan_resuelto: Record<string, unknown> & { plan: unknown }; material_estimate: Parameters<typeof captionDeCuerpoGenerate>[1]["material_estimate"] };
    const ideas = JSON.parse(readFileSync(path.join(raiz, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")) as { ideas: Record<string, { plan: unknown }> };
    const plan = ideas.ideas["deco-real-04-71mp5umakml-ac-uf894-1000-ql80"]!.plan;
    const r = await captionDeCuerpoGenerate(
      { brief: { tipo_evento: "cumpleaños", colores: ["verde", "azul", "dorado"], estilo: "Infantil de dinosaurios" } as never, solicitudUsuario: "Cumpleaños infantil de dinosaurios.", creatividad: 2 },
      { plan_resuelto: { schema_version: "plan-resuelto.v1", ...guardado.plan_resuelto, plan }, material_estimate: guardado.material_estimate },
    );
    assert.match(r.prompt, /one-sided curved organic balloon garland/);
    assert.match(r.prompt, /a single leg rising from the floor at one side, curving over and sweeping across the entire top of the backdrop to the far side, its tip ending in mid-air at the opposite upper corner with bare floor beneath it/, r.prompt);
    assert.doesNotMatch(r.prompt, /\barch\b/i, "nunca la palabra arch sin arco en el plan");
    assert.equal(r.preflight.ok, true, r.preflight.errors.join("; "));
  });

  if (fallos) {
    console.error(`\n${fallos} caso(s) fallaron`);
    process.exitCode = 1;
  } else {
    console.log("\n[PASS] guía de escena sin foto: escala real, posiciones, colores, receta del motor, registro, nota y respaldo en texto");
  }
}

void main();
