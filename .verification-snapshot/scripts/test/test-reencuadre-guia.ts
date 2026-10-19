/**
 * Auditoría de propiedades huérfanas (2026-10-05): la forma de la foto no llegaba a la guía de escena.
 *
 * Las cajas de la foto son fracciones de una foto vertical de teléfono (CASE-005: 320×480) y se copiaban tal cual
 * sobre un lienzo 3:2. El semiarco y la columna, pegados en la foto, salían separados por un hueco enorme y
 * diminutos al pie de un lienzo vacío. `reencuadrar` las lleva al lienzo con una sola escala y encuadra la
 * decoración.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-reencuadre-guia.ts
 */
import assert from "node:assert/strict";
import { MARGEN_ENCUADRE, proporcionDeLaFoto, reencuadrar, type InstanciaGuia } from "@/lib/ia/kagutsuchi/guia-escena";
import { aspectoDeLaReferencia, aspectoMasCercano } from "@/lib/ia/nucleo/aspecto";

const LIENZO = { ancho: 1024, alto: 683 };
const cerca = (a: number, b: number, tolerancia = 1e-6) => Math.abs(a - b) <= tolerancia;
const instancia = (estructura_id: string, caja: InstanciaGuia["caja"], apoyo: InstanciaGuia["apoyo"] = "piso", fuente: InstanciaGuia["fuente"] = "foto"): InstanciaGuia =>
  ({ estructura_id, instancia: 1, caja, fuente, espejo: false, apoyo });

// Las cajas del CASE-005 tal como las devolvió el análisis (fracciones de la foto vertical).
const SEMIARCO = { x: 0.148, y: 0.653, width: 0.449, height: 0.286 };
const COLUMNA = { x: 0.604, y: 0.69, width: 0.214, height: 0.248 };
const PROPORCION_FOTO = 320 / 480;

{
  const [semi, col] = reencuadrar([instancia("EST_01", SEMIARCO), instancia("EST_02", COLUMNA)], PROPORCION_FOTO, LIENZO);
  const px = (caja: InstanciaGuia["caja"]) => ({ x: caja.x * LIENZO.ancho, y: caja.y * LIENZO.alto, w: caja.width * LIENZO.ancho, h: caja.height * LIENZO.alto });
  const s = px(semi!.caja);
  const c = px(col!.caja);
  // Una sola escala: la forma de cada caja es la de la foto (alto/ancho en píxeles reales).
  assert.ok(cerca(s.h / s.w, (SEMIARCO.height * 480) / (SEMIARCO.width * 320), 1e-9), "la caja del semiarco conserva su forma");
  assert.ok(cerca(c.h / c.w, (COLUMNA.height * 480) / (COLUMNA.width * 320), 1e-9), "la caja de la columna conserva su forma");
  // El hueco entre las dos, medido en la misma escala que sus anchos, es el de la foto: siguen casi pegadas.
  const huecoFoto = (COLUMNA.x - (SEMIARCO.x + SEMIARCO.width)) / SEMIARCO.width;
  assert.ok(cerca((c.x - (s.x + s.w)) / s.w, huecoFoto, 1e-9), "el hueco relativo es el de la foto");
  // La decoración llena el lienzo en el lado que manda y se apoya al pie, dentro del margen.
  const arriba = Math.min(s.y, c.y);
  const abajo = Math.max(s.y + s.h, c.y + c.h);
  const izquierda = Math.min(s.x, c.x);
  const derecha = Math.max(s.x + s.w, c.x + c.w);
  const llenaAlto = cerca(abajo - arriba, LIENZO.alto * (1 - 2 * MARGEN_ENCUADRE), 1e-6);
  const llenaAncho = cerca(derecha - izquierda, LIENZO.ancho * (1 - 2 * MARGEN_ENCUADRE), 1e-6);
  assert.ok(llenaAlto || llenaAncho, "la decoración llena el lienzo hasta el margen en un lado");
  assert.ok(cerca(abajo, LIENZO.alto * (1 - MARGEN_ENCUADRE), 1e-6), "las piezas de piso se apoyan al pie del encuadre");
  assert.ok(cerca((izquierda + derecha) / 2, LIENZO.ancho / 2, 1e-6), "centrada en horizontal");
  // Antes: 0,286 del alto. Ahora la pieza más alta ocupa casi todo el lienzo.
  assert.ok(semi!.caja.height > 0.8, `el semiarco deja de ser diminuto (alto ${semi!.caja.height.toFixed(3)})`);
}

