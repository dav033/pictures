/**
 * Flores de globo como adorno de cualquier pieza (dueño, 2026-10-07: «hacer que se soporte como tipo estructuritas como
 * flores de globo en todas las estructuras … agrupaciones de 3 globos R5 y poco más»). Comprueba, sin red, sin Python
 * y sin modelo (US$0):
 *   1. el contrato: `flores` en una estructura del plan (1.0 y 1.1), la edición `flores`, la marca `adorno` de una línea
 *      resuelta y las reglas que Python lee del esquema exportado (`x-reglas-flores`);
 *   2. la tarjeta «+ 4 flores (16 globos de 5″)», «Ver detalle» y la nota de la cotización, con renderToStaticMarkup;
 *   3. (el caption FLUX va aparte, con las condiciones de servidor: `test-flores-caption-flux.ts`);
 *   4. la regla del chat («ponle flores», «agrega 3 flores doradas a la columna», «quítale las flores») y la edición que
 *      sale de ella;
 *   5. de la foto al plan: la lectura `lecturas.flores` → `appearance.flores` → adorno de la pieza con SUS globos;
 *   6. el plan exacto de la idea «Aro de globos blanco, dorado y nude con flores» (la del dueño): lleva sus 2 flores y sus
 *      líneas con color nulo (Fashion Latte) ya no rompen los pasos de la tarjeta (la causa de que la guiada cayera a
 *      /api/chat y saliera con globos mate);
 *   7. el acabado de la foto: un blanco perlado se compra en Silk Blanco Nácar (el catálogo no etiqueta el acabado Silk).
 *
 *   npx tsx scripts/test/test-flores-pieza.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilaPieza } from "@/components/guiado/FilaPieza";
import { CostosMateriales } from "@/components/guiado/CostosMateriales";
import { DetalleGlobos } from "@/components/guiado/TablaGlobosPieza";
import { notaFloresCotizacion, piezasVistaDePlan } from "@/components/guiado/piezas-vista";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { PlanResueltoV1Schema } from "@/lib/ia/contracts/domain-v1";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { detectarPedidoEdicion, fraseDelPedido, type PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";
import { planActualDesdePlan } from "@/lib/ia/guiado/instruccion-plan";
import { avisoEdicionChat, ejecutarEdicionChat } from "@/components/guiado/ajuste/edicion-chat-guiada";
import { LECTURA_UNICA_RULES, LECTURA_UNICA_TOOL_SCHEMA } from "@/lib/ia/referencia/lectura-unica";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { EdicionFloresSchema } from "@/lib/plan/edicion-esquemas";
import {
  aplicarFloresDeFoto,
  edicionFloresDePedido,
  floresLeidasDeCrudo,
  FloresPiezaV1Schema,
  pedidoFloresDeTexto,
  reglasFlores,
  resumenFlores,
  textoFlores,
} from "@/lib/plan/flores-pieza";
import { PlanDecoracion1_1Schema, PlanDecoracionSchema } from "@/lib/plan/tipos";
import { aplicarAcabadoReferencia } from "@/lib/plan/cobertura-materiales";

let fallos = 0;
async function caso(nombre: string, prueba: () => Promise<void> | void): Promise<void> {
  try {
    await prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

const sinAccion = () => undefined;
const desescapar = (html: string) => html.replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

const FLORES = { cantidad: 4, petalo: { product_id: "8634239385895", color: "azul" }, centro: { product_id: "8634239385895", color: "azul" } };

/** El plan guiado de prueba (semiarco + 2 columnas, registro dgkw9b) con 4 flores en la primera pieza y sus líneas de Python. */
function planConFlores() {
  const crudo = JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")) as {
    plan: { estructuras: Array<Record<string, unknown>> };
    estructuras: Array<{ estructura_id: string; lineas: Array<Record<string, unknown>> }>;
  };
  const primera = crudo.plan.estructuras[0]!;
  const material = (primera.materiales as Array<{ product_id: string; color?: string }>)[0]!;
  const segundo = (primera.materiales as Array<{ product_id: string; color?: string }>)[1] ?? material;
  primera.flores = { cantidad: 4, petalo: { product_id: material.product_id, color: material.color }, centro: { product_id: segundo.product_id, color: segundo.color } };
  const lineas = crudo.estructuras.find((estructura) => estructura.estructura_id === primera.estructura_id)!.lineas;
  const r5 = lineas.find((linea) => linea.diam_pulg === 5) ?? lineas[0]!;
  lineas.push({ ...r5, color: material.color ?? null, unidades: 12, adorno: "flor" }, { ...r5, color: segundo.color ?? null, unidades: 4, adorno: "flor" });
  return PlanGuiadoSchema.parse(crudo);
}

