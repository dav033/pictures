/**
 * El motor 3D de la vista guiada, fase 2: el precio de su lista de materiales con el servicio de precios de Python
 * (REQ-007). Sin coste: Python se sustituye por un doble que cotiza con los paquetes del cruce (nunca llama a la red,
 * ni a la base, ni a ninguna IA).
 * - la merma es una sola constante, igual a la de `services/ai-api/app/merma.py`, y redondea como Python;
 * - cobertura del cruce: cada (formato, color) de las 46 fixtures doradas se resuelve o está declarado `sin_cobertura`;
 *   la tabla oficial de color queda partida sin huecos entre «con variante» y «sin cobertura» (con su motivo);
 * - fixtures doradas con PRECIO: solo cantidades e ids de variante (los precios no son estables entre snapshots);
 * - `cotizarBom`: merma antes del paquete, variante repetida, pre-filtro con el cruce (sin llamar a Python), reintento
 *   con el cruce en vivo, `material_no_disponible` y fallos del servicio como fallos tipados (nunca lanza);
 * - el sobre del plan cumple `PlanGuiadoSchema` y `CotizacionPlanGuiadoSchema`, lleva el token `globos3d` firmado sobre
 *   el hash de la espec, y sus cantidades por pieza, por variante y en total cuadran con la lista del motor;
 * - el carrusel («¿cuánto cuesta?» de una idea) cotiza lo que cuenta el motor: 26 de las 28 ideas; la lista curada queda para el resto;
 * - los pasos de montaje leen el sobre (la tarjeta, la tabla, la compra y la cotización se prueban en test-ui-plan-motor3d.ts).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-precio.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { generarPasosPlan } from "../../src/lib/ia/guiado/generar-pasos-plan";
import { coloresDelFormato, FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import { abrirContextoPlan, verificarTokenAprobacion } from "../../src/lib/plan/aprobacion";
import { armarDesdeEspec, cantidadConMerma, cotizarBom, crosswalkIncluido, especHashDe, MERMA, MERMA_PORCENTAJE, sobreDelMotor, type CotizacionDelMotor, type ResultadoMotorV1 } from "../../src/lib/globos3d/motor/v1";
import { claveCruce, construirCrosswalk, CrosswalkSchema, elegirVariante, MOTIVOS_SIN_COBERTURA, normalizarTitulo, type Crosswalk, type FilaCatalogo } from "../../src/lib/globos3d/motor/crosswalk-variantes";
import { elegirPedido } from "../../src/lib/globos3d/motor/cotizar-bom";
import { DIRECTORIO_DORADO, DIRECTORIO_DORADO_PRECIO, todosLosCasos, type CasoMotor, type RegistroDoradoPrecio } from "../lib/casos-motor-guiada";
import { registroPrecio } from "../motor/generar-golden-precio";
import { pythonDoble, type PythonDoble } from "../lib/python-doble-precio";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { CotizacionGuiadaSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";

const RAIZ = path.resolve(__dirname, "..", "..");
let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try { await prueba(); casos += 1; console.log(`[PASS] ${nombre}`); } catch (error) { console.error(`[FAIL] ${nombre}`); throw error; }
}

const cruce = crosswalkIncluido();
/** Mira un valor que el contrato deja abierto (`passthrough`) con la forma que la prueba espera. */
const como = <T,>(valor: unknown): T => valor as unknown as T;
const unidades = (lineas: ReadonlyArray<{ cantidad: number }>) => lineas.reduce((suma, l) => suma + l.cantidad, 0);

const dependencias = (doble: PythonDoble, extra: { vivo?: Crosswalk } = {}) => ({
  crosswalk: async () => cruce, cotizarLista: doble.cotizarLista, ...(extra.vivo ? { crosswalkEnVivo: async () => extra.vivo! } : {}),
});

const todos = todosLosCasos();
const resultados = new Map<string, ResultadoMotorV1>(todos.map((c) => [c.id, armarDesdeEspec(c.espec)]));
const ARMABLES = todos.filter((c) => resultados.get(c.id)!.noRepresentable.length === 0);