// Sin proporción conocida (blueprint anterior): se usa la del lienzo y solo se encuadra.
{
  const [semi] = reencuadrar([instancia("EST_01", SEMIARCO), instancia("EST_02", COLUMNA)], undefined, LIENZO);
  assert.ok(cerca(semi!.caja.height / semi!.caja.width, SEMIARCO.height / SEMIARCO.width, 1e-9), "sin proporción, la forma relativa al lienzo no cambia");
}

// Todo del techo: el encuadre se apoya arriba.
{
  const [techo] = reencuadrar([instancia("EST_01", { x: 0.2, y: 0.05, width: 0.6, height: 0.2 }, "techo")], 1.5, LIENZO);
  assert.ok(cerca(techo!.caja.y * LIENZO.alto, LIENZO.alto * MARGEN_ENCUADRE, 1e-6), "lo que cuelga queda arriba");
}

// Solo cajas del plan: ya están pensadas para el lienzo, no se tocan.
{
  const delPlan = [instancia("EST_01", { x: 0.1, y: 0.5, width: 0.2, height: 0.3 }, "piso", "plan")];
  assert.deepEqual(reencuadrar(delPlan, 0.66, LIENZO), delPlan);
}

// La proporción sale de la imagen de los elementos que el plan materializa.
{
  type Estructuras = Parameters<typeof proporcionDeLaFoto>[0];
  type Foto = NonNullable<Parameters<typeof proporcionDeLaFoto>[1]>;
  const foto = {
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"], aspect_ratio: 0.6667 }, { image_id: "REF_02", approved_roles: ["composition_reference"] }],
    elements: [{ element_id: "REF_01_E01", source_image_id: "REF_01" }, { element_id: "REF_02_E01", source_image_id: "REF_02" }],
  } as unknown as Foto;
  const con = (ids: string[]) => ids.map((id, i) => ({ estructura_id: `EST_0${i + 1}`, referencia_element_id: id })) as unknown as Estructuras;
  assert.equal(proporcionDeLaFoto(con(["REF_01_E01"]), foto), 0.6667);
  assert.equal(proporcionDeLaFoto(con(["REF_02_E01"]), foto), undefined, "una foto sin proporción no inventa una");
  assert.equal(proporcionDeLaFoto(con(["REF_01_E01", "REF_02_E01"]), foto), undefined, "dos fotos distintas no comparten encuadre");
  assert.equal(proporcionDeLaFoto(con(["REF_01_E01"]), undefined), undefined);
}

// El lienzo sigue la forma de la foto de referencia (2026-10-06): CASE-001 es una columna en una foto vertical y el
// lienzo 3:2 dejaba los lados vacíos, que FLUX llenaba con ramos inventados.
{
  assert.equal(aspectoMasCercano(320 / 480), "2:3");
  assert.equal(aspectoMasCercano(1.5), "3:2");
  assert.equal(aspectoMasCercano(1.05), "1:1");
  assert.equal(aspectoDeLaReferencia({ source_images: [{ aspect_ratio: 0.6667 }] }), "2:3", "foto vertical: lienzo vertical");
  assert.equal(aspectoDeLaReferencia({ source_images: [{ aspect_ratio: 1.5 }, { aspect_ratio: 0.66 }] }), undefined, "varias fotos: el llamador decide");
  assert.equal(aspectoDeLaReferencia({ source_images: [{}] }), undefined, "sin medida: el llamador decide");
  assert.equal(aspectoDeLaReferencia(undefined), undefined);
}

console.log("test-reencuadre-guia: OK");
