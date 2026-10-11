/**
 * D-038, cotización única: la misma lista de materiales cuesta lo mismo en todas las superficies. Sin red, sin base, sin
 * IA: Python se sustituye por el doble que cotiza con los paquetes del cruce (`pythonDoble`).
 * 1. La fixture compartida (`contracts/domain/v1/golden/cotizacion-unica/`) está al día con la regla de TypeScript. La de
 *    Python la comprueba `services/ai-api/tests/test_cotizacion_unica.py` con el resolutor (vista clásica y plan guiado de
 *    Python), con la allowlist reducida a un paquete por globo.
 * 2. El cotizador único (`cotizarBom`) da el total de la fixture en cada lista: sintéticas, del motor y de Python.
 * 3. Con la lista del motor de cada idea de la muestra: el plan del 3D (`atenderPlanMotor`), su «¿cuánto cuesta?» con la
 *    bandera en 3d (`costearDecoracion`) y la lista del Taller (`atenderCotizacionTaller`) dan ese total. El Taller da
 *    también el de las cuentas de Python.
 * 4. Con la bandera en python, «¿cuánto cuesta?» pide a Python lo mismo que «Crear mi plan con esta idea»
 *    (`pedidoDeIdeaSola`) y muestra ese total.
 * 5. Propiedad de la regla, en 2 000 listas aleatorias del cruce: cada globo lleva su propia reserva y cada compra lleva
 *    globos del diseño; un paquete de repuestos solo se compra bajo el tope (`max(10 000 COP, 10 % del diseño)`); nunca
 *    cuesta más que cubrir el diseño y sumar paquetes sueltos para la reserva de cada globo, ni más que `mas_barato`.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-cotizacion-unica.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { cotizarBom, crosswalkIncluido, MERMA, planearCompra, type BomLinea, type ResultadoCotizacionBom } from "../../src/lib/globos3d/motor/v1";
import { presentaciones, type Crosswalk } from "../../src/lib/globos3d/motor/crosswalk-variantes";
import { optimizarCobertura, TOPE_RESERVA_COP, TOPE_RESERVA_PARTES, type CompraPlaneada } from "../../src/lib/globos3d/motor/plan-de-compra";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { cotizarIdeaConPython, DEADLINE_COTIZAR_IDEA_MS, type DependenciasCotizacionPython, type PedidoPython } from "../../src/lib/guiada-motor/cotizar-idea-python";
import { costearDecoracion, type DependenciasCosteo } from "../../src/lib/guiada-motor/costear-idea";
import { atenderPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { olvidarResoluciones } from "../../src/lib/plan/cache-resoluciones";
import { pedidoDeIdeaSola } from "../../src/lib/plan/plan-de-idea";
import type { resolverPlan } from "../../src/lib/plan/resolver-backend";
import { resolverIdeaSola } from "../../src/lib/plan/resolver-idea";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderCotizacionTaller } from "../../src/lib/taller/cotizacion-taller";
import { CotizacionTallerSchema } from "../../src/lib/taller/cotizacion-taller-tipos";
import { azar, casosCotizacionUnica, crosswalkDeLineas, DIRECTORIO_COTIZACION_UNICA, listaAleatoria, type CasoCotizacion } from "../lib/casos-cotizacion-unica";
import { pythonDoble } from "../lib/python-doble-precio";

const RAIZ = path.resolve(__dirname, "..", "..");
const CLAVE_APP = "clave-de-prueba-cotizacion-unica";
const COOKIES = [`${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`, `feedback_usuario=${"c3".repeat(16)}`].join("; ");
process.env.APP_PASSWORD = CLAVE_APP;
delete process.env.DATABASE_URL;

const nada = () => undefined;
const bomDe = (caso: CasoCotizacion): BomLinea[] => caso.lineas.map((l) => ({ formatoId: l.formatoId, codigo: l.codigo, cantidad: l.cantidad }));
const cruceDe = (caso: CasoCotizacion): Crosswalk => (caso.origen === "sintetico" ? crosswalkDeLineas(caso.snapshot, caso.lineas) : crosswalkIncluido());
const cotizador = (cruce: Crosswalk) => (bom: { total: readonly BomLinea[]; porPieza: Readonly<Record<string, readonly BomLinea[]>> }) => cotizarBom(bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
const pedir = (ruta: string, cuerpo: unknown) => new Request(`https://app.test${ruta}`, { method: "POST", headers: { "content-type": "application/json", cookie: COOKIES }, body: JSON.stringify(cuerpo) });

async function totalDelTaller(bom: readonly BomLinea[], cruce: Crosswalk): Promise<number> {
  const respuesta = await atenderCotizacionTaller(pedir("/api/taller/cotizacion", { materiales: bom }), { cotizar: cotizador(cruce), auditar: nada });
  assert.equal(respuesta.status, 200, await respuesta.clone().text());
  return CotizacionTallerSchema.parse(await respuesta.json()).total;
}

async function totalDelPlan3d(ideaId: string, cruce: Crosswalk): Promise<number> {
  let ids = 0;
  const respuesta = await atenderPlanMotor(pedir("/api/guiada/motor/plan", { desde: "idea", idea_id: ideaId }), {
    leerBandera: async () => ({ motor: "3d", fuente: "cookie" }), auditar: nada, registrarPlan: async () => undefined, planGuardado: planGuardadoDeIdea, cotizar: cotizador(cruce),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  assert.equal(respuesta.status, 200, await respuesta.clone().text());
  return ((await respuesta.json()) as { cotizacion: { total: number } }).cotizacion.total;
}

const depsCosteo = (cruce: Crosswalk, motor: "3d" | "python", resolver: DependenciasCotizacionPython["resolver"]): DependenciasCosteo => ({
  leerMotor: async () => motor,
  tienePlanGuardado: async (id) => planGuardadoDeIdea(id) !== null,
  cotizarConMotor: (id) => cotizarIdeaConMotor(id, { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }),
  cotizarConPython: (id) => cotizarIdeaConPython(id, { planGuardado: planGuardadoDeIdea, resolver }),
  cotizarLista: pythonDoble(cruce).cotizarLista,
  auditar: nada,
});
const sinPython = async (): Promise<never> => { throw new Error("con la bandera en 3d y el motor armando la idea no se llama a Python"); };

function opcionesDe(linea: BomLinea, cruce: Crosswalk) {
  const hay = presentaciones(cruce, linea.formatoId, linea.codigo);
  if (!hay.ok) throw new Error(`${linea.formatoId} ${linea.codigo} sin tienda`);
  return hay.entrada.variantes.map((v) => ({ variantId: v.variantId, unidades: v.unidadesPaq, precio: v.precio }));
}

const costoCobertura = (compras: ReadonlyArray<{ paquetes: number; precio: number }>) => compras.reduce((suma, c) => suma + c.paquetes * c.precio, 0);

/** Cubrir el diseño de cada globo y sumar los paquetes sueltos más baratos para lo que falte de SU reserva. */
function dosEtapas(bom: readonly BomLinea[], cruce: Crosswalk): number {
  let total = 0;
  for (const linea of bom) {
    const opciones = opcionesDe(linea, cruce);
    const diseno = optimizarCobertura(linea.cantidad, opciones)!;
    const sobra = diseno.compras.reduce((suma, c) => suma + c.paquetes * c.unidades, 0) - linea.cantidad;
    const falta = Math.ceil(linea.cantidad * MERMA) - sobra;
    total += costoCobertura(diseno.compras) + (falta > 0 ? Math.min(...opciones.map((o) => Math.ceil(falta / o.unidades) * o.precio)) : 0);
  }
  return total;
}

