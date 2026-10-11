/**
 * D-038, paridad entre la tarjeta de la vista guiada y el «Precio en la tienda» del Taller, para las 46 ideas del carrusel.
 * Sin red, sin base, sin IA: Python se sustituye por el doble que cotiza con los paquetes del cruce (`pythonDoble`).
 *
 * Para cada idea se toma la lista que la tarjeta cotiza de verdad (`costearDecoracion`, bandera en 3d: la del motor para su
 * plan guardado) y se manda tal cual a la ruta del Taller (`atenderCotizacionTaller`, con el mismo armado de pedido que
 * `useCotizacionTaller`). Los dos totales deben ser iguales al peso. Las ideas que la tarjeta cotiza por otro camino se
 * listan con su razón, y la prueba falla si una idea cambia de camino sin que esta lista lo diga:
 * - `motor`: el motor arma el plan guardado de la idea; tarjeta y Taller dan el mismo total (se afirma);
 * - `python`: el motor no la arma (no representable o sin cobertura), así que la tarjeta cae al plan de Python de la idea
 *   guardada; el Taller no puede abrir esa idea, no hay lista que comparar (la paridad con Python la prueba
 *   `test-cotizacion-unica.ts` con la fixture compartida y la comprueban los pasos en vivo);
 * - `curada`: la idea no tiene plan guardado; la tarjeta cotiza su lista curada (variantes de la tienda, cantidades tal cual, sin repuestos);
 *   el Taller recibe esas mismas variantes como globos y las compra con su regla (repuestos por globo, el paquete más barato):
 *   los totales pueden diferir en cualquier sentido, y se listan; no se afirma igualdad porque la lista curada no es un plan.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-paridad-tarjeta-taller.ts
 */
import assert from "node:assert/strict";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { decoracionesSempertex } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido, especDesdeIdeaGuardada, type BomLinea } from "../../src/lib/globos3d/motor/v1";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { cotizarIdeaConPython } from "../../src/lib/guiada-motor/cotizar-idea-python";
import { costearDecoracion, type DependenciasCosteo } from "../../src/lib/guiada-motor/costear-idea";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderCotizacionTaller } from "../../src/lib/taller/cotizacion-taller";
import { CotizacionTallerSchema } from "../../src/lib/taller/cotizacion-taller-tipos";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-de-prueba-paridad-tarjeta-taller";
const COOKIES = [`${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`, `feedback_usuario=${"d4".repeat(16)}`].join("; ");
process.env.APP_PASSWORD = CLAVE_APP;
delete process.env.DATABASE_URL;

type Camino = "motor" | "python" | "curada";
type Resultado = { id: string; titulo: string; camino: Camino; tarjeta: number | null; taller: number | null; razon: string };

const nada = () => undefined;
const cruce = crosswalkIncluido();
const doble = pythonDoble(cruce);
const pesos = (valor: number | null): string => (valor === null ? "-" : valor.toLocaleString("es-CO"));

/** Lo que el Taller manda al pulsar «Cotizar en la tienda»: lo que la tienda vende por paquete, sin ceros y en orden fijo (`pedidoDe`). */
const pedidoDelTaller = (lista: ReadonlyArray<BomLinea>) =>
  lista.filter((l) => l.cantidad > 0).sort((a, b) => a.formatoId.localeCompare(b.formatoId) || a.codigo.localeCompare(b.codigo)).map((l) => ({ formatoId: l.formatoId, codigo: l.codigo, cantidad: l.cantidad }));

async function totalDelTaller(lista: ReadonlyArray<BomLinea>): Promise<number> {
  const peticion = new Request("https://app.test/api/taller/cotizacion", { method: "POST", headers: { "content-type": "application/json", cookie: COOKIES }, body: JSON.stringify({ materiales: pedidoDelTaller(lista) }) });
  const respuesta = await atenderCotizacionTaller(peticion, { cotizar: (bom) => cotizarBom(bom, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }), auditar: nada });
  assert.equal(respuesta.status, 200, await respuesta.clone().text());
  const cotizacion = CotizacionTallerSchema.parse(await respuesta.json());
  assert.deepEqual(cotizacion.faltantes, [], "el Taller cotizó toda la lista");
  return cotizacion.total;
}

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

const dependenciasDeLaTarjeta = (): DependenciasCosteo => ({
  leerMotor: async () => "3d",
  tienePlanGuardado: async (id) => planGuardadoDeIdea(id) !== null,
  cotizarConMotor: (id) => cotizarIdeaConMotor(id, { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }),
  cotizarConPython: (id) => cotizarIdeaConPython(id, { planGuardado: planGuardadoDeIdea, resolver: async () => { throw new Error("Python no responde en la prueba"); } }),
  cotizarLista: doble.cotizarLista,
  auditar: nada,
});

/** La lista curada de una idea sin plan guardado, vista como globos del cruce (formato y código de cada variante de la tienda). */
const variantesDelCruce: ReadonlySet<string> = new Set(Object.values(cruce.entradas).flatMap((entrada) => entrada.variantes.map((v) => v.variantId)));

