/**
 * D-038, paridad entre la tarjeta de la vista guiada y el «Precio en la tienda» del Taller, para las 46 ideas del carrusel.
 * Sin red, sin base, sin IA: Python se sustituye por el doble que cotiza con los paquetes del cruce (`pythonDoble`).
 *
 * Para cada idea se toma la lista que la tarjeta cotiza de verdad (`costearDecoracion`, bandera en 3d) y se manda tal cual a
 * la ruta del Taller (`atenderCotizacionTaller`, con el mismo armado de pedido que `useCotizacionTaller`). Los dos totales
 * deben ser iguales al peso. Las ideas se reparten así, y la prueba falla si una idea cambia de camino sin que esta lista lo diga:
 * - `motor`: el motor arma el plan guardado de la idea; tarjeta y Taller dan el mismo total (se afirma);
 * - `python`: el motor no la arma (no representable o sin cobertura), así que la tarjeta cae al plan de Python de la idea
 *   guardada; el Taller no puede abrir esa idea, no hay lista que comparar (la paridad con Python la prueba
 *   `test-cotizacion-unica.ts` con la fixture compartida y la comprueban los pasos en vivo);
 * - `curada`: la idea no tiene plan guardado; la tarjeta cotiza su lista curada con el mismo cotizador (los globos que el Taller
 *   compraría: repuestos por globo y el paquete más barato) y el Taller recibe esos mismos globos: los totales son iguales
 *   (se afirma). Lo que el cruce con la tienda no conoce (un globo impreso) la tarjeta lo compra con los paquetes de su propio
 *   producto, con la misma regla; el Taller, que ni siquiera puede pedirlo (solo conoce los globos de la tabla de Sempertex), lo deja
 *   fuera: la tarjeta es el total del Taller más los impresos, que se calculan aparte con `comprarGlobo` sobre las filas del catálogo.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-paridad-tarjeta-taller.ts
 */
import assert from "node:assert/strict";
import { decoracionesSempertex } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { armarDesdeEspec, crosswalkIncluido, especDesdeIdeaGuardada, type BomLinea } from "../../src/lib/globos3d/motor/v1";
import { costearDecoracion } from "../../src/lib/guiada-motor/costear-idea";
import { comprarGlobo } from "../../src/lib/globos3d/motor/plan-de-compra";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { FILAS_IMPRESOS } from "../lib/presentaciones-impresos";
import { dependenciasDeLaTarjeta, totalDelTaller } from "../lib/precio-tarjeta-taller";

type Camino = "motor" | "python" | "curada";
/** `impresos`: lo que cuestan los globos que el Taller no puede pedir (la tarjeta los compra con los paquetes de su producto). */
type Resultado = { id: string; titulo: string; camino: Camino; tarjeta: number | null; taller: number | null; impresos: number; razon: string };
type MaterialCurado = { variantId: string; cantidad: number; nota?: string };

const cruce = crosswalkIncluido();
const pesos = (valor: number | null): string => (valor === null ? "-" : valor.toLocaleString("es-CO"));

