/**
 * Lo que la guía de escena dibuja sin ser globo (`trazos` y `rellenos` de `plan-guia-escena-result.v1`) y las formas
 * del bouquet. Determinista y sin red.
 *
 * - Contrato: una pieza con trazos (líneas y arcos) y rellenos (elipses y polígonos) valida; uno fuera de formato,
 *   sin puntos suficientes o con un color mal escrito se rechaza. Lo que cuelga de una pieza flotante (cintas, pesa)
 *   puede bajar del origen hasta el piso.
 * - Composición: los rellenos y los trazos van detrás de los discos de su pieza, en su mismo encaje; un anillo entero
 *   es un `<circle fill="none">`, un arco un `<path>` con `A`; el marco gris claro sale oscurecido para leerse contra
 *   el fondo y el relleno lleva el borde de su tono. Sin trazos ni rellenos el SVG es exactamente el de antes.
 * - En espejo un arco cambia de lado.
 * - Formas del bouquet: la lámina del clasificador con sus seis formas, en su orden, y el contrato las admite.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-guia-escena-estructura.ts
 */
import assert from "node:assert/strict";
import { svgGuiaEscena, type InstanciaGuia } from "@/lib/ia/kagutsuchi/guia-escena";
import { tamanoGuia } from "@/lib/ia/kagutsuchi/guia-estructura";
import { imageSizeFor } from "@/lib/ia/kagutsuchi/flux";
import { formasDeOficial, incoherenciasFormaPieza } from "@/lib/plan/formas-pieza";
import { PiezaGuiaEscenaSchema, PlanGuiaEscenaResultV1Schema, type PiezaGuiaEscena } from "@/lib/plan/guia-escena";

const TAMANO = tamanoGuia(imageSizeFor("3:2"));
const METAL = "#c9d1cc";
const TELA = "#efe9e1";

function aro(conEstructura: boolean): PiezaGuiaEscena {
  const discos = [
    { x_m: -0.9, y_m: 1.25, r_m: 0.14, hex: "#1d4ed8" },
    { x_m: 0, y_m: 0.35, r_m: 0.14, hex: "#1d4ed8" },
    { x_m: 0.9, y_m: 1.25, r_m: 0.14, hex: "#f59e0b" },
  ];
  if (!conEstructura) return { estructura_id: "EST_ARO", fuente: "dibujo", ancho_m: 2.1, alto_m: 2.3, discos };
  return {
    estructura_id: "EST_ARO",
    fuente: "dibujo",
    ancho_m: 2.1,
    alto_m: 2.3,
    discos,
    trazos: [
      { forma: "arco", cx_m: 0, cy_m: 1.25, r_m: 1, desde_grados: 0, hasta_grados: 360, grosor_m: 0.03, hex: METAL },
      { forma: "arco", cx_m: 0, cy_m: 1.25, r_m: 0.8, desde_grados: 90, hasta_grados: 270, grosor_m: 0.03, hex: METAL },
      { forma: "linea", x1_m: 0, y1_m: 0.25, x2_m: 0, y2_m: 0, grosor_m: 0.03, hex: METAL },
    ],
    rellenos: [
      { forma: "elipse", cx_m: 0, cy_m: 1.25, rx_m: 1, ry_m: 1, hex: TELA },
      { forma: "poligono", puntos: [{ x_m: -0.1, y_m: 0 }, { x_m: 0.1, y_m: 0 }, { x_m: 0, y_m: 0.1 }], hex: METAL },
    ],
  };
}

function instancia(espejo = false): InstanciaGuia {
  return { estructura_id: "EST_ARO", instancia: 1, caja: { x: 0.3, y: 0.1, width: 0.4, height: 0.8 }, fuente: "plan", espejo, apoyo: "piso" };
}

function resultado(pieza: PiezaGuiaEscena) {
  return { operation_schema_version: "plan-guia-escena-result.v1", piezas: [pieza], omitidas: [], total_discos: pieza.discos.length };
}

function testContrato(): void {
  assert.equal(PlanGuiaEscenaResultV1Schema.safeParse(resultado(aro(true))).success, true);
  assert.equal(PlanGuiaEscenaResultV1Schema.safeParse(resultado(aro(false))).success, true, "sin estructura sigue valiendo");
  const mal = (cambio: Partial<PiezaGuiaEscena>) => PiezaGuiaEscenaSchema.safeParse({ ...aro(true), ...cambio }).success;
  assert.equal(mal({ trazos: [{ forma: "curva", x_m: 0 } as never] }), false, "una forma que no existe");
  assert.equal(mal({ trazos: [{ forma: "linea", x1_m: 0, y1_m: 0, x2_m: 1, y2_m: 1, grosor_m: 0.01, hex: "#C9D1CC" }] }), false, "hex en mayúsculas");
  assert.equal(mal({ trazos: [{ forma: "linea", x1_m: 0, y1_m: 0, x2_m: 1, y2_m: 1, grosor_m: 0, hex: METAL }] }), false, "grosor cero");
  assert.equal(mal({ rellenos: [{ forma: "poligono", puntos: [{ x_m: 0, y_m: 0 }, { x_m: 1, y_m: 0 }], hex: METAL }] }), false, "dos puntos no son un polígono");
  assert.equal(mal({ trazos: [] }), false, "una lista vacía no se publica");
  // Las cintas de un bouquet de helio bajan del globo más bajo hasta la pesa, en el piso.
  assert.equal(mal({ anclaje: "flotante", elevacion_m: 1.2, trazos: [{ forma: "linea", x1_m: 0, y1_m: 0.1, x2_m: 0, y2_m: -1.2, grosor_m: 0.006, hex: "#e6b8a2" }] }), true);
  assert.equal(mal({ trazos: [{ forma: "linea", x1_m: 0, y1_m: 0, x2_m: 0, y2_m: -11, grosor_m: 0.006, hex: METAL }] }), false, "más abajo que la cinta más larga");
  console.log("[PASS] contrato: trazos y rellenos opcionales, con forma, grosor, puntos y color validados");
}