function propiedadDeLaRegla(): void {
  const cruce = crosswalkIncluido();
  const siguiente = azar(20261010);
  const costo = (plan: ReturnType<typeof planearCompra>) => (plan.ok ? plan.compras.reduce((suma, c) => suma + c.paquetes * c.variante.precio, 0) : Number.NaN);
  let sinRepuestoCompleto = 0;
  for (let k = 0; k < 2_000; k += 1) {
    const bom = listaAleatoria(cruce, siguiente);
    const plan = planearCompra(bom, cruce, "python");
    if (!plan.ok) throw new Error(`sin tienda: ${JSON.stringify(bom)}`);
    for (const linea of bom) {
      const caso = `${JSON.stringify(bom)}: ${linea.formatoId} ${linea.codigo}`;
      const suyas: CompraPlaneada[] = plan.compras.filter((c) => c.formatoId === linea.formatoId && c.codigo === linea.codigo);
      const reserva = suyas.reduce((suma, c) => suma + c.reserva, 0);
      assert.equal(suyas.reduce((suma, c) => suma + c.cantidad, 0), linea.cantidad);
      assert.ok(suyas.every((c) => c.cantidad >= 1), `${caso}: cada compra lleva globos del diseño`);
      assert.ok(reserva <= Math.ceil(linea.cantidad * MERMA), `${caso}: la reserva es la suya`);
      const diseno = costoCobertura(optimizarCobertura(linea.cantidad, opcionesDe(linea, cruce))!.compras);
      const pagado = suyas.reduce((suma, c) => suma + c.paquetes * c.variante.precio, 0);
      // Un paquete de repuestos solo se compra bajo el tope; sin él, el globo se compra como su diseño solo.
      if (suyas.some((c) => c.paraReserva)) assert.ok(pagado - diseno <= Math.max(TOPE_RESERVA_COP, diseno / TOPE_RESERVA_PARTES), `${caso}: ${pagado - diseno} de repuestos sobre ${diseno}`);
      else assert.equal(pagado, diseno, `${caso}: sin paquete de repuestos cuesta lo que su diseño`);
      if (reserva < Math.ceil(linea.cantidad * MERMA)) sinRepuestoCompleto += 1;
    }
    assert.ok(costo(plan) <= dosEtapas(bom, cruce), `${JSON.stringify(bom)}: ${costo(plan)} contra ${dosEtapas(bom, cruce)} con paquetes sueltos`);
    assert.ok(costo(plan) <= costo(planearCompra(bom, cruce, "mas_barato")), `${JSON.stringify(bom)}: más caro que mas_barato`);
  }
  console.log(`[PASS] 2 000 listas aleatorias: reserva por globo, repuestos solo bajo el tope, nunca más cara que los paquetes sueltos ni que mas_barato (${sinRepuestoCompleto} globos con repuestos incompletos)`);
}