function listaDelMotor(ideaId: string): { ok: true; lista: BomLinea[] } | { ok: false; razon: string } {
  const guardado = planGuardadoDeIdea(ideaId);
  if (!guardado) return { ok: false, razon: "sin plan guardado" };
  try {
    const armado = armarDesdeEspec(especDesdeIdeaGuardada(guardado.plan, ideaId).espec);
    if (armado.noRepresentable.length) return { ok: false, razon: `no representable: ${armado.noRepresentable.map((n) => n.motivo).join("; ")}` };
    return { ok: true, lista: armado.bom.total };
  } catch (error) {
    return { ok: false, razon: `el motor no la arma: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * La lista curada de una idea sin plan guardado, vista como globos del Taller: formato y código de cada variante de la tienda
 * que el cruce conoce. Lo que el cruce no conoce (un impreso) no es un globo que el Taller pueda pedir: queda aparte.
 */
function curadaComoGlobos(materiales: ReadonlyArray<MaterialCurado>): { globos: BomLinea[]; sinCruce: MaterialCurado[] } {
  const porVariante = new Map(Object.entries(cruce.entradas).flatMap(([clave, entrada]) => entrada.variantes.map((v) => [v.variantId, clave] as const)));
  const globos: BomLinea[] = [];
  const sinCruce: MaterialCurado[] = [];
  for (const material of materiales) {
    const clave = porVariante.get(material.variantId);
    if (!clave) { sinCruce.push(material); continue; }
    const [formatoId, codigo] = clave.split("|") as [string, string];
    globos.push({ formatoId, codigo, cantidad: material.cantidad });
  }
  return { globos, sinCruce };
}

/** Lo que cuestan los impresos: por producto, `comprarGlobo` sobre sus paquetes de 12 y de 50 (las filas del catálogo) y cada paquete a su precio. */
function totalDeImpresos(materiales: ReadonlyArray<MaterialCurado>): number {
  const porProducto = new Map<string, { cantidad: number; filas: typeof FILAS_IMPRESOS[number][] }>();
  for (const material of materiales) {
    const filas = FILAS_IMPRESOS.filter((fila) => fila.pedida === material.variantId);
    assert.ok(filas.length > 0, `${material.variantId}: las presentaciones del impreso están en la fixture`);
    const productId = filas[0]!.productId;
    porProducto.set(productId, { cantidad: (porProducto.get(productId)?.cantidad ?? 0) + material.cantidad, filas });
  }
  let total = 0;
  for (const { cantidad, filas } of porProducto.values()) {
    const compra = comprarGlobo(cantidad, filas.map((fila) => ({ variantId: fila.variantId, unidades: fila.unidadesPaq, precio: fila.precio })));
    assert.ok(compra, "los impresos tienen con qué comprarse");
    total += compra.cobertura.compras.reduce((suma, c) => suma + c.paquetes * c.precio, 0);
  }
  return total;
}

async function compararIdea(id: string, titulo: string, materiales: ReadonlyArray<MaterialCurado>): Promise<Resultado> {
  const tarjeta = await costearDecoracion({ id, materiales }, "personal", dependenciasDeLaTarjeta(cruce));
  const totalTarjeta = tarjeta.cotizacion?.total ?? null;
  const delMotor = listaDelMotor(id);
  if (delMotor.ok) {
    assert.equal(tarjeta.decision.usar, "motor", `${id}: el motor la arma, así que la tarjeta cotiza con el motor`);
    const taller = await totalDelTaller(delMotor.lista, cruce);
    return { id, titulo, camino: "motor", tarjeta: totalTarjeta, taller, impresos: 0, razon: "mismo BOM del motor, mismo cotizador" };
  }
  if (planGuardadoDeIdea(id)) {
    assert.equal(tarjeta.decision.usar, "sin_precio", `${id}: sin Python, la tarjeta no inventa otro precio`);
    return { id, titulo, camino: "python", tarjeta: null, taller: null, impresos: 0, razon: `la tarjeta cae al plan de Python (${delMotor.razon}); el Taller no abre esa idea` };
  }
  assert.equal(tarjeta.decision.usar, "curada", `${id}: sin plan guardado la tarjeta cotiza su lista curada`);
  const { globos, sinCruce } = curadaComoGlobos(materiales);
  assert.ok(globos.length > 0, `${id}: la lista curada trae algún globo que el cruce conoce`);
  const taller = await totalDelTaller(globos, cruce);
  assert.deepEqual(tarjeta.decision.usar === "curada" ? tarjeta.decision.fuera : null, [], `${id}: todo tiene precio, nada queda «no incluido»`);
  const impresos = totalDeImpresos(sinCruce);
  return { id, titulo, camino: "curada", tarjeta: totalTarjeta, taller, impresos, razon: sinCruce.length ? `los mismos globos del cruce y ${sinCruce.length} impreso(s) comprado(s) con los paquetes de su producto` : "los mismos globos, mismo cotizador" };
}

async function main(): Promise<void> {
  const resultados: Resultado[] = [];
  for (const idea of decoracionesSempertex) resultados.push(await compararIdea(idea.id, idea.titulo, idea.materiales.map((m) => ({ variantId: m.variantId, cantidad: m.cantidad, ...(m.nota ? { nota: m.nota } : {}) }))));
  assert.equal(resultados.length, 46, "las 46 ideas del carrusel");

  console.log("idea | camino | tarjeta | taller | impresos | por qué");
  for (const r of resultados) console.log(`${r.id} | ${r.camino} | ${pesos(r.tarjeta)} | ${pesos(r.taller)} | ${pesos(r.impresos)} | ${r.razon}`);

  const comparadas = resultados.filter((r) => r.camino !== "python");
  assert.ok(comparadas.filter((r) => r.camino === "motor").length >= 20, "al menos 20 ideas se comparan con el motor");
  assert.equal(comparadas.filter((r) => r.camino === "curada").length, 18, "las 18 ideas sin plan guardado se comparan con su lista curada");
  assert.equal(comparadas.filter((r) => r.impresos > 0).length, 8, "las 8 ideas de ejemplo con un impreso");
  const distintas = comparadas.filter((r) => r.tarjeta !== (r.taller ?? 0) + r.impresos);
  assert.deepEqual(distintas.map((r) => `${r.id}: tarjeta ${pesos(r.tarjeta)}, Taller ${pesos(r.taller)} + impresos ${pesos(r.impresos)}`), [], "la tarjeta es el total del Taller (más los impresos que este no puede pedir), al peso, en cada idea que se compara");
  console.log(`[PASS] ${comparadas.length} ideas: la tarjeta y el «Precio en la tienda» del Taller dan el mismo total al peso (8 con los impresos que solo la tarjeta compra)`);

  // Lo que no se compara está dicho: si una idea cambia de camino, esta prueba lo avisa.
  // REQ-014 T12 adds a football figure to idea 30; the 3D motor must send it through the saved Python plan.
  assert.deepEqual(resultados.filter((r) => r.camino === "python").map((r) => r.id), ["deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", "deco-real-27-aro-navideno-verde-salvia", "deco-real-30-columna-balon-futbol"], "las ideas que el motor no arma y caen a Python");
  assert.deepEqual(resultados.filter((r) => r.camino === "curada").map((r) => r.id).sort(), decoracionesSempertex.filter((d) => planGuardadoDeIdea(d.id) === null).map((d) => d.id).sort(), "la lista curada es solo de las ideas sin plan guardado");
  console.log(`[INFO] ${resultados.filter((r) => r.camino === "python").length} idea(s) caen al plan de Python y no tienen lista del Taller que comparar`);
  console.log("\ntest-paridad-tarjeta-taller: ok");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
