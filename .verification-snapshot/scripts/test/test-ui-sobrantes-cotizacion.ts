/**
 * CUS-14: lo que sobra se lee en la cotización, por color y tamaño, con las cifras de la compra. Los componentes reales renderizan
 * los sobres del motor 3D (cotizados con el doble de Python, sin red):
 * - la tarjeta del cliente («Materiales para tu decoración») dice, en cada fila, cuántos globos usas, cuántos paquetes compras de
 *   cuántos y cuántos te sobran, y esos tres números cierran: sobran = paquetes × globos por paquete − los que usas;
 * - la cotización del decorador (globos a granel) imprime por variante «Por paquete: P de U y te sobrarían K» con las cifras que
 *   le da Python (`sobrante_paquetes`, cuya fórmula prueba el lado de Python en `test_cotizacion_granel.py`); aquí se fija que
 *   los paquetes, los globos por paquete y K de la fila son los del plan y que sin sobrante no se dice nada.
 * No fija la frase de reserva del pie de la tarjeta (esa regla y su texto cambian con el precio único, D-038): solo las cifras por fila.
 *
 * Run: npx tsx scripts/test/test-ui-sobrantes-cotizacion.ts   (sin --conditions: renderiza componentes)
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { CotizacionPersonalGuiada } from "@/components/guiado/CotizacionPersonalGuiada";
import { titulosDelPlan } from "@/components/guiado/piezas-vista";
import { MaterialesGranel } from "@/components/cotizacion/MaterialesGranel";
import { materialesDesdeCotizacion } from "@/lib/cotizacion/borrador-profesional";
import { granelVacio, leerGranel, unidadesDesdeCotizacion } from "@/lib/cotizacion/granel";
import type { CotizacionProfesionalResultado } from "@/lib/cotizacion/profesional";

type Sobre = { id: string; plan: unknown; cotizacion: unknown };
type LineaResultado = CotizacionProfesionalResultado["materiales"]["lineas"][number];

let casos = 0;
function caso(nombre: string, prueba: () => void): void {
  try { prueba(); casos += 1; console.log(`[PASS] ${nombre}`); } catch (error) { console.error(`[FAIL] ${nombre}`); throw error; }
}

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
const entero = (cifra: string): number => Number(cifra.replaceAll(".", ""));
const sobres: Sobre[] = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test/datos-plan-motor3d.ts"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as Sobre[];

/** La fila de una variante tal como la dice la tarjeta: «Usas 6 globos · compras 1 paquete de 20 · te sobran 14». */
const FILA = /Usas ([\d.]+) \S+ · compras ([\d.]+) paquetes? de ([\d.]+)(?: · te sobran ([\d.]+))?/g;

caso("la tarjeta del cliente: en cada fila, sobran = paquetes × globos por paquete − los que usas, para toda la muestra de planes", () => {
  assert.ok(sobres.length >= 30, `${sobres.length} planes`);
  let filas = 0;
  for (const s of sobres) {
    const cotizacion = CotizacionPlanGuiadoSchema.parse(s.cotizacion);
    const plan = PlanGuiadoSchema.parse(s.plan);
    const t = texto(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: cotizacion as never, titulos: titulosDelPlan(plan) })));
    const dichas = [...t.matchAll(FILA)].map(([, usas, paquetes, porPaquete, sobran]) => ({ usas: entero(usas!), paquetes: entero(paquetes!), porPaquete: entero(porPaquete!), sobran: sobran ? entero(sobran) : 0 }));
    for (const fila of dichas) assert.equal(fila.sobran, fila.paquetes * fila.porPaquete - fila.usas, `${s.id}: ${JSON.stringify(fila)}`);

    // Lo que dice la tarjeta es lo que cotizó el motor, variante por variante (una fila por variante del catálogo).
    const porVariante = new Map<string, { usas: number; paquetes: number; porPaquete: number; sobran: number }>();
    for (const linea of cotizacion.lineas) {
      const id = linea.varianteId ?? linea.id;
      const previa = porVariante.get(id);
      porVariante.set(id, { usas: (previa?.usas ?? 0) + linea.cantidadNecesaria, paquetes: (previa?.paquetes ?? 0) + (linea.paquetes ?? 0), porPaquete: linea.unidadesPaquete ?? 0, sobran: (previa?.sobran ?? 0) + (linea.sobrante ?? 0) });
    }
    const clave = (f: { usas: number; paquetes: number; porPaquete: number; sobran: number }) => `${f.usas}|${f.paquetes}|${f.porPaquete}|${f.sobran}`;
    assert.deepEqual(dichas.map(clave).sort(), [...porVariante.values()].map(clave).sort(), `${s.id}: la tarjeta dice lo que cotizó el motor`);
    filas += dichas.length;
  }
  assert.ok(filas > sobres.length, `${filas} filas revisadas`);
});

