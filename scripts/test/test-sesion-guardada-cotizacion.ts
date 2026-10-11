/**
 * D-035: la sesión que la vista guiada guarda en el navegador se lee con esquemas ESTRICTOS, así que un despliegue y el siguiente tienen
 * que entenderse en las dos direcciones durante el cambio (una pestaña vieja con un servidor nuevo, y una vuelta atrás con
 * conversaciones guardadas). Esta prueba ata lo que cambió con D-038 (la lista curada se cotiza con el cotizador único y puede dejar
 * algo «no incluido en el precio»):
 * 1. Una sesión guardada por origin/main (59a06582: `fixtures/sesion-guiada-main/sesion-con-cotizacion.json`, con su tarjeta de
 *    precio de una idea sin plan) se lee con el esquema de ahora.
 * 2. Lo que escribe el despliegue de ahora —el widget de precio con la cotización de una idea curada, con y sin algo fuera del precio—
 *    lo lee el esquema de origin/main (una copia congelada de su `CotizacionGuiadaSchema`): ninguna clave nueva en lo que se guarda;
 *    la nota de «no incluido» viaja aparte (`datos.noIncluidos`, solo en memoria).
 * 3. El esquema de la cotización es, campo por campo, el de origin/main (si alguien le suma una clave, esto falla y manda a leer D-035).
 * 4. Un `noIncluidos` malformado del turno se descarta solo (`.catch`): el precio se pinta igual.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-sesion-guardada-cotizacion.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { EstadoGuardadoSchema } from "../../src/components/guiado/estado-guardado";
import { decoracionesSempertex } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { CotizacionGuiadaSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { crosswalkIncluido } from "../../src/lib/globos3d/motor/v1";
import { costearDecoracion, type DependenciasCosteo } from "../../src/lib/guiada-motor/costear-idea";
import { cotizarListaCurada } from "../../src/lib/guiada-motor/cotizar-curada";
import { NoIncluidosSchema } from "../../src/lib/guiada-motor/no-incluidos";
import { PALETA_COLORES_V2 } from "../../src/lib/rag/taxonomy/v2";
import { WidgetGuiadoSchema } from "../../src/lib/ia/guiado/widgets";
import { presentacionesDeImpresos, variantesDeImpresos } from "../lib/presentaciones-impresos";
import { pythonDoble } from "../lib/python-doble-precio";

/** Copia congelada de `CotizacionGuiadaSchema` en origin/main (59a06582): lo que un despliegue anterior acepta, ni una clave más. */
const CotizacionDeMain = z.object({
  lineas: z.array(z.object({ id: z.string(), tamano: z.string(), color: z.enum(PALETA_COLORES_V2).optional(), cantidadNecesaria: z.number().int().positive(), disponible: z.boolean(), varianteId: z.string(), nombre: z.string(), precioPaquete: z.number().int().positive(), unidadesPaquete: z.number().int().positive(), paquetes: z.number().int().positive(), subtotal: z.number().int().positive(), sobrante: z.number().int().nonnegative() }).strict()).min(1),
  total: z.number().int().positive(),
  mermaPorcentaje: z.number().min(0).max(100), incluyeIva: z.literal(true), complementosSoportados: z.literal(false),
}).strict();

const RAIZ = path.resolve(__dirname, "..", "..");
const cruce = crosswalkIncluido();
const doble = pythonDoble(cruce, { variantesExtra: variantesDeImpresos() });
const nada = () => undefined;
const IDEA = "ej-bautizo-comunion";

const dependencias = (conCatalogo: boolean): DependenciasCosteo => ({
  leerMotor: async () => "3d", tienePlanGuardado: async () => false,
  cotizarConMotor: async () => { throw new Error("sin plan no hay motor"); }, cotizarConPython: async () => { throw new Error("sin plan no hay Python"); },
  cotizarCurada: (materiales) => cotizarListaCurada(materiales, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista, presentaciones: conCatalogo ? presentacionesDeImpresos : async () => [] }),
  auditar: nada,
});

