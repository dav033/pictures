import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { colorSempertex } from "../../src/components/guiado/color-sempertex";
import { fichaGlobo } from "../../src/components/guiado/ficha-globo";
import { leyendaDePieza } from "../../src/components/guiado/motor-pieza";
import { globosPorColor, lineaGlobo, piezasVistaDePlan } from "../../src/components/guiado/piezas-vista";
import { etiquetaColor, hexDeColor } from "../../src/components/guiado/ajuste/ajuste-plan-guiado";

/**
 * Probador (2026-10-06): el mismo color cambiaba de nombre y de tono según la sección (propuesta, tarjeta, tabla,
 * editor, materiales). Una sola fuente (`color-sempertex`): nombre de cliente + hex del catálogo Sempertex. Sin coste.
 *
 *   npx tsx scripts/test/test-color-sempertex-guiada.ts
 */

// Los tres casos del informe.
const azul = { titulo: "B2b Globo Latex Redondo Fashion Azul — R-12 / PAQUETE X 50", acabado: "fashion" };
const chipAzul = lineaGlobo({ color: "azul", tamano_codigo: "R-12", unidades: 10, ...azul })!;
assert.equal(chipAzul.etiqueta, "Azul");
assert.equal(chipAzul.hex, "#62b5e5", "el Azul 040 de Sempertex es azul claro");
assert.equal(colorSempertex("azul").hex, chipAzul.hex, "la propuesta pinta el mismo azul que la tarjeta");
assert.equal(hexDeColor("azul"), chipAzul.hex, "«Ajustar mi plan» también");
assert.equal(fichaGlobo({ nombre: azul.titulo, color: "azul" }).hex, chipAzul.hex, "y los materiales");

const lima = { titulo: "B2b Globo Latex Redondo Fashion Verde Lima — R-12 / PAQUETE X 50", acabado: "fashion" };
const chipLima = lineaGlobo({ color: "verde", tamano_codigo: "R-12", unidades: 10, ...lima })!;
assert.equal(chipLima.etiqueta, "Verde lima", "no «Fashion Verde Lima» en la tarjeta ni «Verde lima mate» en el editor");
assert.equal(chipLima.producto, "Fashion Verde Lima", "el producto queda para el detalle");
assert.equal(etiquetaColor("verde", lima), "Verde lima");

const plata = { titulo: "B2b Globo Latex Redondo Reflex Plata — R-12 / PAQUETE X 50", acabado: "reflex" };
const chipPlata = lineaGlobo({ color: "plateado", tamano_codigo: "R-12", unidades: 10, ...plata })!;
assert.equal(chipPlata.etiqueta, "Plata cromado", "no «Reflex Plata» / «Plateado cromado» / «reflex plata cromado»");
assert.equal(fichaGlobo({ nombre: plata.titulo, color: "plateado" }).hex, chipPlata.hex);
assert.equal(colorSempertex("plateado").nombre, "Plata", "sin producto elegido, solo el tono (sin inventar el acabado)");

// En los planes reales de la biblioteca: chip, leyenda del editor y materiales dicen y pintan lo mismo.
const ANALISIS = path.join(process.cwd(), "data", "biblioteca-real", "analisis");
let comparados = 0;
for (const archivo of readdirSync(ANALISIS).filter((nombre) => nombre.endsWith(".plan.json"))) {
  const crudo = JSON.parse(readFileSync(path.join(ANALISIS, archivo), "utf8")) as { plan_resuelto?: Record<string, unknown> };
  const leido = PlanGuiadoSchema.safeParse({ ...crudo.plan_resuelto, approval_token: "prueba" });
  if (!leido.success) continue;
  const plan = leido.data;
  for (const pieza of piezasVistaDePlan(plan)) {
    const declarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === pieza.id)!;
    const crudas = (plan.estructuras.find((estructura) => estructura.estructura_id === pieza.id)?.lineas ?? []) as unknown as Array<{ product_id: string; color: string | null; acabado: string | null; titulo: string; unidades: number; tamano_codigo?: string | null }>;
    leyendaDePieza(plan, pieza.id).forEach((entrada, indice) => {
      const material = declarada.materiales[indice];
      // El chip de ESE material: la línea de su producto (dos rosados distintos, Fashion y Pastel Dusk, son dos chips).
      const cruda = crudas.find((linea) => linea.product_id === material?.product_id && linea.color === material?.color);
      const chip = cruda ? lineaGlobo({ ...cruda, unidades: Math.max(1, cruda.unidades) }) : null;
      if (!material?.color || !chip?.producto) return;
      assert.equal(entrada.etiqueta, chip.etiqueta, `${archivo} ${pieza.id}: editor y chip nombran igual el ${material.color} (${chip.producto})`);
      assert.equal(entrada.hex, chip.hex, `${archivo} ${pieza.id}: editor y chip pintan igual el ${material.color}`);
      if (entrada.muestra.fondo.startsWith("#")) assert.equal(entrada.muestra.fondo, chip.hex, "la muestra del editor también");
      assert.equal(fichaGlobo({ nombre: cruda!.titulo, color: material.color }).hex, chip.hex, `${archivo}: materiales y chip pintan igual ${chip.producto}`);
      comparados += 1;
    });
    assert.ok(globosPorColor(pieza.lineas).every((globo) => !globo.producto || globo.etiqueta !== globo.producto), "los chips dicen el nombre del cliente, no el del producto");
  }
}
assert.ok(comparados > 0, "se compararon colores de planes reales");
console.log(`test-color-sempertex-guiada: un solo nombre y un solo tono por color (${comparados} colores de planes reales comparados)`);
