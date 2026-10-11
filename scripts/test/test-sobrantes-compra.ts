/**
 * CUS-14: lo que sobra de una compra es lo que traen los paquetes menos lo que el plan necesita, y eso se cumple por línea, por
 * color y tamaño y en todo el plan. Sirve con cualquier regla de reserva: la identidad no depende de cuántos globos de más se
 * decidió comprar, solo de que la cotización no invente ni esconda ninguno. Muestra: las 28 ideas guardadas y las estructuras
 * oficiales que el motor arma (14 de las 18; el resto cae a Python y no tiene cotización del motor), cotizadas con las dos políticas de paquetes y con el doble de Python (sin red).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-sobrantes-compra.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido, POLITICAS_PAQUETES } from "../../src/lib/globos3d/motor/v1";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

const cruce = crosswalkIncluido();
const armables = todosLosCasos().flatMap((caso) => {
  const resultado = armarDesdeEspec(caso.espec);
  return resultado.noRepresentable.length ? [] : [{ id: caso.id, bom: resultado.bom }];
});

test("la muestra: las ideas y las estructuras que el motor arma", () => {
  assert.ok(armables.length >= 30, `${armables.length} planes armables`);
});

for (const politica of POLITICAS_PAQUETES) {
  test(`política ${politica}: sobrante = paquetes × unidades − necesario, por línea, por color y tamaño y en todo el plan`, async () => {
    let lineasVistas = 0;
    let cotizados = 0;
    for (const { id, bom } of armables) {
      const cotizada = await cotizarBom(bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista, politica });
      // Lo que la tienda no cubre (o pasa del tope de líneas) cae a Python y no tiene cotización del motor que revisar.
      if (!cotizada.ok) continue;
      cotizados += 1;
      const { lineas } = cotizada.cotizacion;

      const porColorYTamano = new Map<string, { compradas: number; necesarias: number; sobrante: number }>();
      for (const linea of lineas) {
        const paquetes = linea.paquetes ?? 0;
        const unidades = linea.unidadesPaquete ?? 0;
        const compradas = paquetes * unidades;
        assert.ok(paquetes >= 1 && unidades >= 1, `${id}/${linea.id}: una línea sin paquetes no se cotiza`);
        assert.equal(linea.purchaseQuantity, compradas, `${id}/${linea.id}: lo que traen los paquetes`);
        assert.equal(linea.sobrante, compradas - linea.cantidadNecesaria, `${id}/${linea.id}: sobrante = paquetes × unidades − necesario`);
        assert.ok((linea.sobrante ?? 0) >= 0, `${id}/${linea.id}: nunca sobra menos de cero`);
        const clave = `${linea.color ?? "sin color"} · ${linea.tamano}`;
        const acumulado = porColorYTamano.get(clave) ?? { compradas: 0, necesarias: 0, sobrante: 0 };
        porColorYTamano.set(clave, { compradas: acumulado.compradas + compradas, necesarias: acumulado.necesarias + linea.cantidadNecesaria, sobrante: acumulado.sobrante + (linea.sobrante ?? 0) });
        lineasVistas += 1;
      }

      for (const [clave, grupo] of porColorYTamano) assert.equal(grupo.sobrante, grupo.compradas - grupo.necesarias, `${id}: «${clave}» sobra lo que compra menos lo que necesita`);
      const compradas = [...porColorYTamano.values()].reduce((suma, g) => suma + g.compradas, 0);
      const necesarias = [...porColorYTamano.values()].reduce((suma, g) => suma + g.necesarias, 0);
      assert.equal(lineas.reduce((suma, l) => suma + (l.sobrante ?? 0), 0), compradas - necesarias, `${id}: en todo el plan`);
      assert.equal(necesarias, bom.total.reduce((suma, l) => suma + l.cantidad, 0), `${id}: lo necesario es lo que cuenta el motor, ninguna reserva escondida`);

      // Lo mismo en las compras del motor, de donde sale la cotización.
      for (const compra of cotizada.compras) assert.equal(compra.sobrante, compra.paquetes * compra.unidadesPaquete - compra.cantidad, `${id}/${compra.variante.variantId}: la compra`);
    }
    assert.ok(cotizados >= 30, `${cotizados} planes cotizados`);
    assert.ok(lineasVistas > cotizados, `${lineasVistas} líneas revisadas`);
  });
}