async function main(): Promise<void> {
  const casos = casosCotizacionUnica();
  const guardados = readdirSync(DIRECTORIO_COTIZACION_UNICA).filter((archivo) => archivo.endsWith(".json")).sort();
  assert.deepEqual(guardados, casos.map((caso) => `${caso.caso}.json`).sort(), "los casos de la fixture son los de casos-cotizacion-unica.ts");
  for (const caso of casos) {
    const guardado = JSON.parse(readFileSync(path.join(DIRECTORIO_COTIZACION_UNICA, `${caso.caso}.json`), "utf8")) as unknown;
    assert.deepEqual(guardado, caso, `${caso.caso}: la fixture cambió (regenera con scripts/motor/generar-cotizacion-unica.ts)`);
  }
  console.log(`[PASS] la fixture compartida está al día (${casos.length} casos)`);

  for (const caso of casos) {
    const cruce = cruceDe(caso);
    const cotizada = await cotizador(cruce)({ total: bomDe(caso), porPieza: {} });
    assert.ok(cotizada.ok, `${caso.caso}: ${JSON.stringify(cotizada)}`);
    if (cotizada.ok) assert.equal(cotizada.total, caso.esperado.total, `${caso.caso}: el cotizador único`);
    assert.equal(await totalDelTaller(bomDe(caso), cruce), caso.esperado.total, `${caso.caso}: la lista del Taller`);
  }
  console.log("[PASS] el cotizador único y la lista del Taller dan el total de la fixture en cada lista");

  const taller = (peticion: Request) => atenderCotizacionTaller(peticion, { cotizar: cotizador(crosswalkIncluido()), auditar: nada });
  const sinSesion = new Request("https://app.test/api/taller/cotizacion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 10 }] }) });
  assert.equal((await taller(sinSesion)).status, 401);
  assert.equal((await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-99", codigo: "005", cantidad: 10 }] }))).status, 400, "un formato que no existe");
  assert.equal((await taller(pedir("/api/taller/cotizacion", { materiales: [] }))).status, 400, "una lista vacía");
  assert.equal((await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 5_001 }] }))).status, 400, "una línea por encima del tope");
  assert.equal((await taller(pedir("/api/taller/cotizacion", { materiales: ["005", "009", "012", "015", "021"].map((codigo) => ({ formatoId: "R-12", codigo, cantidad: 4_500 })) }))).status, 400, "una lista por encima del tope");
  const hueco = await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "LOL-12", codigo: "042", cantidad: 10 }] }));
  assert.equal(hueco.status, 422);
  assert.equal(((await hueco.json()) as { codigo: string }).codigo, "SIN_COBERTURA");
  const repetidas = await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 10 }, { formatoId: "R-12", codigo: "005", cantidad: 14 }] }));
  const unidas = await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 24 }] }));
  assert.equal(CotizacionTallerSchema.parse(await repetidas.json()).total, CotizacionTallerSchema.parse(await unidas.json()).total, "dos líneas del mismo globo se suman antes de cotizar");
  assert.equal((await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 3_000 }, { formatoId: "R-12", codigo: "005", cantidad: 3_000 }] }))).status, 400, "el tope por línea se mira después de sumar");
  // Lo que la tienda no vende no tumba la lista: se cotiza lo demás, al mismo precio que esa lista sola.
  const parcial = CotizacionTallerSchema.parse(await (await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 10 }, { formatoId: "LOL-12", codigo: "042", cantidad: 7 }] }))).json());
  const sola = CotizacionTallerSchema.parse(await (await taller(pedir("/api/taller/cotizacion", { materiales: [{ formatoId: "R-12", codigo: "005", cantidad: 10 }] }))).json());
  assert.equal(parcial.total, sola.total);
  assert.deepEqual(parcial.faltantes.map((f) => [f.formatoId, f.codigo, f.cantidad]), [["LOL-12", "042", 7]]);
  // Si el segundo intento también encuentra huecos, el 422 no dice «ninguno»: sí se vendían algunos.
  const sinTienda = (codigo: string): ResultadoCotizacionBom => ({ ok: false, razon: "sin_cobertura", faltantes: [{ formatoId: "R-12", codigo, motivo: "desconocida" }] });
  const huecos = [sinTienda("005"), sinTienda("009")];
  let intento = 0;
  const conHuecos = await atenderCotizacionTaller(pedir("/api/taller/cotizacion", { materiales: ["005", "009", "012"].map((codigo) => ({ formatoId: "R-12", codigo, cantidad: 10 })) }), { cotizar: async () => huecos[Math.min(intento++, 1)]!, auditar: nada });
  const cuerpoHuecos = (await conHuecos.json()) as { error: string; faltantes: Array<{ codigo: string }> };
  assert.equal(conHuecos.status, 422);
  assert.doesNotMatch(cuerpoHuecos.error, /ninguno/);
  assert.deepEqual(cuerpoHuecos.faltantes.map((f) => f.codigo), ["005", "009"]);
  // 256 globos distintos pueden ser más de 256 compras: se cotizan por trozos de 256, al total exacto.
  const cruce = crosswalkIncluido();
  const grande = Object.keys(cruce.entradas).sort().slice(0, 256).map((clave) => { const [formatoId, codigo] = clave.split("|") as [string, string]; return { formatoId, codigo, cantidad: 78 }; });
  const planGrande = planearCompra(grande, cruce, "python");
  if (!planGrande.ok) throw new Error("la lista grande tiene huecos");
  assert.ok(planGrande.compras.length > 256, `la lista grande compra ${planGrande.compras.length} variantes`);
  const doble = pythonDoble(cruce);
  const respuestaGrande = await atenderCotizacionTaller(pedir("/api/taller/cotizacion", { materiales: grande }), { cotizar: (bom) => cotizarBom(bom, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }), auditar: nada });
  assert.equal(respuestaGrande.status, 200, await respuestaGrande.clone().text());
  assert.equal(CotizacionTallerSchema.parse(await respuestaGrande.json()).total, planGrande.compras.reduce((suma, c) => suma + c.paquetes * c.variante.precio, 0));
  assert.ok(doble.llamadas.length >= 2 && doble.llamadas.every((llamada) => llamada.materiales.length <= 256), "por trozos de como mucho 256 líneas");
  console.log("[PASS] la ruta del Taller: sesión, cuerpo, topes, huecos (precio parcial y mensaje cierto), líneas repetidas y listas de más de 256 compras");
  propiedadDeLaRegla();

  const delMotor = casos.filter((caso) => caso.origen === "motor");
  assert.ok(delMotor.length >= 5, "la muestra trae al menos cinco ideas de la biblioteca");
  for (const caso of delMotor) {
    const ideaId = caso.idea!;
    const cruce = crosswalkIncluido();
    const total = caso.esperado.total;
    assert.equal(await totalDelPlan3d(ideaId, cruce), total, `${caso.caso}: el plan del 3D`);
    const tarjeta = await costearDecoracion({ id: ideaId, materiales: [] }, "personal", depsCosteo(cruce, "3d", sinPython));
    assert.equal(tarjeta.cotizacion?.total, total, `${caso.caso}: «¿cuánto cuesta?» con la bandera en 3d`);
    console.log(`  ✓ ${caso.caso}: ${total.toLocaleString("es-CO")} COP en el plan del 3D, su tarjeta y el Taller`);
  }

  for (const caso of casos.filter((c) => c.origen === "python")) {
    const ideaId = caso.idea!;
    const guardado = planGuardadoDeIdea(ideaId)!;
    const esperado = pedidoDeIdeaSola(guardado);
    assert.ok(esperado.combinado.ok);
    const pedidos: PedidoPython[] = [];
    const cotizacion = { lineas: [{ id: "v", tamano: "R-12", cantidadNecesaria: 1, disponible: true, varianteId: "v", nombre: "Globo", precioPaquete: caso.esperado.total, unidadesPaquete: 12, paquetes: 1, subtotal: caso.esperado.total, sobrante: 11 }], total: caso.esperado.total, mermaPorcentaje: 8, incluyeIva: true, complementosSoportados: false as const };
    const tarjeta = await costearDecoracion({ id: ideaId, materiales: [] }, "personal", depsCosteo(crosswalkIncluido(), "python", async (pedido) => { pedidos.push(pedido); return { cotizacion }; }));
    assert.deepEqual(pedidos, [{ plan: esperado.combinado.ok ? esperado.combinado.plan : null, allowlist: esperado.allowlist, catalogSnapshotId: esperado.catalogSnapshotId }], `${caso.caso}: la tarjeta pide a Python lo que pide «Crear mi plan con esta idea»`);
    assert.equal(tarjeta.cotizacion?.total, caso.esperado.total, `${caso.caso}: la tarjeta muestra el total de ese plan`);
  }
  const planDesdeIdea = readFileSync(path.join(RAIZ, "src", "lib", "plan", "plan-desde-idea.ts"), "utf8");
  assert.match(planDesdeIdea, /pedidoDeIdeaSola\(guardado\)/, "«Crear mi plan con esta idea» arma su pedido con pedidoDeIdeaSola");
  // La tarjeta deja la resolución recordada por su pedido y «Crear mi plan con esta idea» la reutiliza (sin otra llamada).
  olvidarResoluciones();
  const guardado = planGuardadoDeIdea(casos.find((c) => c.origen === "python")!.idea!)!;
  const solo = pedidoDeIdeaSola(guardado);
  assert.ok(solo.combinado.ok);
  const pedido = { plan: solo.combinado.ok ? solo.combinado.plan : guardado.plan, allowlist: solo.allowlist, catalogSnapshotId: solo.catalogSnapshotId };
  let resoluciones = 0;
  const falsa = (async () => { resoluciones += 1; return { resuelto: { plan: pedido.plan, plan_hash: "h-idea" }, cotizacion: { total: 1 } }; }) as unknown as typeof resolverPlan;
  const opciones = { requestId: "r", correlationId: "c", deadlineMs: DEADLINE_COTIZAR_IDEA_MS };
  await resolverIdeaSola(pedido, opciones, falsa);
  await resolverIdeaSola(structuredClone(pedido), opciones, falsa);
  assert.equal(resoluciones, 1, "el mismo pedido no se resuelve dos veces en el proceso");
  console.log("[PASS] con la bandera en python, la tarjeta cotiza el mismo pedido que el plan de la idea y se lo deja resuelto");
  console.log("\ntest-cotizacion-unica: ok");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