function testComposicion(): void {
  const sin = svgGuiaEscena([aro(false)], [instancia()], TAMANO);
  const con = svgGuiaEscena([aro(true)], [instancia()], TAMANO);
  // Sin estructura: solo fondo, piso y círculos con borde, como siempre.
  assert.doesNotMatch(sin, /<line|<path|<ellipse|<polygon|fill="none"/);
  // Con estructura: los mismos discos, y detrás de ellos el forro, la base, el anillo, el medio arco y el poste.
  // Posición, radio y relleno iguales (el borde puede cambiar: el forro claro también cuenta para elegir el fondo).
  const discosSin = sin.match(/<circle cx="[^"]+" cy="[^"]+" r="[^"]+" fill="#[0-9a-f]{6}"/g) ?? [];
  assert.equal(discosSin.length, 3);
  for (const disco of discosSin) assert.ok(con.includes(disco), "los discos no cambian");
  const primeraPieza = con.indexOf("<ellipse");
  const primerDisco = con.indexOf(discosSin[0]!);
  assert.ok(primeraPieza > 0 && primeraPieza < primerDisco, "el forro va detrás de los discos");
  assert.ok(con.indexOf("<line") < primerDisco && con.indexOf("<path") < primerDisco, "el marco va detrás de los discos");
  assert.match(con, /<ellipse [^>]*fill="#efe9e1"/, "el forro con su color");
  assert.match(con, /<polygon points="[^"]+" fill="#c9d1cc"/);
  assert.match(con, /<circle [^>]*fill="none" stroke="#[0-9a-f]{6}"/, "el anillo entero es un círculo sin relleno");
  assert.match(con, /<path d="M[^"]*A[^"]*" fill="none"/, "el medio arco es un path con A");
  const trazo = /<line [^>]*stroke="(#[0-9a-f]{6})"/.exec(con)![1]!;
  assert.notEqual(trazo, METAL, "el gris claro del marco se oscurece para leerse contra el fondo claro");
  assert.equal(svgGuiaEscena([aro(true)], [instancia()], TAMANO), con, "determinista");
  console.log("[PASS] composición: rellenos y trazos detrás de los discos de su pieza; sin ellos, el SVG de antes");
}

function testEspejo(): void {
  const derecho = svgGuiaEscena([aro(true)], [instancia()], TAMANO);
  const espejo = svgGuiaEscena([aro(true)], [instancia(true)], TAMANO);
  const arco = (svg: string) => {
    const m = /<path d="M([-\d.]+) ([-\d.]+)A[-\d.]+ [-\d.]+ 0 (\d) (\d) ([-\d.]+) ([-\d.]+)"/.exec(svg)!;
    return { y0: Number(m[2]), barrido: m[4], y1: Number(m[6]) };
  };
  // Antihorario en pantalla (`sweep` 0): el medio arco de 90° a 270° baja de arriba a abajo por la izquierda;
  // en espejo (de -90° a 90°) sube de abajo a arriba, que antihorario es por la derecha.
  assert.equal(arco(derecho).barrido, "0");
  assert.equal(arco(espejo).barrido, "0");
  assert.ok(arco(derecho).y0 < arco(derecho).y1, "sin espejo empieza arriba");
  assert.ok(arco(espejo).y0 > arco(espejo).y1, "en espejo empieza abajo");
  console.log("[PASS] espejo: el arco cambia de lado y sigue siendo antihorario");
}

function testFormasBouquet(): void {
  // La lámina `bouquet` de `clasificador-decoraciones/src/lib/referencias/variantes.ts`, en su orden.
  assert.deepEqual(formasDeOficial("bouquet").map((ficha) => ficha.id), ["helio", "piso", "burbuja", "con-numero", "caja", "relleno"]);
  assert.deepEqual(incoherenciasFormaPieza({ estructura_oficial: "bouquet", forma: "caja" }), []);
  assert.equal(incoherenciasFormaPieza({ estructura_oficial: "bouquet", forma: "mini-aro" }).length, 1, "una forma de otra lámina");
  assert.equal(incoherenciasFormaPieza({ estructura_oficial: "figura", forma: "helio" }).length, 1, "la figura sigue sin formas");
  console.log("[PASS] formas del bouquet: las seis de la lámina del clasificador, elegibles en el contrato");
}

testContrato();
testComposicion();
testEspejo();
testFormasBouquet();