async function principal(): Promise<void> {
  await caso("1. contrato: flores en la estructura, edición y marca de línea; reglas en el esquema exportado", () => {
    assert.equal(FloresPiezaV1Schema.safeParse(FLORES).success, true);
    assert.equal(FloresPiezaV1Schema.safeParse({ ...FLORES, cantidad: 0 }).success, false, "al menos una flor");
    assert.equal(FloresPiezaV1Schema.safeParse({ ...FLORES, petalos: 2 }).success, false, "3 pétalos o más");
    assert.equal(FloresPiezaV1Schema.safeParse({ ...FLORES, extra: 1 }).success, false, "estricto");
    const plan = JSON.parse(readFileSync("contracts/domain/v1/fixtures/plan-resuelto-ok.json", "utf8")).plan;
    plan.estructuras[0].flores = FLORES;
    assert.equal(PlanDecoracionSchema.safeParse(plan).success, true, "Plan 1.0 acepta flores");
    assert.equal(PlanDecoracion1_1Schema.shape.estructuras.element.safeParse({ ...plan.estructuras[0] }).success, true, "Plan 1.1 también");
    assert.equal(EdicionFloresSchema.safeParse({ accion: "flores", estructura_id: "EST_01_ARCO", flores: FLORES }).success, true);
    assert.equal(EdicionFloresSchema.safeParse({ accion: "flores", estructura_id: "EST_01_ARCO", flores: null }).success, true, "null las quita");
    const exportado = JSON.parse(readFileSync("contracts/domain/v1/plan-decoracion.schema.json", "utf8"));
    assert.deepEqual(exportado["x-reglas-flores"], reglasFlores(), "Python lee las mismas reglas");
    assert.deepEqual(reglasFlores(), { pulgadas: 5, petalos_por_defecto: 3, adorno: "flor" });
    assert.ok(exportado.properties.estructuras.items.properties.flores, "el esquema exportado declara flores");
    const resuelto = JSON.parse(readFileSync("contracts/domain/v1/plan-resuelto.schema.json", "utf8"));
    assert.deepEqual(resuelto.properties.estructuras.items.properties.lineas.items.properties.adorno, { type: "string", enum: ["flor"] });
    const ok = JSON.parse(readFileSync("contracts/domain/v1/fixtures/plan-resuelto-ok.json", "utf8"));
    ok.estructuras[0].lineas[0].adorno = "flor";
    assert.equal(PlanResueltoV1Schema.safeParse(ok).success, true, "una línea de flor pasa el contrato del resuelto");
  });

  await caso("2. tarjeta, «Ver detalle» y cotización: «+ 4 flores (16 globos de 5″)» con los globos que resolvió Python", () => {
    assert.equal(textoFlores({ flores: 4, globos: 16, pulgadas: [5] }), "+ 4 flores (16 globos de 5″)");
    assert.equal(textoFlores({ flores: 1, globos: 4, pulgadas: [5] }), "+ 1 flor (4 globos de 5″)");
    assert.equal(textoFlores({ flores: 2, globos: 8, pulgadas: [5, 9] }), "+ 2 flores (8 globos de 5″ y 9″)");
    assert.equal(resumenFlores({ flores: { cantidad: 2 }, repeticiones: 1 }, []), null, "sin línea de flor no se promete nada");
    assert.deepEqual(resumenFlores({ flores: { cantidad: 2 }, repeticiones: 2 }, [{ adorno: "flor", unidades: 12, diam_pulg: 5 }, { unidades: 99, diam_pulg: 12 }]), { flores: 4, globos: 12, pulgadas: [5] });
    const plan = planConFlores();
    const piezas = piezasVistaDePlan(plan);
    assert.deepEqual(piezas[0]!.flores, { flores: 4, globos: 16, pulgadas: [5] });
    assert.equal(piezas[1]!.flores ?? null, null, "las demás piezas no llevan flores");
    const fila = desescapar(renderToStaticMarkup(createElement(FilaPieza, { pieza: piezas[0]!, dibujo: null, indice: 0 })));
    assert.match(fila, /\+ 4 flores \(16 globos de 5″\)/);
    const sinFlores = desescapar(renderToStaticMarkup(createElement(FilaPieza, { pieza: piezas[1]!, dibujo: null, indice: 1 })));
    assert.doesNotMatch(sinFlores, /flores/);
    const detalle = desescapar(renderToStaticMarkup(createElement(DetalleGlobos, { piezas, total: 100 })));
    assert.match(detalle, /Incluye las flores de globo: 4 flores \(16 globos de 5″\)/);
    const nota = notaFloresCotizacion(piezas);
    assert.equal(nota, `Incluye flores de globo: ${piezas[0]!.nombre}, + 4 flores (16 globos de 5″).`);
    const cotizacion = { lineas: [{ id: "1", tamano: "R-5", cantidadNecesaria: 16, disponible: true, varianteId: "v", nombre: "Globo", precioPaquete: 1000, unidadesPaquete: 50, paquetes: 1, subtotal: 1000, sobrante: 34 }], total: 1000, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false } as never;
    const costos = desescapar(renderToStaticMarkup(createElement(CostosMateriales, { cotizacion, uso: "personal", clave: "x", onProveedores: sinAccion, mensajePendiente: "", notaFlores: nota })));
    assert.match(costos, /Incluye flores de globo: .*\+ 4 flores \(16 globos de 5″\)/);
    // Los pasos de «Aprender» nombran las flores con sus globos.
    const pasos = generarPasosPlan(plan).pasos.map((paso) => paso.texto).join("\n");
    assert.match(pasos, /Arma las 4 flores de globo de .*: amarra 3 globos .* de 5″ como pétalos, con un globo .* al centro/);
  });

  await caso("4. chat: «ponle flores» y compañía → la edición `flores` de la pieza, con globos del plan", () => {
    assert.deepEqual(pedidoFloresDeTexto("ponle flores"), { tipo: "flores", quitar: false, cantidad: null, colorPetalo: null, colorCentro: null });
    assert.deepEqual(pedidoFloresDeTexto("agrega 3 flores doradas a la columna"), { tipo: "flores", quitar: false, cantidad: 3, colorPetalo: "dorado", colorCentro: null });
    assert.deepEqual(pedidoFloresDeTexto("ponle dos flores blancas con centro dorado al arco"), { tipo: "flores", quitar: false, cantidad: 2, colorPetalo: "blanco", colorCentro: "dorado" });
    assert.equal(pedidoFloresDeTexto("quítale las flores a la columna")?.quitar, true);
    assert.equal(pedidoFloresDeTexto("cambia el azul por celeste"), null, "sin flores no es un pedido de flores");
    const plan = {
      estructuras: [
        { estructura_id: "EST_01_COLUMNA", materiales: [{ product_id: "blanco", color: "blanco" }, { product_id: "rosa", color: "rosado" }] },
        { estructura_id: "EST_02_ARCO", materiales: [{ product_id: "oro", color: "dorado" }] },
      ],
    };
    const sinColor = edicionFloresDePedido(plan, "EST_01_COLUMNA", pedidoFloresDeTexto("ponle flores")!);
    assert.deepEqual(sinColor, { ok: true, edicion: { accion: "flores", estructura_id: "EST_01_COLUMNA", flores: { cantidad: 3, petalo: { product_id: "blanco", color: "blanco" }, centro: { product_id: "rosa", color: "rosado" } } } });
    // «doradas» en una columna sin dorado: el globo dorado del arco (ya en la allowlist firmada del plan).
    const doradas = edicionFloresDePedido(plan, "EST_01_COLUMNA", pedidoFloresDeTexto("agrega 3 flores doradas a la columna")!);
    assert.ok(doradas.ok && doradas.edicion.flores?.petalo.product_id === "oro" && doradas.edicion.flores.cantidad === 3, JSON.stringify(doradas));
    assert.ok(doradas.ok && EdicionFloresSchema.safeParse(doradas.edicion).success, "la edición pasa el contrato de /api/plan-editar");
    const verdes = edicionFloresDePedido(plan, "EST_01_COLUMNA", pedidoFloresDeTexto("ponle flores verdes")!);
    assert.equal(verdes.ok, false, "un color que el plan no compra se dice, no se inventa");
    const quitar = edicionFloresDePedido({ estructuras: [{ ...plan.estructuras[0]!, flores: FLORES }] }, "EST_01_COLUMNA", pedidoFloresDeTexto("sin flores")!);
    assert.deepEqual(quitar, { ok: true, edicion: { accion: "flores", estructura_id: "EST_01_COLUMNA", flores: null } });
  });

  await caso("4b. chat guiado: la regla lee el pedido de flores y la vista lo aplica con la edición `flores` de /api/plan-editar", async () => {
    const plan = planConFlores();
    const sinFlores = PlanGuiadoSchema.parse({ ...plan, approval_token: "token", plan: { ...plan.plan, estructuras: plan.plan.estructuras.map((estructura) => { const copia = { ...estructura }; delete copia.flores; return copia; }) } });
    const actual = planActualDesdePlan(sinFlores)!;
    const columna = actual.piezas.find((pieza) => pieza.estructura.startsWith("columna"))?.nombre ?? actual.piezas[0]!.nombre!;
    const deteccion = detectarPedidoEdicion(`agrega 3 flores a la ${columna.toLocaleLowerCase("es")}`, actual);
    assert.equal(deteccion.estado, "edicion", JSON.stringify(deteccion));
    assert.ok(deteccion.estado === "edicion" && deteccion.herramienta === "flores_plan");
    const pedido = deteccion.estado === "edicion" ? deteccion.pedido : null;
    assert.ok(pedido && pedido.tipo === "flores" && pedido.cantidad === 3 && !pedido.quitar, JSON.stringify(pedido));
    assert.match(fraseDelPedido(pedido!), /^Pongo 3 flores de globo/);
    assert.equal(detectarPedidoEdicion("ponle flores", actual).estado, "edicion", "sin pieza nombrada: todas");
    // La vista: una edición `flores` por pieza, por la misma ruta que el editor (/api/plan-editar, modo aplicar).
    const llamadas: unknown[] = [];
    const deps = {
      aplicar: async (base: typeof sinFlores, edicion: unknown) => { llamadas.push(edicion); return { plan: base, cotizacion: null }; },
      quitarPieza: async () => { throw new Error("no"); },
      agregarColor: async () => { throw new Error("no"); },
      buscarGlobos: async () => [],
    };
    const hecha = await ejecutarEdicionChat(sinFlores, pedido!, deps as never);
    assert.equal(llamadas.length, 1, "una sola pieza nombrada");
    assert.ok(EdicionFloresSchema.safeParse(llamadas[0]).success, JSON.stringify(llamadas[0]));
    assert.equal((llamadas[0] as { flores: { cantidad: number } }).flores.cantidad, 3);
    assert.match(hecha.confirmacion, /^Listo: puse 3 flores de globo en /);
    assert.equal(avisoEdicionChat(pedido!), "Pongo las flores de globo; lo demás queda igual…");
    // «flores verdes» con un plan sin verde: se dice, no se inventa un globo.
    const verdes = detectarPedidoEdicion("ponle flores verdes a todo", actual);
    assert.ok(verdes.estado === "edicion");
    await assert.rejects(ejecutarEdicionChat(sinFlores, (verdes as { pedido: PedidoEdicionPlan }).pedido, deps as never), /no lleva globos verde/);
  });

  await caso("5. de la foto al plan: lecturas.flores → appearance.flores → adorno con los globos de la pieza", () => {
    assert.ok("flores" in LECTURA_UNICA_TOOL_SCHEMA.properties, "la lectura pide las flores");
    assert.match(LECTURA_UNICA_RULES, /`lecturas\.flores` — only when the piece carries BALLOON FLOWERS/);
    assert.deepEqual(floresLeidasDeCrudo({ cantidad: 2, color_petalo: "blanco", color_centro: "dorado", confianza: 0.8 }), { cantidad: 2, color_petalo: "blanco", color_centro: "dorado", confianza: 0.8 });
    assert.equal(floresLeidasDeCrudo({ cantidad: 2, confianza: 0.8 }), null, "sin color de pétalo no hay lectura");
    assert.equal(floresLeidasDeCrudo({ cantidad: 40, color_petalo: "blanco", confianza: 0.9 })?.cantidad, 24, "se acota al tope");
    const ejemplos = JSON.parse(readFileSync("src/lib/ia/amaterasu/lecturas-ejemplos.json", "utf8")).ejemplos;
    const ejemplo = structuredClone((Array.isArray(ejemplos) ? ejemplos[0] : Object.values(ejemplos)[0]).analisis.blueprint);
    const elemento = ejemplo.elements.find((item: { category: string }) => item.category === "balloon_structure") ?? ejemplo.elements[0];
    elemento.appearance.flores = { cantidad: 2, color_petalo: "blanco", color_centro: "dorado", confianza: 0.8 };
    assert.equal(ReferenceBlueprintV2Schema.safeParse(ejemplo).success, true, "el blueprint admite appearance.flores");
    const plan = {
      estructuras: [
        { estructura_id: "EST_01_ARO", referencia_element_id: "REF_01_E01", materiales: [{ product_id: "silk-blanco", color: "blanco" }, { product_id: "reflex-dorado", color: "dorado" }, { product_id: "latte" }] },
        { estructura_id: "EST_02_COLUMNA", referencia_element_id: "REF_01_E02", materiales: [{ product_id: "rosa", color: "rosado" }] },
      ],
    };
    const blueprint = { elements: [
      { element_id: "REF_01_E01", approved: true, appearance: { flores: { cantidad: 2, color_petalo: "blanco", color_centro: "dorado", confianza: 0.8 } } },
      { element_id: "REF_01_E02", approved: true, appearance: { flores: { cantidad: 3, color_petalo: "verde", confianza: 0.9 } } },
    ] };
    const aplicado = aplicarFloresDeFoto(plan, blueprint);
    assert.deepEqual((aplicado.plan.estructuras[0] as { flores?: unknown }).flores, { cantidad: 2, petalo: { product_id: "silk-blanco", color: "blanco" }, centro: { product_id: "reflex-dorado", color: "dorado" } }, "el pétalo perlado sale del perlado de la pieza");
    assert.equal((aplicado.plan.estructuras[1] as { flores?: unknown }).flores, undefined, "ningún globo verde en el plan: no se inventa uno");
    assert.equal(aplicado.omitidas[0]?.estructura_id, "EST_02_COLUMNA");
    // Corrector 2026-10-07: la columna rosada con flores blancas en la foto las arma con el blanco del aro (ya firmado).
    const prestado = aplicarFloresDeFoto(plan, { elements: [{ element_id: "REF_01_E02", approved: true, appearance: { flores: { cantidad: 3, color_petalo: "blanco", confianza: 0.9 } } }] });
    assert.deepEqual((prestado.plan.estructuras[1] as { flores?: unknown }).flores, { cantidad: 3, petalo: { product_id: "silk-blanco", color: "blanco" } }, "el blanco de otra pieza del plan");
    const pocaConfianza = aplicarFloresDeFoto(plan, { elements: [{ element_id: "REF_01_E01", approved: true, appearance: { flores: { cantidad: 2, color_petalo: "blanco", confianza: 0.3 } } }] });
    assert.equal(pocaConfianza.aplicadas.length, 0);
  });

  await caso("6. el plan exacto de la idea del dueño lleva sus flores y sus líneas sin color no rompen la tarjeta", () => {
    const idea = JSON.parse(readFileSync("src/lib/biblioteca-sempertex/planes-ideas.json", "utf8")).ideas["deco-real-28-aro-blanco-dorado-y-nude"];
    assert.deepEqual(idea.plan.estructuras[0].flores, { cantidad: 2, petalos: 6, petalo: { product_id: "9661845995815", color: "blanco" }, centro: { product_id: "8634255638823", color: "dorado" } }, "Silk Blanco Nácar de pétalo y Reflex Dorado de centro, los globos de la pieza");
    // Producción (guiada-20261007-055327-t4ttju): ZodError en estructuras.0.lineas.2.color (Fashion Latte, color null).
    const guardado = JSON.parse(readFileSync("data/biblioteca-real/analisis/nueva-sempertex-08.plan.json", "utf8"));
    assert.equal(guardado.plan_resuelto.estructuras[0].lineas[2].color, null, "el caso real: una línea sin color");
    const pasos = generarPasosPlan(guardado.plan_resuelto);
    assert.ok(pasos.total > 0, "los pasos se generan con las líneas sin color");
  });

  await caso("7. acabado de la foto: un blanco perlado se compra en Silk Blanco Nácar aunque el catálogo no etiquete su acabado", () => {
    const plan = JSON.parse(readFileSync("contracts/domain/v1/fixtures/plan-resuelto-ok.json", "utf8")).plan;
    plan.estructuras[0].materiales = [{ product_id: "fashion-blanco", color: "blanco", participacion: 1, rol_material: "principal" }];
    const producto = (titulo: string, acabados: string[]) => ({ titulo, categoria: "globo_latex", colores: ["blanco"], coloresVariante: ["blanco"], mezclas: ["clasica", "organica_fina"] as never, acabados });
    const disponibilidad = new Map([
      ["fashion-blanco", producto("B2b Globo Latex Redondo Fashion Blanco", ["fashion"])],
      // El catálogo real: «Silk Blanco Nácar» llega con `finishes: []` (consulta al snapshot 13a9033d, 2026-10-07).
      ["silk-blanco", producto("B2b Globo Latex Redondo Silk Blanco Nácar", [])],
    ]);
    const { plan: ajustado, ajustes } = aplicarAcabadoReferencia(PlanDecoracionSchema.parse(plan), [{ estructura_id: "EST_01_ARCO", product_id: "fashion-blanco", acabado: "satin" }], disponibilidad);
    const material = ajustado.estructuras[0]!.materiales[0]!;
    assert.equal(material.product_id, "silk-blanco", JSON.stringify(ajustes));
    assert.equal(material.acabado, undefined, "sin acabado de catálogo no se manda: Python filtraría todas sus variantes");
    assert.equal(ajustes[0]?.tipo, "acabado_referencia");
    // Un Silk ya elegido cumple el perlado: no se toca ni se avisa.
    plan.estructuras[0].materiales = [{ product_id: "silk-blanco", color: "blanco", participacion: 1, rol_material: "principal" }];
    const quieto = aplicarAcabadoReferencia(PlanDecoracionSchema.parse(plan), [{ estructura_id: "EST_01_ARCO", product_id: "silk-blanco", acabado: "satin" }], disponibilidad);
    assert.deepEqual(quieto.ajustes, []);
  });

  if (fallos) {
    console.error(`\n${fallos} caso(s) fallaron`);
    process.exit(1);
  }
  console.log("\nflores-pieza: todo bien");
}

void principal();