caso("la tarjeta del cliente nombra cada fila por color y tamaño, y lo que sobra va en la fila de ese color y tamaño", () => {
  const s = sobres.find((x) => x.id.startsWith("idea-deco-real-07"))!;
  const cotizacion = CotizacionPlanGuiadoSchema.parse(s.cotizacion);
  const t = texto(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: cotizacion as never, titulos: titulosDelPlan(PlanGuiadoSchema.parse(s.plan)) })));
  // «Sempertex Reflex Dorado de 5" Usas 6 globos · compras 1 paquete de 20 · te sobran 14»: el nombre trae el color y la medida.
  const dorado5 = cotizacion.lineas.find((l) => l.color === "dorado" && l.diamPulg === 5)!;
  assert.ok(new RegExp(`Dorado de 5" Usas ${dorado5.cantidadNecesaria} globos · compras ${dorado5.paquetes} paquete de ${dorado5.unidadesPaquete} · te sobran ${dorado5.sobrante}`).test(t), "dorado de 5″");
  // Una fila sin sobrante, buscada en la muestra: con los repuestos por globo (D-038) cuál es cambia con la compra.
  const sinSobrante = sobres
    .map((x) => ({ x, c: CotizacionPlanGuiadoSchema.parse(x.cotizacion) }))
    .flatMap(({ x, c }) => c.lineas.filter((l) => l.sobrante === 0).map((l) => ({ x, c, l })))[0];
  assert.ok(sinSobrante, "alguna fila de la muestra no tiene sobrante");
  const t0 = texto(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: sinSobrante.c as never, titulos: titulosDelPlan(PlanGuiadoSchema.parse(sinSobrante.x.plan)) })));
  const l0 = sinSobrante.l;
  const paquete = l0.paquetes === 1 ? "paquete" : "paquetes";
  assert.ok(new RegExp(`Usas ${l0.cantidadNecesaria} globos · compras ${l0.paquetes} ${paquete} de ${l0.unidadesPaquete} \\$`).test(t0), "sin sobrante, la fila no dice «te sobran»");
});

/** Lo que devuelve Python para los globos a granel de una variante (`cotizacion_profesional.py`: sobra la capacidad de los paquetes menos los globos del plan); el doble de la prueba. */
function granelDePython(unidadesPlan: number, porPaquete: number, paquetes: number, precioPaquete: number): NonNullable<LineaResultado["granel"]> {
  const base = Math.round(precioPaquete / porPaquete);
  return {
    unidades_plan: unidadesPlan, unidades_extra: 0, unidades: unidadesPlan, unidades_paquete: porPaquete, precio_unidad_base_cop: base, precio_unidad_estimado: porPaquete > 1,
    precio_unidad_cop: base, precio_unidad_editado: false, subtotal_cop: base * unidadesPlan, sobrante_paquetes: Math.max(0, paquetes * porPaquete - unidadesPlan),
  };
}

caso("la cotización del decorador (a granel) dice por variante «Por paquete: P de U y te sobrarían K» con las cifras de su plan, y el total lo repite", () => {
  let variantes = 0;
  for (const id of ["idea-deco-real-07", "oficial-columna", "oficial-arco", "oficial-guirnalda", "oficial-semiarco"]) {
    const s = sobres.find((x) => x.id.startsWith(id))!;
    const cotizacion = CotizacionPlanGuiadoSchema.parse(s.cotizacion);
    const { materiales } = materialesDesdeCotizacion(cotizacion);
    const unidades = unidadesDesdeCotizacion(cotizacion, materiales)!;
    const lineas = new Map<string, LineaResultado>(materiales.map((m) => {
      const u = unidades[m.variant_id]!;
      return [m.variant_id, { variant_id: m.variant_id, descripcion: m.descripcion, paquetes: m.paquetes, precio_paquete_catalogo_cop: m.precio_paquete_catalogo_cop, precio_paquete_cop: m.precio_paquete_catalogo_cop, precio_editado: false, subtotal_cop: m.paquetes * m.precio_paquete_catalogo_cop, granel: granelDePython(u.unidades_plan, u.unidades_paquete, m.paquetes, m.precio_paquete_catalogo_cop) }];
    }));
    const sobranteTotal = [...lineas.values()].reduce((suma, l) => suma + l.granel!.sobrante_paquetes, 0);
    const html = renderToStaticMarkup(createElement(MaterialesGranel, {
      clave: id, materiales, unidades, borrador: granelVacio(), leido: leerGranel(granelVacio(), unidades, materiales), lineaDe: (v) => lineas.get(v) ?? null, atenuar: false,
      resumen: { unidades_plan: materiales.reduce((suma, m) => suma + unidades[m.variant_id]!.unidades_plan, 0), unidades_extra: 0, unidades: materiales.reduce((suma, m) => suma + unidades[m.variant_id]!.unidades_plan, 0), sobrante_paquetes: sobranteTotal, total_cop: 0 },
      totalPaquetes: 1000, onPrecio: () => undefined, onExtra: () => undefined,
    }));
    const filas = html.split(/<li[\s>]/).slice(1);
    assert.equal(filas.length, materiales.length, `${s.id}: una fila por variante`);
    materiales.forEach((material, k) => {
      const u = unidades[material.variant_id]!;
      const sobran = material.paquetes * u.unidades_paquete - u.unidades_plan;
      const fila = texto(filas[k]!);
      assert.ok(fila.includes(`${u.unidades_plan} del plan`), `${s.id}/${material.variant_id}: los globos del plan`);
      const dicho = /Por paquete: ([\d.]+) de ([\d.]+) y te sobrarían ([\d.]+)\./.exec(fila);
      if (sobran === 0) return assert.equal(dicho, null, `${s.id}/${material.variant_id}: sin sobrante no se dice`);
      assert.ok(dicho, `${s.id}/${material.variant_id}: falta «Por paquete…» (${fila})`);
      assert.deepEqual([entero(dicho[1]!), entero(dicho[2]!), entero(dicho[3]!)], [material.paquetes, u.unidades_paquete, sobran], `${s.id}/${material.variant_id}`);
      variantes += 1;
    });
    const pie = texto(html);
    if (sobranteTotal > 0) assert.ok(pie.includes(`te sobrarían ${sobranteTotal.toLocaleString("es-CO")} globos`), `${s.id}: el total de lo que sobra`);
  }
  assert.ok(variantes >= 5, `${variantes} variantes con sobrante`);
});

console.log(`test-ui-sobrantes-cotizacion: ok (${casos} casos, ${sobres.length} planes)`);