async function main(): Promise<void> {
  // 1. Lo que guardó main se lee con el esquema de ahora.
  const guardada = JSON.parse(readFileSync(path.join(RAIZ, "scripts", "test", "fixtures", "sesion-guiada-main", "sesion-con-cotizacion.json"), "utf8")) as unknown;
  const leida = EstadoGuardadoSchema.safeParse(guardada);
  assert.ok(leida.success, leida.success ? "" : JSON.stringify(leida.error.issues.slice(0, 3)));
  assert.equal(leida.data.mensajes.flatMap((mensaje) => mensaje.widgets ?? []).filter((widget) => widget.tipo === "cotizacion").length, 1, "la tarjeta de precio sigue ahí");
  assert.ok(CotizacionDeMain.safeParse((guardada as { mensajes: Array<{ widgets?: Array<{ cotizacion?: unknown }> }> }).mensajes[3]!.widgets![0]!.cotizacion).success, "y es una cotización de main (la fixture es fiel)");
  console.log("[PASS] una sesión guardada por origin/main se lee con el esquema de ahora");

  // 2. Lo que escribe el despliegue de ahora lo lee el de main.
  const idea = decoracionesSempertex.find((d) => d.id === IDEA)!;
  const materiales = idea.materiales.map((m) => ({ variantId: m.variantId, cantidad: m.cantidad, ...(m.nota ? { nota: m.nota } : {}) }));
  for (const [caso, conCatalogo] of [["con todo cotizado", true], ["con un impreso fuera del precio", false]] as const) {
    const costeo = await costearDecoracion({ id: IDEA, materiales }, "personal", dependencias(conCatalogo));
    assert.ok(costeo.cotizacion, `${caso}: hay precio`);
    assert.equal(costeo.noIncluidos !== undefined, !conCatalogo, `${caso}: la nota solo cuando algo quedó fuera`);
    const sesion = { ...(guardada as Record<string, unknown>), mensajes: [{ id: "m1", role: "assistant", content: "Los materiales suman", widgets: [{ tipo: "cotizacion", cotizacion: costeo.cotizacion, uso: "personal", decoracion: idea }] }] };
    const guardadaHoy = JSON.parse(JSON.stringify(sesion)) as typeof sesion;
    assert.ok(EstadoGuardadoSchema.safeParse(guardadaHoy).success, `${caso}: el esquema de ahora lee lo que escribe`);
    const widget = guardadaHoy.mensajes[0]!.widgets[0]!;
    assert.ok(CotizacionDeMain.safeParse(widget.cotizacion).success, `${caso}: el esquema de main lee la cotización que se guarda: ${JSON.stringify(CotizacionDeMain.safeParse(widget.cotizacion).error?.issues.slice(0, 2))}`);
    assert.ok(!JSON.stringify(guardadaHoy).includes("noIncluidos"), `${caso}: la nota no se guarda en la sesión`);
    assert.ok(WidgetGuiadoSchema.safeParse(widget).success);
  }
  console.log("[PASS] lo que escribe el despliegue de ahora (con y sin algo fuera del precio) lo lee el esquema de origin/main");

  // 3. El esquema no ganó claves.
  assert.deepEqual(z.toJSONSchema(CotizacionGuiadaSchema), z.toJSONSchema(CotizacionDeMain), "CotizacionGuiadaSchema es el de origin/main: una clave nueva descartaría la conversación a un despliegue anterior (D-035)");
  console.log("[PASS] CotizacionGuiadaSchema es, campo por campo, el de origin/main");

  // 4. La nota del turno malformada no tumba el precio.
  assert.deepEqual(NoIncluidosSchema.parse([{ nombre: "Globo", cantidad: 2 }]), [{ nombre: "Globo", cantidad: 2 }]);
  assert.equal(NoIncluidosSchema.parse(undefined), undefined);
  for (const mala of [[{ nombre: "", cantidad: 2 }], [{ nombre: "Globo", cantidad: 0 }], [{ nombre: "Globo", cantidad: 1, otra: 1 }], "no es una lista", [3]]) assert.equal(NoIncluidosSchema.parse(mala), undefined, `se descarta: ${JSON.stringify(mala)}`);
  console.log("[PASS] una nota «no incluido» malformada se descarta sola");

  console.log("\ntest-sesion-guardada-cotizacion: ok");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