async function main(): Promise<void> {
  await caso("la merma es UNA constante y es la de Python (services/ai-api/app/merma.py)", () => {
    const py = readFileSync(path.join(RAIZ, "services", "ai-api", "app", "merma.py"), "utf8");
    const valor = /^MERMA:\s*float\s*=\s*([0-9.]+)/m.exec(py);
    assert.ok(valor, "no se encontró MERMA en merma.py");
    assert.equal(MERMA, Number(valor[1]), "la merma del motor debe ser la de Python");
    assert.equal(MERMA, 0.08);
    assert.equal(MERMA_PORCENTAJE, 8, "se publica como 8 %");
    // Redondea como Python: ceil(n * (1 + merma)) en coma flotante, línea por línea.
    assert.deepEqual([1, 7, 25, 50, 100, 150, 200, 333].map(cantidadConMerma), [2, 8, 27, 54, 108, 162, 216, 360]);
    try {
      const salida = execFileSync("python", ["-c", "import math,sys\nM=0.08\nprint(','.join(str(math.ceil(n*(1+M))) for n in range(1,1001)))"], { encoding: "utf8" }).trim().split(",").map(Number);
      assert.deepEqual(Array.from({ length: 1000 }, (_, k) => cantidadConMerma(k + 1)), salida, "los mil primeros enteros redondean igual que Python");
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      console.log("  (sin python en el PATH: se omite el cruce de redondeo con Python)");
    }
  });

  await caso("el cruce incluido cumple su contrato y es el del snapshot guardado en data/motor", () => {
    CrosswalkSchema.parse(cruce);
    const archivo = path.join(RAIZ, "data", "motor", `crosswalk-${cruce.snapshot.replace(/[^A-Za-z0-9_.-]/g, "-")}.json`);
    assert.ok(existsSync(archivo), `falta ${path.relative(RAIZ, archivo)}`);
    assert.deepEqual(JSON.parse(readFileSync(archivo, "utf8")), cruce, "la copia que viaja con el servidor es la del snapshot");
    assert.equal(readdirSync(path.join(RAIZ, "data", "motor")).filter((f) => f.startsWith("crosswalk-")).length >= 1, true);
  });

  await caso("el cruce parte la tabla oficial sin huecos: cada (formato, color) tiene variante o un motivo de sin_cobertura", () => {
    let pares = 0;
    for (const formato of FORMATOS_GLOBO) for (const ref of coloresDelFormato(formato.id)) {
      const clave = claveCruce(formato.id, ref.codigo);
      pares += 1;
      assert.ok((clave in cruce.entradas) !== (clave in cruce.sinCobertura), `${clave}: debe estar en uno y solo uno`);
      if (clave in cruce.sinCobertura) assert.ok((MOTIVOS_SIN_COBERTURA as readonly string[]).includes(cruce.sinCobertura[clave]!));
    }
    const conVariante = Object.keys(cruce.entradas).length;
    console.log(`  cobertura de la tabla oficial: ${conVariante} de ${pares} pares con variante, ${Object.keys(cruce.sinCobertura).length} sin cobertura`);
    // Las 9 combinaciones que el listado de la tienda no trae (`NO_ESTAN_EN_LA_TIENDA`) salen como tales.
    assert.equal(cruce.sinCobertura[claveCruce("LOL-12", "970")], "no_esta_en_la_tienda");
    assert.equal(cruce.sinCobertura[claveCruce("R-36", "041")], "talla_no_vendida", "el azul rey no se vende en 36″");
    for (const entrada of Object.values(cruce.entradas)) assert.ok(entrada.variantes.every((v, k, lista) => k === 0 || lista[k - 1]!.unidadesPaq <= v.unidadesPaq), "variantes ordenadas por paquete");
  });

  await caso("cobertura sobre las fixtures doradas: cada (formato, color) de las 46 se resuelve o está declarado sin_cobertura", () => {
    const pares = new Set<string>();
    for (const archivo of readdirSync(DIRECTORIO_DORADO).filter((f) => f.endsWith(".json"))) {
      const dorado = JSON.parse(readFileSync(path.join(DIRECTORIO_DORADO, archivo), "utf8")) as { total: { lineas: Array<{ formatoId: string; codigo: string }> } };
      for (const l of dorado.total.lineas) pares.add(claveCruce(l.formatoId, l.codigo));
    }
    const resueltos: string[] = [], declarados: string[] = [];
    for (const clave of [...pares].sort()) {
      const [formato, codigo] = clave.split("|") as [string, string];
      const elegida = elegirVariante(cruce, formato, codigo, 50);
      if (elegida.ok) { resueltos.push(clave); assert.ok(elegida.variantId && elegida.productId && elegida.unidadesPaq > 0); continue; }
      assert.notEqual(elegida.motivo, "desconocida", `${clave} no está ni resuelto ni declarado`);
      declarados.push(`${clave} (${elegida.motivo})`);
    }
    console.log(`  fixtures doradas: ${pares.size} pares; ${resueltos.length} resueltos, ${declarados.length} declarados sin_cobertura: ${declarados.join(", ") || "ninguno"}`);
    assert.equal(resueltos.length + declarados.length, pares.size);
    assert.deepEqual(declarados, ["LOL-12|970 (no_esta_en_la_tienda)"], "el único hueco: la pared densa por defecto pide el Link Reflex Dorado, que la tienda no vende");
  });

  await caso("el emparejamiento de títulos: tienda, marca B2B, siglas y variantes del catálogo", () => {
    assert.equal(normalizarTitulo("B2b Globo Latex Link-O-Loon® Fashion Azul"), normalizarTitulo("GLOBO LINK-O-LOON FASHION AZUL"));
    assert.equal(normalizarTitulo("B2b Globo Fashion Rosa"), "globo redondo fashion rosa", "sin la palabra «redondo» es el redondo");
    assert.equal(normalizarTitulo("B2b Globo Latex Redondo Fashion Azul Turquesa Profundo"), "globo redondo fashion turquesa profundo");
    assert.equal(normalizarTitulo("B2b Globo Latex Redondo Silk Nuevo Gris Medianoche"), "globo redondo silk gris medianoche");
    assert.notEqual(normalizarTitulo("B2b Globo Latex Redondo Infinity® Happy Halloween Friends Fashion Negro"), normalizarTitulo("GLOBO REDONDO FASHION NEGRO"), "un impreso no se confunde con el liso");
    const fila = (over: Partial<FilaCatalogo>): FilaCatalogo => ({ snapshot: "s", productId: "p1", tituloProducto: "B2b Globo Latex Redondo Fashion Negro", variantId: "v1", tituloVariante: "R-12 / PAQUETE X 50", codigoTamano: "R-12", unidadesPaq: 50, precio: 13000, coloresDerivados: ["negro"], ...over });
    const { crosswalk, diagnostico } = construirCrosswalk([
      fila({}), fila({ variantId: "v2", tituloVariante: "R-12 / PAQUETE X 12", unidadesPaq: 12, precio: 5000 }), fila({ variantId: "v3", codigoTamano: "R12", tituloVariante: "R12" }),
      fila({ productId: "p2", tituloProducto: "B2b Globo Latex Redondo Infinity® Happy Halloween Friends Fashion Negro", variantId: "v9" }),
      fila({ productId: "p3", tituloProducto: "B2b Globo Latex Link-O-Loon® Fashion Negro", variantId: "v5", codigoTamano: "LOL12", tituloVariante: "LOL12 / PAQUETE X 50" }),
    ], "s");
    const entrada = crosswalk.entradas[claveCruce("R-12", "080")]!;
    assert.deepEqual(entrada.variantes.map((v) => v.variantId).sort(), ["v1", "v2", "v3"], "R-12, R12 y r12 son la misma talla");
    assert.equal(entrada.productId, "p1", "el impreso de Halloween no es el liso");
    assert.equal(crosswalk.entradas[claveCruce("LOL-12", "080")]!.productId, "p3");
    assert.equal(diagnostico.productosEmparejados, 2);
    // Entre paquetes de una misma talla se elige el que cuesta menos para esa cantidad (paquetes cerrados): 7 globos, el de 12; 100, el de 50.
    assert.equal((elegirVariante(crosswalk, "R-12", "080", 7) as { variantId: string }).variantId, "v2");
    assert.equal((elegirVariante(crosswalk, "R-12", "080", 100) as { variantId: string }).variantId, "v1");
    assert.deepEqual(elegirVariante(crosswalk, "R-12", "123", 5), { ok: false, motivo: "desconocida" });
  });

  await caso("fixtures doradas con precio: solo cantidades e ids de variante, y son las que el motor y el cruce dan hoy", () => {
    const esperados = new Set(todos.map((c) => `${c.id}.json`));
    const hay = readdirSync(DIRECTORIO_DORADO_PRECIO).filter((f) => f.endsWith(".json"));
    assert.deepEqual(hay.filter((f) => !esperados.has(f)), [], "fixtures con precio sin caso");
    for (const c of todos) {
      const ruta = path.join(DIRECTORIO_DORADO_PRECIO, `${c.id}.json`);
      assert.ok(existsSync(ruta), `falta la fixture con precio de ${c.id}`);
      const texto = readFileSync(ruta, "utf8");
      const dorado = JSON.parse(texto) as RegistroDoradoPrecio;
      assert.doesNotMatch(texto, /precio|subtotal|total_cop|"total"/i, `${c.id}: una fixture con precio guarda cantidades e ids, no pesos`);
      assert.deepEqual(registroPrecio(c), dorado, `${c.id}: cambió el pedido a la tienda (regenera con scripts/motor/generar-golden-precio.ts)`);
      for (const linea of dorado.pedido) assert.equal(linea.cantidadConMerma, cantidadConMerma(linea.cantidad));
    }
  });

  await caso("cotizarBom: merma antes del paquete, una variante por línea y el sobre de CotizacionPlanGuiado", async () => {
    let cotizadas = 0;
    for (const c of ARMABLES) {
      const r = resultados.get(c.id)!;
      const doble = pythonDoble(cruce);
      const cotizada = await cotizarBom(r.bom, dependencias(doble));
      if (!cotizada.ok) { assert.equal(c.id, "oficial-pared_densa", `${c.id}: ${JSON.stringify(cotizada)}`); assert.equal(cotizada.razon, "sin_cobertura"); assert.equal(doble.llamadas.length, 0, "con un hueco en el cruce no se llama a Python"); continue; }
      cotizadas += 1;
      assert.equal(doble.llamadas.length, 1);
      const pedido = doble.llamadas[0]!;
      assert.equal(pedido.schema_version, "lista-materiales.v1");
      assert.equal(new Set(pedido.materiales.map((m) => m.variant_id)).size, pedido.materiales.length, "Python no admite variantes repetidas");
      assert.equal(pedido.materiales.reduce((s, m) => s + m.cantidad, 0), r.bom.total.reduce((s, l) => s + cantidadConMerma(l.cantidad), 0), `${c.id}: la cantidad que se cotiza es la del motor con merma, línea por línea`);
      assert.equal(cotizada.compras.reduce((s, x) => s + x.cantidad, 0), unidades(r.bom.total));
      for (const compra of cotizada.compras) {
        assert.equal(compra.cantidadConMerma, cantidadConMerma(compra.cantidad));
        assert.equal(compra.paquetes * compra.unidadesPaquete - compra.cantidad, compra.sobrante, "el sobrante incluye la merma y el paquete cerrado");
        assert.ok(compra.paquetes * compra.unidadesPaquete >= compra.cantidadConMerma, "los paquetes cubren la cantidad con merma");
      }
      const cot = CotizacionPlanGuiadoSchema.parse(cotizada.cotizacion);
      assert.equal(cot.mermaPorcentaje, 8);
      assert.equal(cot.incluyeIva, true);
      assert.equal(cot.total, cotizada.compras.reduce((s, x) => s + x.subtotal, 0));
      assert.deepEqual(cot.lineas.map((l) => l.cantidadNecesaria), cotizada.compras.map((x) => x.cantidad));
    }
    assert.equal(cotizadas, ARMABLES.length - 1);
  });

  await caso("cotizarBom: fallos tipados, reintento con el cruce en vivo y nunca lanza", async () => {
    const bom = resultados.get("idea-deco-real-01-305")!.bom;
    // Un hueco en el cruce: ni se llama a Python.
    const sinHueco = pythonDoble(cruce);
    const pared = await cotizarBom(resultados.get("oficial-pared_densa")!.bom, dependencias(sinHueco));
    assert.deepEqual(pared.ok ? null : pared.razon, "sin_cobertura");
    assert.deepEqual(!pared.ok && pared.razon === "sin_cobertura" ? pared.faltantes : null, [{ formatoId: "LOL-12", codigo: "970", motivo: "no_esta_en_la_tienda" }]);
    assert.equal(sinHueco.llamadas.length, 0);
    // material_no_disponible (422 todo o nada) sin cruce en vivo: fallo tipado.
    const variantes = new Set(Object.values(cruce.entradas).flatMap((e) => e.variantes.map((v) => v.variantId)));
    const caida = pythonDoble(cruce, { sinVariante: variantes });
    const sinVivo = await cotizarBom(bom, dependencias(caida));
    assert.equal(sinVivo.ok, false);
    assert.equal(!sinVivo.ok && sinVivo.razon, "material_no_disponible");
    // Con un cruce de OTRO snapshot (el catálogo cambió) se reintenta una vez y sale.
    const vivo: Crosswalk = { ...cruce, snapshot: "products_catalog:nuevo" };
    const quitadas = new Set([cruce.entradas[claveCruce("R-12", "005")]!.variantes[0]!.variantId]);
    const reintento = pythonDoble(cruce, { sinVariante: quitadas });
    const doble: PythonDoble = { llamadas: reintento.llamadas, cotizarLista: async (entrada) => {
      // La primera lista (con el cruce viejo) falla; la segunda (con el nuevo) ya no pide la variante retirada.
      if (reintento.llamadas.length === 0) return reintento.cotizarLista(entrada);
      reintento.llamadas.push(entrada);
      return pythonDoble(cruce).cotizarLista(entrada);
    } };
    const viejo = [...bom.total];
    const hayRetirada = viejo.some((l) => l.formatoId === "R-12" && l.codigo === "005" && elegirVariante(cruce, "R-12", "005", cantidadConMerma(l.cantidad)).ok && quitadas.has((elegirVariante(cruce, "R-12", "005", cantidadConMerma(l.cantidad)) as { variantId: string }).variantId));
    if (hayRetirada) {
      const recuperada = await cotizarBom(bom, dependencias(doble, { vivo }));
      assert.equal(recuperada.ok, true, "con el cruce en vivo se recupera");
      assert.equal(doble.llamadas.length, 2);
    }
    // Con el mismo snapshot no hay nada nuevo que probar: no se repite en vano.
    const mismo = pythonDoble(cruce, { sinVariante: variantes });
    await cotizarBom(bom, dependencias(mismo, { vivo: cruce }));
    assert.equal(mismo.llamadas.length, 1);
    // Cualquier otro fallo del servicio de precios: precio_fallido, sin reintento y sin lanzar.
    const roto = pythonDoble(cruce, { fallo: new Error("el servicio de precios no responde") });
    const fallo = await cotizarBom(bom, dependencias(roto, { vivo }));
    assert.deepEqual(fallo.ok ? null : fallo.razon, "precio_fallido");
    assert.equal(roto.llamadas.length, 1);
    // Más líneas de las que admite `lista-materiales.v1` (256): se dice, no se manda.
    const claves = Object.keys(cruce.entradas).slice(0, 300).map((k) => k.split("|") as [string, string]);
    const enorme = { total: claves.map(([formatoId, codigo]) => ({ formatoId, codigo, cantidad: 3 })), porPieza: {} };
    const demasiadas = await cotizarBom(enorme, dependencias(pythonDoble(cruce)));
    assert.equal(!demasiadas.ok && demasiadas.razon, "precio_fallido");
    const pedido = elegirPedido(enorme.total, cruce);
    assert.ok(pedido.ok && pedido.pedidas.length === 300);
  });

  await caso("el sobre del plan: PlanGuiadoSchema + CotizacionPlanGuiadoSchema, token globos3d, hash de la espec y cantidades que cuadran", async () => {
    let conFlores = 0, sobres = 0;
    for (const c of ARMABLES) {
      const r = resultados.get(c.id)!;
      const cotizada = await cotizarBom(r.bom, dependencias(pythonDoble(cruce)));
      if (!cotizada.ok) continue;
      const sobre = sobreDelMotor({ espec: c.espec, resultado: r, cotizacion: cotizada, concepto: { titulo: `Prueba ${c.id}`.slice(0, 160), descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111" });
      assert.ok(sobre.ok, `${c.id}: ${sobre.ok ? "" : sobre.motivo}`);
      if (!sobre.ok) continue;
      sobres += 1;
      const plan = PlanGuiadoSchema.parse(sobre.plan);
      const cot = CotizacionPlanGuiadoSchema.parse(sobre.cotizacion);
      // El hash es el de la espec; el token es del motor 3D, está firmado sobre ese hash y lleva las variantes que se compran.
      assert.equal(plan.plan_hash, r.especHash);
      assert.equal(plan.plan_hash, especHashDe(c.espec, r.motor.version));
      assert.deepEqual(como<{ motor: unknown }>(plan).motor, r.motor);
      assert.deepEqual(como<{ espec: unknown }>(plan).espec, c.espec);
      const contexto = abrirContextoPlan(plan.approval_token)!;
      assert.equal(contexto.backend, "globos3d");
      assert.equal(contexto.planHash, plan.plan_hash);
      assert.equal(contexto.catalogSnapshotId, cruce.snapshot);
      assert.ok(verificarTokenAprobacion(plan.approval_token, plan.plan_hash));
      assert.equal(verificarTokenAprobacion(plan.approval_token, "0".repeat(64)), null, "el token no vale para otro hash");
      assert.deepEqual(contexto.allowlist.flatMap((a) => a.variant_ids).sort(), plan.compras.map((x) => x.variant_id).sort());
      // Las cantidades: por pieza, por variante y en total, las del motor.
      assert.deepEqual(plan.estructuras.map((e) => e.estructura_id), c.espec.piezas.map((p) => p.id), "las piezas, en el orden de la espec");
      assert.deepEqual(plan.plan.estructuras.map((e) => e.estructura_id), c.espec.piezas.map((p) => p.id));
      for (const e of plan.estructuras) {
        const lineas = como<Array<{ unidades: number; variant_id: string; adorno?: string }>>(e.lineas);
        assert.equal(lineas.reduce((s, l) => s + l.unidades, 0), unidades(r.bom.porPieza[e.estructura_id]!), `${c.id}/${e.estructura_id}: unidades de la pieza`);
        assert.equal(e.total_unidades, unidades(r.bom.porPieza[e.estructura_id]!));
      }
      const compras = como<Array<{ variant_id: string; unidades_necesarias: number; paquetes: number; subtotal: number }>>(plan.compras);
      assert.equal(compras.reduce((s, x) => s + x.unidades_necesarias, 0), unidades(r.bom.total));
      assert.equal(cot.total, compras.reduce((s, x) => s + x.subtotal, 0));
      assert.equal(como<{ totales: { total_cop: number; merma_porcentaje: number } }>(plan).totales.total_cop, cot.total);
      assert.equal(como<{ totales: { total_unidades: number } }>(plan).totales.total_unidades, unidades(r.bom.total));
      // Lo que ya existe lo entiende.
      const desglose = generarPasosPlan(plan);
      assert.equal(desglose.total, unidades(r.bom.total), `${c.id}: los pasos cuentan los mismos globos`);
      // Las flores de globo van en líneas marcadas `adorno: "flor"` (la tarjeta las cuenta de ahí).
      c.espec.piezas.forEach((p) => {
        if (!p.flores) return;
        conFlores += 1;
        const deFlor = como<Array<{ adorno?: string; unidades: number }>>(plan.estructuras.find((e) => e.estructura_id === p.id)!.lineas).filter((l) => l.adorno === "flor");
        assert.equal(deFlor.reduce((s, l) => s + l.unidades, 0), p.flores.cantidad * p.flores.petalos + (p.flores.centro ? p.flores.cantidad : 0), `${c.id}/${p.id}: los globos de las flores`);
        assert.equal(como<{ cantidad: number }>(plan.plan.estructuras.find((e) => e.estructura_id === p.id)!.flores).cantidad, p.flores.cantidad);
      });
    }
    assert.equal(sobres, ARMABLES.length - 1, "todos los casos armables menos la pared densa (sin cobertura en el cruce) llegan a sobre");
    assert.ok(conFlores >= 1, "la idea del aro con flores de globo");
    console.log(`  sobres válidos: ${sobres}; piezas con flores: ${conFlores}`);
  });

  await caso("la misma espec da el mismo plan (id, hash y cantidades); el token cambia con la solicitud pero ata el mismo hash", async () => {
    const c: CasoMotor = todos.find((x) => x.id === "idea-deco-real-07-eb12910e210c94b6184d025127acce95")!;
    const r = resultados.get(c.id)!;
    const cotizada = await cotizarBom(r.bom, dependencias(pythonDoble(cruce))) as CotizacionDelMotor;
    const armar = (requestId: string) => (sobreDelMotor({ espec: c.espec, resultado: r, cotizacion: cotizada, concepto: { titulo: "x", descripcion: "y" }, requestId }) as { ok: true; plan: { plan: { plan_id: string }; plan_hash: string; approval_token: string } }).plan;
    const a = armar("11111111-1111-4111-8111-111111111111"), b = armar("22222222-2222-4222-8222-222222222222");
    assert.equal(a.plan.plan_id, b.plan.plan_id);
    assert.equal(a.plan_hash, b.plan_hash);
    assert.notEqual(a.approval_token, b.approval_token);
    assert.equal(abrirContextoPlan(a.approval_token)!.planHash, abrirContextoPlan(b.approval_token)!.planHash);
  });

  await caso("carrusel: «¿cuánto cuesta?» de una idea con el motor 3d; la lista curada queda para lo que no arma", async () => {
    const ideas = todos.filter((c) => c.id.startsWith("idea-")).map((c) => c.id.replace(/^idea-/, ""));
    assert.equal(ideas.length, 28);
    const cotizadas: string[] = [], curadas: string[] = [];
    for (const id of ideas) {
      const doble = pythonDoble(cruce);
      const r = await cotizarIdeaConMotor(id, { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });
      if (!r.ok) { curadas.push(`${id.slice(0, 12)} (${r.razon})`); assert.equal(doble.llamadas.length <= 1, true); continue; }
      cotizadas.push(id);
      const cot = CotizacionGuiadaSchema.parse(r.cotizacion);
      assert.equal(cot.mermaPorcentaje, 8, "la reserva del 8 % se dice");
      assert.equal(cot.total, cot.lineas.reduce((s, l) => s + l.subtotal, 0));
      assert.equal(cot.lineas.reduce((s, l) => s + l.cantidadNecesaria, 0), r.globos, "las cantidades de la cotización son las del motor");
      for (const l of cot.lineas) assert.equal(l.cantidadNecesaria + l.sobrante, l.paquetes * l.unidadesPaquete);
    }
    assert.equal(cotizadas.length, 26);
    assert.deepEqual(curadas, ["deco-real-03 (no_representable)", "deco-real-27 (no_representable)"], "el centro de mesa con bouquet y el aro parcial siguen con la lista curada");
    // Una idea sin plan guardado (las figuras 21, 23 y 26) y la lista curada de siempre (merma 0) siguen siendo válidas.
    assert.deepEqual(await cotizarIdeaConMotor("deco-real-21-figura", { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }), { ok: false, razon: "sin_plan_guardado" });
    assert.equal(CotizacionGuiadaSchema.safeParse({ lineas: [{ id: "1", tamano: "x", cantidadNecesaria: 1, disponible: true, varianteId: "1", nombre: "n", precioPaquete: 1, unidadesPaquete: 1, paquetes: 1, subtotal: 1, sobrante: 0 }], total: 1, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false }).success, true);
  });

  console.log(`test-motor-guiada-precio: ok (${casos} pruebas, ${ARMABLES.length} casos armables de ${todos.length})`);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
