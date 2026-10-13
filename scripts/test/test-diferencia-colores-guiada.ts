import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { avisoEnCurso, type CambioPlan, type PlanGuiado } from "@/components/guiado/ajuste/ajuste-plan-guiado";
import { confirmacionCambioHecho, diferenciaCambioColor } from "@/components/guiado/ajuste/diferencia-colores";
import { avisoEdicionChat, ejecutarEdicionChat, type DependenciasEdicionChat } from "@/components/guiado/ajuste/edicion-chat-guiada";
import { hacerCambioDelPanel } from "@/components/guiado/ajuste/usarAjustePlanGuiado";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { fraseDelPedido, type PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";
import { planConColorReemplazado } from "@/lib/plan/ajuste-estructural";

/**
 * REQ-015 D4 (juez 2026-10-11): al cambiar un color, el aviso decía «medidas y demás colores quedaron igual» aunque
 * Python, al volver a contar, le quitó 3 globos a cada uno de otros tres colores (36→33, 36→33, 22→19) y el color nuevo
 * quedó con 20 en lugar de los 11 del que reemplazó. La confirmación (la misma del panel «Cambiar» y del chat) dice la
 * diferencia real por color y el precio; «igual» solo si no se movió ninguna cifra. Sin red ni modelo: el plan real del
 * registro dgkw9b y dobles de /api/plan-editar.
 */

const base = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const NARANJA = "8634000000777";
const AZUL = "8634239385895";
const cambio: Extract<CambioPlan, { tipo: "reemplazar-color" }> = { tipo: "reemplazar-color", color: "azul", globo: { productId: NARANJA, color: "naranja", variantIds: ["n5", "n9", "n12"], nombre: "Fashion Naranja" } };

const LineaSchema = z.object({ product_id: z.string(), unidades: z.number(), diam_pulg: z.number() }).passthrough();

/**
 * El plan que devolvería Python: el azul pasa a naranja en su mismo lugar; `extra` suma globos a la primera línea
 * naranja y `quitar` resta de la primera línea de cada uno de los otros colores del semiarco (como lo hizo en el juez).
 */
function despuesDe(plan: PlanGuiado, extra: number, quitar: number): PlanGuiado {
  const entrada = planConColorReemplazado(plan.plan, { color: "azul" }, { product_id: NARANJA, color: "naranja", acabadoMotor: "mate" }).plan;
  const vistos = new Set<string>();
  const estructuras = plan.estructuras.map((estructura) => ({
    ...estructura,
    lineas: (estructura.lineas ?? []).map((cruda) => {
      const linea = LineaSchema.parse(cruda);
      const primera = !vistos.has(`${estructura.estructura_id}|${linea.product_id}`);
      vistos.add(`${estructura.estructura_id}|${linea.product_id}`);
      if (linea.product_id === AZUL) {
        return { ...linea, product_id: NARANJA, color: "naranja", variant_id: `n${linea.diam_pulg}`, titulo: `B2b Globo Latex Redondo Fashion Naranja — R-${linea.diam_pulg}`, unidades: linea.unidades + (primera && estructura.estructura_id.startsWith("EST_01") ? extra : 0) };
      }
      return primera && estructura.estructura_id.startsWith("EST_01") ? { ...linea, unidades: linea.unidades - quitar } : linea;
    }),
  }));
  return PlanGuiadoSchema.parse({ ...plan, plan: entrada, estructuras, plan_hash: "f".repeat(64) });
}

const cotizacion = (total: number) => ({ total, incluyeIva: true, lineas: [] });

// --- 1. La diferencia por color, pura ------------------------------------------------------------------------------
const igual = despuesDe(base, 0, 0);
const movido = despuesDe(base, 9, 3);
const sinCambios = diferenciaCambioColor(base, igual, cambio);
assert.equal(sinCambios.anterior.globos, 40, "el azul tenía 40 globos (5 + 3 + 12 en el semiarco y 20 en las columnas)");
assert.equal(sinCambios.nuevo.globos, 40, "el naranja toma su lugar con los mismos 40");
assert.deepEqual(sinCambios.otros, [], "ningún otro color se movió");
const conCambios = diferenciaCambioColor(base, movido, cambio);
assert.equal(conCambios.nuevo.globos, 49, "el naranja quedó con 49 (9 más que el azul)");
assert.deepEqual(conCambios.otros.map(({ antes, despues }) => [antes, despues]), [[36, 33], [36, 33], [39, 36]], "plata, blanco y rosado perdieron 3 cada uno");
assert.ok(conCambios.otros.every((otro) => otro.color.length > 0 && !/azul|naranja/i.test(otro.color)), "los otros colores no repiten el que cambió");

// --- 2. La confirmación: «igual» solo si no se movió nada; si se movió, la cifra real y el precio ----------------------
const confirmacionIgual = confirmacionCambioHecho(base, cambio, undefined, igual, { antes: cotizacion(176591), despues: cotizacion(176591) });
assert.match(confirmacionIgual, /^Listo: Fashion Naranja en lugar de azul/, confirmacionIgual);
assert.match(confirmacionIgual, /40 globos, los mismos que tenía/, confirmacionIgual);
assert.match(confirmacionIgual, /los demás colores quedaron igual/, confirmacionIgual);

const confirmacionMovida = confirmacionCambioHecho(base, cambio, undefined, movido, { antes: cotizacion(176591), despues: cotizacion(163038) });
assert.doesNotMatch(confirmacionMovida, /igual/i, `con cifras movidas nunca dice «igual»: ${confirmacionMovida}`);
assert.match(confirmacionMovida, /Fashion Naranja lleva 49 globos \(.+ tenía 40\)/, confirmacionMovida);
assert.match(confirmacionMovida, /33 \(antes 36\).*33 \(antes 36\).*36 \(antes 39\)/, confirmacionMovida);
assert.match(confirmacionMovida, /pasan de \$\s?176\.591 a \$\s?163\.038/, `dice el cambio de precio: ${confirmacionMovida}`);
assert.doesNotMatch(confirmacionMovida, /\bR-\d|armad|motor|participaci|plan_hash/i, "sin palabras del motor");

// Solo en una pieza: dice dónde (el color viejo sigue en las demás) y cuenta solo esa pieza.
const COLUMNA = base.plan.estructuras[1]!.estructura_id;
const enColumna = { ...cambio, estructuraIds: [COLUMNA] };
const despuesColumna = (() => {
  const entrada = planConColorReemplazado(base.plan, { color: "azul", estructuras: new Set([COLUMNA]) }, { product_id: NARANJA, color: "naranja", acabadoMotor: "mate" }).plan;
  const estructuras = base.estructuras.map((estructura) => (estructura.estructura_id !== COLUMNA ? estructura : {
    ...estructura,
    lineas: (estructura.lineas ?? []).map((cruda) => {
      const linea = LineaSchema.parse(cruda);
      return linea.product_id === AZUL ? { ...linea, product_id: NARANJA, color: "naranja", titulo: "B2b Globo Latex Redondo Fashion Naranja — R-12", unidades: linea.unidades + 4 } : linea;
    }),
  }));
  return PlanGuiadoSchema.parse({ ...base, plan: entrada, estructuras, plan_hash: "c".repeat(64) });
})();
const parcial = diferenciaCambioColor(base, despuesColumna, enColumna, [COLUMNA]);
assert.equal(parcial.anterior.globos, 20, "solo el azul de las columnas");
assert.equal(parcial.nuevo.globos, 24);
assert.deepEqual(parcial.otros, [], "el azul del semiarco no cuenta como «otro color» movido");
const confirmacionParcial = confirmacionCambioHecho(base, enColumna, [COLUMNA], despuesColumna, {});
assert.match(confirmacionParcial, /^Listo: Fashion Naranja en lugar de azul en .*columna.*; las medidas no cambiaron\. .*24 globos \(azul tenía 20\)/, confirmacionParcial);
assert.doesNotMatch(confirmacionParcial, /igual/i, confirmacionParcial);

// El precio: en el negocio no se dice una cifra personal; sin cotización nueva no se inventa; sin la de antes, la nueva.
assert.doesNotMatch(confirmacionCambioHecho(base, cambio, undefined, movido, { antes: cotizacion(176591), despues: cotizacion(163038), uso: "negocio" }), /\$|materiales/i, "uso negocio: sin precio personal");
assert.doesNotMatch(confirmacionCambioHecho(base, cambio, undefined, movido, { antes: cotizacion(176591), despues: null }), /\$/, "sin cotización nueva no hay precio");
assert.match(confirmacionCambioHecho(base, cambio, undefined, movido, { despues: cotizacion(163038) }), /quedan en \$\s?163\.038\.$/);

const soloElNuevo = confirmacionCambioHecho(base, cambio, undefined, despuesDe(base, 9, 0), {});
assert.doesNotMatch(soloElNuevo, /igual/i, `si cambió la cifra del color nuevo tampoco dice «igual»: ${soloElNuevo}`);
assert.match(soloElNuevo, /49 globos \(.+ tenía 40\)/, soloElNuevo);

// --- 3. Antes de saber lo que quedó, ningún aviso promete que los demás colores quedan igual --------------------------
assert.doesNotMatch(avisoEnCurso(base, cambio), /igual/i, avisoEnCurso(base, cambio));
const pedido: PedidoEdicionPlan = { tipo: "reemplazar_color", color: "azul", colorNuevo: "naranja", piezas: [] };
assert.doesNotMatch(avisoEdicionChat(pedido), /igual/i, avisoEdicionChat(pedido));
assert.doesNotMatch(fraseDelPedido(pedido), /igual/i, fraseDelPedido(pedido));

// --- 4. El panel «Cambiar» y el chat dicen lo mismo (una sola función) -----------------------------------------------
async function probarCaminos(): Promise<void> {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ plan: movido, cotizacion: cotizacion(163038), piezas: movido.plan.estructuras.map((estructura) => estructura.estructura_id) }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    const delPanel = await hacerCambioDelPanel(cambio, base, { cotizacionAntes: cotizacion(176591) });
    assert.equal(delPanel.confirmacion, confirmacionCambioHecho(base, cambio, delPanel.nuevo.piezas, movido, { antes: cotizacion(176591), despues: cotizacion(163038) }), "el panel usa la confirmación con la diferencia");
    assert.doesNotMatch(delPanel.confirmacion, /igual/i, delPanel.confirmacion);
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const candidato = { productId: NARANJA, titulo: "B2b Globo Latex Redondo Fashion Naranja", imagen: null, variantes: [5, 9, 12].map((diam) => ({ variantId: `n${diam}`, titulo: `R-${diam}`, disponible: true, codigoTamano: `R-${diam}`, diamPulg: diam, forma: "redondo", colores: ["naranja"] })) };
  const fallar = async (): Promise<never> => { throw new Error("no se usa en esta prueba"); };
  const dependencias: DependenciasEdicionChat = {
    buscarGlobos: async () => [candidato],
    reemplazarColor: async () => ({ plan: movido, cotizacion: cotizacion(163038), piezas: movido.plan.estructuras.map((estructura) => estructura.estructura_id) }),
    aplicar: fallar,
    quitarPieza: fallar,
    agregarColor: fallar,
  };
  const delChat = await ejecutarEdicionChat(base, pedido, dependencias, { cotizacionAntes: cotizacion(176591) });
  assert.doesNotMatch(delChat.confirmacion, /igual/i, delChat.confirmacion);
  assert.match(delChat.confirmacion, /lleva 49 globos/, delChat.confirmacion);
  assert.match(delChat.confirmacion, /33 \(antes 36\)/, delChat.confirmacion);
  assert.match(delChat.confirmacion, /pasan de \$\s?176\.591 a \$\s?163\.038/, delChat.confirmacion);
}

probarCaminos()
  .then(() => console.log("diferencia-colores-guiada: OK"))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
