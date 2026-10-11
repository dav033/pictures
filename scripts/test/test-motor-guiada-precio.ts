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
 * - el carrusel («¿cuánto cuesta?» de una idea) cotiza el plan que recibe el cliente: con el motor, 26 de las 28 ideas; si no, el
 *   plan de Python de la idea guardada (D-038); la lista curada solo para lo que no tiene plan guardado;
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
import { colorSeVendeEnFormato, coloresDelFormato, FORMATOS_GLOBO } from "../../src/lib/globos3d/formatos";
import { abrirContextoPlan, verificarTokenAprobacion } from "../../src/lib/plan/aprobacion";
import { armarDesdeEspec, cantidadConMerma, cotizarBom, crosswalkIncluido, especHashDe, MERMA, MERMA_PORCENTAJE, planearCompra, POLITICA_PAQUETES, sobreDelMotor, type CotizacionDelMotor, type ResultadoMotorV1 } from "../../src/lib/globos3d/motor/v1";
import { claveCruce, construirCrosswalk, CrosswalkSchema, elegirVariante, MOTIVOS_SIN_COBERTURA, normalizarTitulo, presentaciones, type Crosswalk, type FilaCatalogo } from "../../src/lib/globos3d/motor/crosswalk-variantes";
import { optimizarCobertura, pulgadasDeFormato, colorDeCompra } from "../../src/lib/globos3d/motor/plan-de-compra";
import { DIRECTORIO_DORADO, DIRECTORIO_DORADO_PRECIO, todosLosCasos, type CasoMotor, type RegistroDoradoPrecio } from "../lib/casos-motor-guiada";
import { registroPrecio } from "../motor/generar-golden-precio";
import { pythonDoble, type PythonDoble } from "../lib/python-doble-precio";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { decidirCotizacionDelCarrusel } from "../../src/lib/guiada-motor/carrusel";
import { cotizarIdeaConPython } from "../../src/lib/guiada-motor/cotizar-idea-python";
import { isPythonAdapterError, llamarPythonListaMateriales } from "../../src/lib/ia/nucleo/python-adapter";
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
      // El corazón C-12 se arma en cualquier color (decisión del dueño): los que la tabla oficial no le da no son un hueco del cruce, y `presentaciones` dice por qué no hay variante.
      if (formato.id === "C-12" && !colorSeVendeEnFormato(formato.id, ref.codigo)) {
        assert.ok(!(clave in cruce.entradas) && !(clave in cruce.sinCobertura));
        assert.deepEqual(presentaciones(cruce, formato.id, ref.codigo), { ok: false, motivo: "corazon_color_no_vendido" }, clave);
        continue;
      }
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
    assert.deepEqual(declarados, ["LOL-12|970 (no_esta_en_la_tienda)"], "el único hueco: la pared densa por defecto pide el Link Reflex Dorado (la tienda no lo vende). Desde 1.2.0 la columna de la idea 06 se arma con R-12 por bandas de color, y el Azul Caribe en 12″ sí se vende");
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
      assert.equal(dorado.politica, POLITICA_PAQUETES);
      // Lo que se compra cubre lo que cuenta el motor y su reserva: los paquetes se leen del cruce.
      for (const linea of dorado.pedido) {
        const v = cruce.entradas[claveCruce(linea.formatoId, linea.codigo)]!.variantes.find((x) => x.variantId === linea.variantId)!;
        assert.ok(linea.paquetes * v.unidadesPaq >= linea.cantidad + linea.reserva, `${c.id}: ${linea.variantId} no cubre su cantidad y su reserva`);
      }
      assert.equal(dorado.pedido.reduce((suma, l) => suma + l.reserva, 0), dorado.reserva.cubierta);
    }
  });

  const SIN_CRUCE = new Set(todos.filter((c) => registroPrecio(c).faltantes.length > 0).map((c) => c.id));

  await caso("cotizarBom: paquetes de Python, una reserva por globo, una variante por compra y la forma CotizacionPlanGuiado", async () => {
    let cotizadas = 0;
    for (const c of ARMABLES) {
      const r = resultados.get(c.id)!;
      const doble = pythonDoble(cruce);
      const cotizada = await cotizarBom(r.bom, dependencias(doble));
      if (SIN_CRUCE.has(c.id)) { assert.equal(cotizada.ok, false, c.id); assert.equal(!cotizada.ok && cotizada.razon, "sin_cobertura"); assert.equal(doble.llamadas.length, 0, "con un hueco en el cruce no se llama a Python"); continue; }
      assert.ok(cotizada.ok, `${c.id}: ${JSON.stringify(cotizada)}`);
      if (!cotizada.ok) continue;
      cotizadas += 1;
      assert.equal(cotizada.politica, "python");
      assert.equal(doble.llamadas.length, 1);
      const pedido = doble.llamadas[0]!;
      assert.equal(pedido.schema_version, "lista-materiales.v1");
      assert.equal(new Set(pedido.materiales.map((m) => m.variant_id)).size, pedido.materiales.length, "Python no admite variantes repetidas");
      assert.equal(cotizada.compras.reduce((s, x) => s + x.cantidad, 0), unidades(r.bom.total), "las compras cubren exactamente lo que cuenta el motor");
      // D-038: cada globo (talla y color) lleva su reserva, ceil(n × 0,08), y la cubren sus propias compras.
      assert.equal(cotizada.reserva.objetivo, r.bom.total.reduce((s, l) => s + Math.ceil(l.cantidad * MERMA), 0), `${c.id}: la reserva es la de cada globo`);
      // Sus repuestos salen de sus propios paquetes; los que no caben bajo el tope quedan dichos (`sinCubrir`).
      for (const l of r.bom.total) assert.ok(cotizada.compras.filter((x) => x.formatoId === l.formatoId && x.codigo === l.codigo).reduce((s, x) => s + x.reserva, 0) <= Math.ceil(l.cantidad * MERMA), `${c.id}: ${l.formatoId} ${l.codigo} no cubre más que su reserva`);
      assert.equal(cotizada.reserva.sinCubrir, cotizada.reserva.objetivo - cotizada.reserva.cubierta);
      assert.equal(cotizada.compras.reduce((s, x) => s + x.reserva, 0), cotizada.reserva.cubierta);
      for (const compra of cotizada.compras) {
        const capacidad = compra.paquetes * compra.unidadesPaquete;
        assert.equal(compra.cantidadConMerma, compra.cantidad + compra.reserva);
        assert.equal(capacidad - compra.cantidad, compra.sobrante, "el sobrante incluye la reserva y el paquete cerrado");
        assert.ok(capacidad >= compra.cantidadConMerma, "los paquetes cubren la cantidad con su reserva");
        assert.equal(pedido.materiales.find((m) => m.variant_id === compra.variante.variantId)!.cantidad, capacidad, "se pide exactamente lo que cubren los paquetes decididos");
      }
      const cot = CotizacionPlanGuiadoSchema.parse(cotizada.cotizacion);
      assert.equal(cot.mermaPorcentaje, 8);
      assert.equal(cot.incluyeIva, true);
      assert.equal(cot.total, cotizada.compras.reduce((s, x) => s + x.subtotal, 0));
      assert.deepEqual(cot.lineas.map((l) => l.cantidadNecesaria), cotizada.compras.map((x) => x.cantidad));
      assert.equal(cotizada.snapshot, cruce.snapshot, "sin lector del snapshot publicado, el del cruce");
    }
    assert.equal(cotizadas, ARMABLES.length - SIN_CRUCE.size);
  });

  await caso("política de paquetes: por defecto «python» y «mas_barato» sigue disponible detrás de la misma constante", async () => {
    assert.equal(POLITICA_PAQUETES, "python", "el dueño decide (P-035); mientras tanto, como Python");
    const r = resultados.get("idea-deco-real-07-eb12910e210c94b6184d025127acce95")!;
    const barato = await cotizarBom(r.bom, { ...dependencias(pythonDoble(cruce)), politica: "mas_barato" });
    const python = await cotizarBom(r.bom, dependencias(pythonDoble(cruce)));
    assert.ok(barato.ok && python.ok);
    if (!barato.ok || !python.ok) return;
    assert.equal(barato.politica, "mas_barato");
    // «mas_barato»: la merma de cada línea antes del paquete y la presentación que cuesta menos para esa cantidad.
    for (const compra of barato.compras) assert.equal(compra.cantidadConMerma, cantidadConMerma(compra.cantidad));
    assert.equal(barato.compras.length, r.bom.total.length, "una variante por línea del motor");
  });

  await caso("la política «python» compra lo mismo que `_optimizar_cobertura` y `_consolidate` de plan.py (oráculo con el código de Python)", () => {
    const grupos = (c: CasoMotor) => {
      const r = resultados.get(c.id)!;
      return r.bom.total.map((l) => {
        const entrada = cruce.entradas[claveCruce(l.formatoId, l.codigo)]!;
        return { clave: claveCruce(l.formatoId, l.codigo), n: l.cantidad, diam: pulgadasDeFormato(l.formatoId), color: colorDeCompra({ color: entrada.color }, l.codigo), opciones: entrada.variantes.map((v) => ({ variantId: v.variantId, unidades: v.unidadesPaq, precio: v.precio })) };
      });
    };
    const casosOraculo = ARMABLES.filter((c) => !SIN_CRUCE.has(c.id));
    type Salida = Array<{ compras: Array<{ variantId: string; paquetes: number; cantidad: number; reserva: number }>; reserva: { target_waste_reserve: number; covered_waste_reserve: number; natural_package_surplus: number; uncovered_waste_reserve: number } }>;
    let salida: Salida;
    try {
      salida = JSON.parse(execFileSync("python", [path.join(RAIZ, "scripts", "test", "oraculo-python-compra.py")], { encoding: "utf8", input: JSON.stringify(casosOraculo.map((c) => ({ grupos: grupos(c) }))), maxBuffer: 64 * 1024 * 1024 })) as Salida;
    } catch (error) {
      // Solo se omite si no hay `python`; un oráculo que falla (p. ej. plan.py cambió de forma) es un fallo, no un salto.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      console.log("  (sin python utilizable: se omite el oráculo de plan.py)");
      return;
    }
    casosOraculo.forEach((c, k) => {
      const plan = planearCompra(resultados.get(c.id)!.bom.total, cruce, "python");
      assert.ok(plan.ok);
      if (!plan.ok) return;
      const esperado = salida[k]!;
      assert.deepEqual(Object.fromEntries(plan.compras.map((x) => [x.variante.variantId, { paquetes: x.paquetes, cantidad: x.cantidad, reserva: x.reserva }])),
        Object.fromEntries(esperado.compras.map((x) => [x.variantId, { paquetes: x.paquetes, cantidad: x.cantidad, reserva: x.reserva }])), `${c.id}: lo que compra Python`);
      assert.deepEqual({ objetivo: plan.reserva.objetivo, cubierta: plan.reserva.cubierta, sinCubrir: plan.reserva.sinCubrir, excedenteNatural: plan.reserva.excedenteNatural },
        { objetivo: esperado.reserva.target_waste_reserve, cubierta: esperado.reserva.covered_waste_reserve, sinCubrir: esperado.reserva.uncovered_waste_reserve, excedenteNatural: esperado.reserva.natural_package_surplus }, `${c.id}: la reserva`);
    });
    // El optimizador solo, contra una combinación conocida: 60 globos con x12 a 3.963 y x50 a 13.037 salen en un x12 y un x50.
    const mezcla = optimizarCobertura(60, [{ variantId: "a", unidades: 12, precio: 3963 }, { variantId: "b", unidades: 50, precio: 13037 }]);
    assert.deepEqual(mezcla?.compras.map((x) => [x.variantId, x.paquetes]), [["a", 1], ["b", 1]]);
    console.log(`  oráculo de plan.py: ${casosOraculo.length} planes comparados`);
  });

  await caso("ningún color del cliente se pierde: todos están en la lista de materiales de su pieza, o la pieza no se representa", () => {
    for (const c of ARMABLES) {
      const r = resultados.get(c.id)!;
      for (const p of c.espec.piezas) {
        if (r.noRepresentable.some((n) => n.piezaId === p.id)) continue;
        const presentes = new Set((r.bom.porPieza[p.id] ?? []).map((l) => l.codigo));
        for (const color of p.colores) assert.ok(presentes.has(color.codigo), `${c.id}/${p.id}: falta el color ${color.nombre} (${color.codigo})`);
      }
    }
    // La idea 06: seis colores en una columna clásica de 11 capas. Antes perdía dos sin decirlo y luego (1.1.0) se armaba orgánica,
    // con 75 globos de cuatro tamaños; desde 1.2.0 se queda de cuartetos de R-12, 44 globos en bandas de color, con los seis.
    const idea06 = todos.find((c) => c.id.startsWith("idea-deco-real-06"))!;
    const r06 = resultados.get(idea06.id)!;
    assert.deepEqual(r06.noRepresentable, []);
    assert.equal(new Set((r06.bom.porPieza["EST_01_COLUMNA"] ?? []).map((l) => l.codigo)).size >= 6, true);
    const lineas06 = r06.bom.porPieza["EST_01_COLUMNA"] ?? [];
    assert.deepEqual([...new Set(lineas06.map((l) => l.formatoId))], ["R-12"], "la columna de la 06 es de cuartetos de R-12, no la gemela orgánica");
    assert.equal(lineas06.reduce((s, l) => s + l.cantidad, 0), 44, "11 capas de 4 globos, como el armado de Python");
    assert.ok(r06.avisos.some((a) => a.includes("bandas")), `el aviso de las bandas: ${r06.avisos.join(" | ")}`);
    assert.ok(!r06.avisos.some((a) => /se armó orgánica/.test(a)), "ya no se manda a la gemela orgánica");
    // Un color que el armado no reparte no se pierde: la pieza se declara no representable con su motivo.
    const sinLugar = structuredClone(idea06.espec);
    sinLugar.piezas[0]!.colores = [{ codigo: "080", nombre: "negro", peso: 0.99 }, { codigo: "005", nombre: "blanco", peso: 0.01 }];
    sinLugar.piezas[0]!.tamanos = "clasica";
    sinLugar.piezas[0]!.medidas = { altoM: 0.6 };
    const rr = armarDesdeEspec(sinLugar);
    const presentes = new Set((rr.bom.porPieza["EST_01_COLUMNA"] ?? []).map((l) => l.codigo));
    assert.ok(presentes.has("005") || rr.noRepresentable.some((n) => n.piezaId === "EST_01_COLUMNA" && /no llegan a la lista de materiales/.test(n.motivo)), "o el color blanco llega, o la pieza dice por qué no se arma");
  });

  await caso("cotizarBom: fallos tipados, reintento con el cruce en vivo, paquete cambiado y nunca lanza", async () => {
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
    assert.equal(!sinVivo.ok && sinVivo.razon, "material_no_disponible");
    // Con un cruce de OTRO snapshot (el catálogo retiró una variante) se reintenta una vez y sale.
    const plan = planearCompra(bom.total, cruce, "python");
    assert.ok(plan.ok);
    const retirada = plan.ok ? plan.compras.find((x) => cruce.entradas[x.clave]!.variantes.length > 1) : undefined;
    assert.ok(retirada, "hay una compra con más de un paquete disponible");
    if (retirada) {
      const vivo: Crosswalk = { ...structuredClone(cruce), snapshot: "products_catalog:nuevo" };
      vivo.entradas[retirada.clave]!.variantes = vivo.entradas[retirada.clave]!.variantes.filter((v) => v.variantId !== retirada.variante.variantId);
      const doble: PythonDoble = pythonDoble(vivo, { sinVariante: new Set([retirada.variante.variantId]) });
      const recuperada = await cotizarBom(bom, { ...dependencias(doble), crosswalk: async () => cruce, crosswalkEnVivo: async () => vivo });
      assert.equal(recuperada.ok, true, "con el cruce en vivo se recupera");
      assert.equal(doble.llamadas.length, 2);
      assert.equal(recuperada.ok && recuperada.snapshotCruce, "products_catalog:nuevo");
      // El paquete del catálogo cambió (el cruce dice una cosa y la tienda vende otra): el cruce está viejo, no se cobra con una decisión vieja.
      const viejoPaquete: Crosswalk = structuredClone(cruce);
      viejoPaquete.entradas[retirada.clave]!.variantes = viejoPaquete.entradas[retirada.clave]!.variantes.map((v) => (v.variantId === retirada.variante.variantId ? { ...v, unidadesPaq: v.unidadesPaq + 1 } : v));
      const cambiado = await cotizarBom(bom, { ...dependencias(pythonDoble(cruce)), crosswalk: async () => viejoPaquete });
      assert.equal(!cambiado.ok && cambiado.razon, "material_no_disponible");
    }
    // Con el mismo snapshot no hay nada nuevo que probar: no se repite en vano.
    const mismo = pythonDoble(cruce, { sinVariante: variantes });
    await cotizarBom(bom, dependencias(mismo, { vivo: cruce }));
    assert.equal(mismo.llamadas.length, 1);
    // Cualquier otro fallo del servicio de precios: precio_fallido, sin reintento y sin lanzar.
    const roto = pythonDoble(cruce, { fallo: new Error("el servicio de precios no responde") });
    const fallo = await cotizarBom(bom, dependencias(roto, { vivo: { ...cruce, snapshot: "otro" } }));
    assert.deepEqual(fallo.ok ? null : fallo.razon, "precio_fallido");
    assert.equal(roto.llamadas.length, 1);
    // El snapshot publicado manda sobre el del cruce: si cambió, se arma el cruce con él y se anota de dónde salieron los precios.
    const publicado = await cotizarBom(bom, { ...dependencias(pythonDoble(cruce), { vivo: { ...cruce, snapshot: "products_catalog:publicado" } }), snapshotPublicado: async () => "products_catalog:publicado" });
    assert.equal(publicado.ok && publicado.snapshot, "products_catalog:publicado");
    assert.equal(publicado.ok && publicado.snapshotCruce, "products_catalog:publicado");
    const sinLector = await cotizarBom(bom, { ...dependencias(pythonDoble(cruce)), snapshotPublicado: async () => { throw new Error("sin base"); } });
    assert.equal(sinLector.ok && sinLector.snapshot, cruce.snapshot, "si no se puede leer el publicado, el del cruce");
    // Más líneas de las que admite `lista-materiales.v1` (256): se cotizan por trozos y la suma es el total (D-038, A4).
    const claves = Object.keys(cruce.entradas).slice(0, 300).map((k) => k.split("|") as [string, string]);
    const enorme = { total: claves.map(([formatoId, codigo]) => ({ formatoId, codigo, cantidad: 3 })), porPieza: {} }, porTrozos = pythonDoble(cruce);
    const demasiadas = await cotizarBom(enorme, dependencias(porTrozos));
    assert.ok(demasiadas.ok && demasiadas.total === demasiadas.compras.reduce((s, x) => s + x.subtotal, 0) && porTrozos.llamadas.length === 2 && porTrozos.llamadas.every((l) => l.materiales.length <= 256));
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
    assert.equal(sobres, ARMABLES.length - SIN_CRUCE.size, "todos los casos armables sin huecos en el cruce llegan a sobre");
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

  await caso("carrusel: «¿cuánto cuesta?» de una idea con el motor 3d; lo que no arma cae al plan de Python", async () => {
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
    assert.deepEqual(curadas, ["deco-real-03 (no_representable)", "deco-real-27 (no_representable)"], "el centro de mesa con bouquet y el aro parcial caen al plan de Python; la columna de la 06 (ahora de R-12 por bandas) ya se cotiza con el motor");
    // Una idea sin plan guardado (las figuras 21, 23 y 26) y la lista curada de siempre (merma 0) siguen siendo válidas.
    assert.deepEqual(await cotizarIdeaConMotor("deco-real-21-figura", { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }), { ok: false, razon: "sin_plan_guardado" });
    assert.equal(CotizacionGuiadaSchema.safeParse({ lineas: [{ id: "1", tamano: "x", cantidadNecesaria: 1, disponible: true, varianteId: "1", nombre: "n", precioPaquete: 1, unidadesPaquete: 1, paquetes: 1, subtotal: 1, sobrante: 0 }], total: 1, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false }).success, true);
  });

  await caso("el adaptador REAL de Python: el 422 material_no_disponible llega como domainCode y cotizarBom lo tipa (sin doble del adaptador)", async () => {
    const ENTORNO = { PYTHON_BACKEND_URL: "http://python.test", INTERNAL_HMAC_SECRET: "local-only-secret-0123456789abcdef" };
    const entrada = { schema_version: "lista-materiales.v1" as const, materiales: [{ variant_id: "46594221277479", cantidad: 50 }] };
    const llamar = (fetchImpl: typeof fetch) => llamarPythonListaMateriales({ entrada, requestId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002", deadlineMs: 2_000, env: ENTORNO, fetchImpl });
    // El cuerpo de error de Python es `{ detail: { code } }` (main.py `_error_body`).
    const error422 = (codigo: string) => (async () => Response.json({ detail: { code: codigo, request_id: "r", correlation_id: "c" } }, { status: 422 })) as typeof fetch;
    const rechazo = await llamar(error422("material_no_disponible")).then(() => null, (e: unknown) => e);
    assert.ok(isPythonAdapterError(rechazo), "el adaptador lanza su error tipado");
    if (isPythonAdapterError(rechazo)) assert.deepEqual({ code: rechazo.code, status: rechazo.status, domainCode: rechazo.domainCode }, { code: "PYTHON_INVALID_REQUEST", status: 422, domainCode: "material_no_disponible" });
    const bom = resultados.get("idea-deco-real-01-305")!.bom;
    const cotizar = (fetchImpl: typeof fetch) => cotizarBom(bom, { crosswalk: async () => cruce, cotizarLista: (e) => llamarPythonListaMateriales({ entrada: e, requestId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002", deadlineMs: 2_000, env: ENTORNO, fetchImpl }) });
    assert.equal((await cotizar(error422("material_no_disponible"))).ok, false);
    assert.equal(await cotizar(error422("material_no_disponible")).then((r) => !r.ok && r.razon), "material_no_disponible", "con el adaptador real, el 422 todo-o-nada se reconoce");
    assert.equal(await cotizar(error422("otra_cosa")).then((r) => !r.ok && r.razon), "precio_fallido", "otro 422 no es un cruce viejo");
    assert.equal(await cotizar((async () => Response.json({ detail: { code: "internal" } }, { status: 500 })) as typeof fetch).then((r) => !r.ok && r.razon), "precio_fallido");
    // Y la ruta feliz de punta a punta con el adaptador real: la respuesta de Python se valida contra su contrato y se usa.
    const ok = await cotizar((async (_url: string | URL | Request, init?: RequestInit) => {
      const pedido = JSON.parse(String(init?.body)) as { materiales: Array<{ variant_id: string; cantidad: number }> };
      return Response.json({ schema_version: "operational.v1", request_id: "00000000-0000-4000-8000-000000000001", correlation_id: "00000000-0000-4000-8000-000000000002", payload: await (await pythonDoble(cruce).cotizarLista({ schema_version: "lista-materiales.v1", materiales: pedido.materiales })) });
    }) as typeof fetch);
    assert.equal(ok.ok, true);
  });

  await caso("carrusel (D-038): «¿cuánto cuesta?» es el precio del plan que recibe el cliente, y el motor solo se carga con la bandera en 3d", async () => {
    let cargas = 0, python = 0;
    const motorOk = async (id: string) => { cargas += 1; return cotizarIdeaConMotor(id, { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }); };
    const cotizacionPython = { lineas: [{ id: "v1", tamano: "R-12", cantidadNecesaria: 10, disponible: true, varianteId: "v1", nombre: "Globo", precioPaquete: 3963, unidadesPaquete: 12, paquetes: 1, subtotal: 3963, sobrante: 2 }], total: 3963, mermaPorcentaje: 8, incluyeIva: true, complementosSoportados: false as const };
    const pythonOk = async (id: string) => { python += 1; return cotizarIdeaConPython(id, { planGuardado: planGuardadoDeIdea, resolver: async () => ({ cotizacion: cotizacionPython }) }); };
    const deps = (motor: "3d" | "python", extra: Partial<Parameters<typeof decidirCotizacionDelCarrusel>[1]> = {}) => ({ leerMotor: async () => motor, tienePlanGuardado: async (id: string) => planGuardadoDeIdea(id) !== null, cotizarConMotor: motorOk, cotizarConPython: pythonOk, ...extra });
    const IDEA = "deco-real-07-eb12910e210c94b6184d025127acce95";
    // python: el plan de Python de la idea guardada, y ni se toca el motor.
    const dePython = await decidirCotizacionDelCarrusel(IDEA, deps("python"));
    assert.equal(dePython.usar, "plan_python");
    if (dePython.usar === "plan_python") { assert.equal(dePython.motivo, "bandera_python"); assert.equal(dePython.resultado.cotizacion.total, 3963); }
    assert.equal(cargas, 0, "con la bandera en python el motor no se carga");
    // 3d: el precio del motor (el del plan del 3D).
    const delMotor = await decidirCotizacionDelCarrusel(IDEA, deps("3d"));
    assert.equal(delMotor.usar, "motor");
    assert.equal(cargas, 1);
    if (delMotor.usar === "motor") { assert.equal(delMotor.resultado.cotizacion.mermaPorcentaje, 8); assert.ok(delMotor.resultado.cotizacion.total > 0); }
    // 3d, pero el motor no la arma: el plan cae a Python y la tarjeta también.
    const aproximada = await decidirCotizacionDelCarrusel("deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", deps("3d"));
    assert.deepEqual(aproximada.usar === "plan_python" ? aproximada.motivo : null, "no_representable");
    // Sin plan guardado (las figuras): la lista curada, y no se cotiza ni con el motor ni con Python.
    const antes = { cargas, python };
    assert.deepEqual(await decidirCotizacionDelCarrusel("deco-real-21-figura", deps("3d")), { usar: "curada", motivo: "sin_plan_guardado" });
    assert.deepEqual({ cargas, python }, antes);
    // Un fallo al leer la bandera nunca tumba el turno: queda el plan de Python.
    const sinBandera = await decidirCotizacionDelCarrusel(IDEA, deps("3d", { leerMotor: async () => { throw new Error("sin base"); } }));
    assert.deepEqual(sinBandera.usar === "plan_python" ? sinBandera.motivo : null, "no_se_pudo_leer_la_bandera");
    // Un fallo pasajero del motor o de su precio no cae a Python: no hay precio (el plan del 3D podría salir luego con otro).
    assert.deepEqual(await decidirCotizacionDelCarrusel(IDEA, deps("3d", { cotizarConMotor: async () => { throw new Error("se cayó"); } })), { usar: "sin_precio", motivo: "error_del_motor", detalle: "se cayó" });
    assert.equal((await decidirCotizacionDelCarrusel(IDEA, deps("3d", { cotizarConMotor: async () => ({ ok: false, razon: "precio_fallido" }) }))).usar, "sin_precio");
    // Si Python tampoco cotiza, no hay precio: nunca otro número que el del plan.
    const nada = await decidirCotizacionDelCarrusel(IDEA, deps("python", { cotizarConPython: async () => { throw new Error("python caído"); } }));
    assert.deepEqual(nada, { usar: "sin_precio", motivo: "error_de_python", detalle: "python caído" });
    const sinPlanes = await decidirCotizacionDelCarrusel(IDEA, deps("python", { tienePlanGuardado: async () => { throw new Error("json roto"); } }));
    assert.deepEqual(sinPlanes, { usar: "sin_precio", motivo: "error_planes_guardados", detalle: "json roto" }, "sin leer los planes guardados no se cae a la lista curada");
    // La ruta del asistente no importa el motor, el cruce ni los planes guardados de forma estática: solo con `import()`.
    const ruta = readFileSync(path.join(RAIZ, "src", "app", "api", "asistente-guiado", "route.ts"), "utf8");
    const importesEstaticos = [...ruta.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]!);
    for (const prohibido of ["@/lib/globos3d/motor/v1", "@/lib/guiada-motor/cotizar-idea", "@/lib/guiada-motor/cotizar-idea-python", "@/lib/plan/planes-ideas-guardados"]) assert.ok(!importesEstaticos.includes(prohibido), `${prohibido} no debe importarse de forma estática en la ruta`);
    assert.match(ruta, /import\("@\/lib\/globos3d\/motor\/v1"\)/);
  });

  console.log(`test-motor-guiada-precio: ok (${casos} pruebas, ${ARMABLES.length} casos armables de ${todos.length})`);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