function curadaComoGlobos(materiales: ReadonlyArray<{ variantId: string; cantidad: number }>): BomLinea[] | null {
  const porVariante = new Map(Object.entries(cruce.entradas).flatMap(([clave, entrada]) => entrada.variantes.map((v) => [v.variantId, clave] as const)));
  const lista: BomLinea[] = [];
  for (const material of materiales) {
    const clave = porVariante.get(material.variantId);
    if (!clave) return null;
    const [formatoId, codigo] = clave.split("|") as [string, string];
    lista.push({ formatoId, codigo, cantidad: material.cantidad });
  }
  return lista;
}

async function compararIdea(id: string, titulo: string, materiales: ReadonlyArray<{ variantId: string; cantidad: number }>): Promise<Resultado> {
  const sinPlan = planGuardadoDeIdea(id) === null;
  if (sinPlan && !curadaComoGlobos(materiales)) {
    const fuera = materiales.filter((m) => !variantesDelCruce.has(m.variantId)).length;
    return { id, titulo, camino: "curada", tarjeta: null, taller: null, razon: `lista curada con ${fuera} de ${materiales.length} variantes fuera del cruce incluido (el doble de Python no las conoce)` };
  }
  const tarjeta = await costearDecoracion({ id, materiales }, "personal", dependenciasDeLaTarjeta());
  const totalTarjeta = tarjeta.cotizacion?.total ?? null;
  const delMotor = listaDelMotor(id);
  if (delMotor.ok) {
    assert.equal(tarjeta.decision.usar, "motor", `${id}: el motor la arma, así que la tarjeta cotiza con el motor`);
    const taller = await totalDelTaller(delMotor.lista);
    return { id, titulo, camino: "motor", tarjeta: totalTarjeta, taller, razon: "mismo BOM del motor, mismo cotizador" };
  }
  if (planGuardadoDeIdea(id)) {
    assert.equal(tarjeta.decision.usar, "sin_precio", `${id}: sin Python, la tarjeta no inventa otro precio`);
    return { id, titulo, camino: "python", tarjeta: null, taller: null, razon: `la tarjeta cae al plan de Python (${delMotor.razon}); el Taller no abre esa idea` };
  }
  assert.equal(tarjeta.decision.usar, "curada", `${id}: sin plan guardado la tarjeta cotiza su lista curada`);
  const globos = curadaComoGlobos(materiales);
  const taller = globos ? await totalDelTaller(globos) : null;
  return { id, titulo, camino: "curada", tarjeta: totalTarjeta, taller, razon: globos ? "la tarjeta cotiza la lista curada tal cual (variantes y cantidades de la tienda); el Taller la compra como globos, con repuestos y el paquete más barato" : "la lista curada trae variantes que no son globos del cruce (cortinas, confeti…): el Taller no las cotiza" };
}

async function main(): Promise<void> {
  const resultados: Resultado[] = [];
  for (const idea of decoracionesSempertex) resultados.push(await compararIdea(idea.id, idea.titulo, idea.materiales.map((m) => ({ variantId: m.variantId, cantidad: m.cantidad }))));
  assert.equal(resultados.length, 46, "las 46 ideas del carrusel");

  console.log("idea | camino | tarjeta | taller | por qué");
  for (const r of resultados) console.log(`${r.id} | ${r.camino} | ${pesos(r.tarjeta)} | ${pesos(r.taller)} | ${r.razon}`);

  const delMotor = resultados.filter((r) => r.camino === "motor");
  assert.ok(delMotor.length >= 20, `al menos 20 ideas se comparan con el motor (hay ${delMotor.length})`);
  const distintas = delMotor.filter((r) => r.tarjeta !== r.taller);
  assert.deepEqual(distintas.map((r) => `${r.id}: tarjeta ${pesos(r.tarjeta)}, Taller ${pesos(r.taller)}`), [], "tarjeta y Taller dan el mismo total, al peso, en cada idea que arma el motor");
  console.log(`[PASS] ${delMotor.length} ideas: la tarjeta y el «Precio en la tienda» del Taller dan el mismo total al peso`);

  // Lo que no se compara con el motor está dicho: si una idea cambia de camino, esta prueba lo avisa.
  assert.deepEqual(resultados.filter((r) => r.camino === "python").map((r) => r.id), ["deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", "deco-real-27-aro-navideno-verde-salvia"], "las ideas que el motor no arma y caen a Python");
  assert.deepEqual(resultados.filter((r) => r.camino === "curada").map((r) => r.id).sort(), decoracionesSempertex.filter((d) => planGuardadoDeIdea(d.id) === null).map((d) => d.id).sort(), "la lista curada es solo de las ideas sin plan guardado");
  console.log(`[INFO] por otro camino: ${resultados.filter((r) => r.camino === "python").length} caen al plan de Python y ${resultados.filter((r) => r.camino === "curada").length} usan la lista curada (ver la tabla)`);
  console.log("\ntest-paridad-tarjeta-taller: ok");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
