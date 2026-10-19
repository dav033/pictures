import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlan } from "@/components/guiado/TarjetaPlan";
import type { CandidatoDelServidor } from "@/components/plan/ajuste/ajuste-propuesta";
import { avisoEdicionChat, ejecutarEdicionChat, type DependenciasEdicionChat, type PiezaParaServidor } from "@/components/guiado/ajuste/edicion-chat-guiada";
import type { PlanGuiado } from "@/components/guiado/ajuste/ajuste-plan-guiado";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { responderConsultaPlan } from "@/lib/ia/guiado/consulta-plan-chat";
import {
  detectarConsultaPlan,
  detectarPedidoEdicion,
  detectarPiezaNueva,
  fraseDelPedido,
  herramientasConEdicion,
  PedidoEdicionPlanSchema,
  pedidoDesdeHerramienta,
  type DeteccionEdicion,
  type PedidoEdicionPlan,
} from "@/lib/ia/guiado/edicion-plan-chat";
import { cuerpoPlanFoto, lecturaConPiezaNueva, planLlevaPiezaPedida } from "@/lib/ia/guiado/foto-con-pieza";
import { planActualDesdePlan } from "@/lib/ia/guiado/instruccion-plan";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { planConPiezaEditada, planConPiezaNueva, piezasIntactas, ubicacionDePieza } from "@/lib/plan/pieza-nueva";
import { separarEstructurasRepetidas } from "@/lib/plan/piezas-individuales";
import { extraerRestriccionesUsuario } from "@/lib/plan/restricciones";

/**
 * El CRUD del plan por chat en la guiada (dueño, 2026-10-07: tras leer una foto de DOS COLUMNAS, «puedes agregar una
 * guirnalda en medio?» armaba un plan NUEVO solo con la guirnalda y perdía las columnas). Sin red, sin modelo y sin
 * coste: reglas (texto → operación), la pieza nueva sobre el plan real de columnas conservando las demás, la lectura
 * determinista de ejemplo-01 con la guirnalda pedida, las consultas y los cambios de pieza con dobles de /api/plan-editar.
 *
 * Run: npx tsx scripts/test/test-crud-plan-chat-guiada.ts
 */

// --- El plan real: semiarco orgánico + columna izquierda + columna derecha (registro dgkw9b) ------------------------
const crudo = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const separado = separarEstructurasRepetidas(crudo.plan).plan;
const [SEMIARCO, IZQUIERDA, DERECHA] = separado.estructuras.map((estructura) => estructura.estructura_id) as [string, string, string];
const plan: PlanGuiado = PlanGuiadoSchema.parse({
  ...crudo,
  approval_token: "token-de-prueba",
  plan: separado,
  estructuras: [crudo.estructuras[0]!, { ...crudo.estructuras[1]!, estructura_id: IZQUIERDA }, { ...crudo.estructuras[1]!, estructura_id: DERECHA }],
});
const actual = planActualDesdePlan(plan)!;
assert.ok(actual, "el plan se resume para el turno");

// Solo las dos columnas (el plan que deja la foto del dueño), para las frases sobre «en medio».
const soloColumnas: PlanGuiado = PlanGuiadoSchema.parse({ ...plan, plan: { ...plan.plan, estructuras: plan.plan.estructuras.slice(1).map((estructura, indice) => (indice === 0 ? { ...estructura, rol_escena: "focal" as const } : estructura)) }, estructuras: plan.estructuras.slice(1) });
const actualColumnas = planActualDesdePlan(soloColumnas)!;

function deteccion(texto: string, sobre = actual, ultimoAsistente: string | null = null): DeteccionEdicion {
  return detectarPedidoEdicion(texto, sobre, { ultimoAsistente });
}
function edicionDe(texto: string, sobre = actual, ultimoAsistente: string | null = null): PedidoEdicionPlan {
  const leida = deteccion(texto, sobre, ultimoAsistente);
  assert.equal(leida.estado, "edicion", `«${texto}» es una edición completa: ${JSON.stringify(leida)}`);
  const pedido = (leida as Extract<DeteccionEdicion, { estado: "edicion" }>).pedido;
  assert.ok(PedidoEdicionPlanSchema.safeParse(pedido).success, `«${texto}» cumple el contrato que lee la vista`);
  return pedido;
}

// --- 1. Reglas: texto → operación (C, R, U, D) -----------------------------------------------------------------------
// C · AGREGAR
assert.deepEqual(edicionDe("puedes agregar una guirnalda en medio?", actualColumnas), { tipo: "agregar_pieza", pieza: { estructura: "guirnalda", ubicacion: "centro", colores: [] } }, "la frase literal del dueño suma una guirnalda en el centro");
assert.equal((deteccion("puedes agregar una guirnalda en medio?", actualColumnas) as Extract<DeteccionEdicion, { estado: "edicion" }>).herramienta, "agregar_pieza_plan");
assert.deepEqual(edicionDe("agrégale una guirnalda entre las columnas"), { tipo: "agregar_pieza", pieza: { estructura: "guirnalda", ubicacion: "centro", colores: [] } }, "«entre las columnas» es en medio");
assert.deepEqual(edicionDe("súmale una guirnalda dorada de 3 m arriba"), { tipo: "agregar_pieza", pieza: { estructura: "guirnalda", ubicacion: "arriba", medidas: { largo_m: 3 }, colores: ["dorado"] } }, "medida (en largo) y color de la pieza nueva");
assert.deepEqual(edicionDe("pon una guirnalda en dorado"), { tipo: "agregar_pieza", pieza: { estructura: "guirnalda", ubicacion: null, colores: ["dorado"] } });
assert.deepEqual(edicionDe("agrégale otra columna"), { tipo: "agregar_pieza", pieza: { estructura: "columna", ubicacion: null, colores: [] } }, "otra de las que ya tiene: su misma oficial");
assert.deepEqual(edicionDe("ponle un arco"), { tipo: "agregar_pieza", pieza: { estructura: "arco", ubicacion: null, colores: [] } });
assert.deepEqual(edicionDe("agrega una columna de 2,5 m a la derecha"), { tipo: "agregar_pieza", pieza: { estructura: "columna", ubicacion: "derecha", medidas: { alto_m: 2.5 }, colores: [] } }, "una columna se mide en alto");
assert.deepEqual(edicionDe("también quiero un arco orgánico al fondo"), { tipo: "agregar_pieza", pieza: { estructura: "arco", ubicacion: "fondo", colores: [], organica: true } }, "«arco orgánico» = el arco con mezcla de tamaños");
assert.equal(deteccion("agrega dos columnas").estado, "no_cabe", "varias piezas a la vez: se rehace con el plan anterior completo");
assert.equal(deteccion("agrega un bouquet").estado, "no_cabe", "un bouquet se cuenta globo a globo: se rehace");
assert.equal(deteccion("quita la columna derecha y pon una guirnalda").estado, "no_cabe", "quitar y sumar a la vez: se rehace");
assert.deepEqual(edicionDe("agrégale dorado a las columnas"), { tipo: "agregar_color", colores: ["dorado"], piezas: ["Columna izquierda", "Columna derecha"] }, "un color, no una pieza: lo de antes sigue igual");
assert.deepEqual(detectarPiezaNueva("puedes agregar una guirnalda en medio?"), { estructura: "guirnalda", ubicacion: "centro", colores: [] }, "sin plan (lectura de foto pendiente) también se lee");
assert.equal(detectarPiezaNueva("me gusta, ármalo"), null);
assert.equal(detectarPiezaNueva("agrega dos guirnaldas"), null, "varias: no es una pieza nueva");

// R · CONSULTAR
assert.deepEqual(deteccion("¿qué lleva mi plan?"), { estado: "consulta", consulta: { tipo: "resumen", piezas: [] }, motivo: "pregunta por su plan: se responde con sus datos, sin cambiarlo" });
assert.deepEqual(detectarConsultaPlan("¿cuántos globos tiene la columna izquierda?", actual), { tipo: "globos", piezas: ["Columna izquierda"] });
assert.deepEqual(detectarConsultaPlan("¿de qué color es el semiarco?", actual), { tipo: "colores", piezas: ["Semiarco orgánico"] });
assert.deepEqual(detectarConsultaPlan("cuánto mide la columna derecha", actual), { tipo: "medidas", piezas: ["Columna derecha"] });
assert.equal(detectarConsultaPlan("¿cuánto cuesta?", actual), null, "el precio lo abre «costear», no es una consulta del plan");
assert.equal(detectarConsultaPlan("¿puedes agregar una guirnalda?", actual), null, "una pregunta que pide un cambio no es una consulta");
assert.equal(detectarConsultaPlan("¿cuántos globos más necesito para hacerla más grande?", actual), null);
assert.equal(detectarConsultaPlan("¿qué colores me recomiendas para la guirnalda?", actual), null, "pedir consejo no es preguntar por el plan");

// U · ACTUALIZAR
assert.deepEqual(edicionDe("cambia el semiarco a dorado"), { tipo: "colores_pieza", colores: ["dorado"], piezas: ["Semiarco orgánico"] }, "una pieza nombrada en un color");
assert.deepEqual(edicionDe("pon las columnas en blanco y rosado"), { tipo: "colores_pieza", colores: ["blanco", "rosado"], piezas: ["Columna izquierda", "Columna derecha"] });
assert.deepEqual(edicionDe("pon la columna izquierda al centro"), { tipo: "mover_pieza", pieza: "Columna izquierda", ubicacion: "centro" });
assert.deepEqual(edicionDe("renombra el semiarco como Cascada"), { tipo: "renombrar_pieza", pieza: "Semiarco orgánico", nombre: "Cascada" });
assert.deepEqual(edicionDe("cámbiale el nombre a la columna izquierda por Torre rosa"), { tipo: "renombrar_pieza", pieza: "Columna izquierda", nombre: "Torre rosa" }, "manda el último conector");
assert.equal(deteccion("cambia el azul").estado, "incompleta", "un color del plan sin decir por cuál: sigue preguntando (no se pinta nada)");
assert.equal(deteccion("cambiemos a verde y dorado").estado, "no_cabe", "otra paleta sin piezas nombradas: se rehace");

// D · QUITAR
assert.deepEqual(edicionDe("quita la columna derecha"), { tipo: "quitar_pieza", piezas: ["Columna derecha"] });

// --- 2. C · Sumar la pieza al plan conservando EXACTAMENTE las demás (lo que hace el servidor antes de Python) --------
const conGuirnalda = planConPiezaNueva(soloColumnas.plan, { estructura: "guirnalda", ubicacion: "centro" });
assert.ok(conGuirnalda.ok, JSON.stringify(conGuirnalda));
assert.deepEqual(conGuirnalda.plan.estructuras.slice(0, 2), soloColumnas.plan.estructuras, "las dos columnas quedan idénticas (medidas, armado, materiales, nombres)");
assert.equal(conGuirnalda.plan.estructuras.length, 3, "2 columnas + 1 guirnalda");
const guirnalda = conGuirnalda.plan.estructuras[2]!;
assert.equal(guirnalda.estructura_oficial, "guirnalda");
assert.equal(guirnalda.ubicacion, "arco_central", "«en medio» = arco_central, entre las dos columnas");
assert.deepEqual(guirnalda.medidas, { largo_m: 2.4 }, "la medida estándar de la biblioteca");
assert.equal(guirnalda.nombre, "Guirnalda");
assert.deepEqual(guirnalda.materiales.map((material) => [material.product_id, material.color]), soloColumnas.plan.estructuras[0]!.materiales.map((material) => [material.product_id, material.color]), "los colores y productos del plan (el mismo globo que ya se compra)");
assert.equal(guirnalda.materiales.reduce((suma, material) => suma + material.participacion, 0).toFixed(3), "1.000");
assert.equal(guirnalda.armado_columna, undefined, "sin armado: Python la cuenta por su geometría");
// Lo que verifica el servidor tras resolver (agregarPiezaPlan): las piezas de antes compran lo mismo.
const resueltoDoble = { estructuras: [...soloColumnas.estructuras.map((estructura) => ({ estructura_id: estructura.estructura_id, lineas: estructura.lineas })), { estructura_id: conGuirnalda.nueva, lineas: [{ variant_id: "v-nueva", unidades: 30 }] }] };
assert.ok(piezasIntactas(soloColumnas, resueltoDoble), "con las columnas iguales, piezasIntactas aprueba");
const columnaCambiada = { estructuras: resueltoDoble.estructuras.map((estructura, indice) => (indice === 0 ? { ...estructura, lineas: estructura.lineas.map((linea, posicion) => (posicion === 0 ? { ...linea, unidades: 999 } : linea)) } : estructura)) };
assert.ok(!piezasIntactas(soloColumnas, columnaCambiada), "si Python cambiara una columna, no se acepta el plan");
// Con la pieza nueva cambia el reparto entre paquetes (azul R-12: 32 en un x50 → 12 en el x12 y 20 en el x20), no los globos.
const antesPaquetes = { estructuras: [{ estructura_id: "EST_01_COLUMNA", lineas: [{ product_id: "P", variant_id: "x50", tamano_codigo: "R-12", color: "azul", unidades: 32 }] }] };
const despuesPaquetes = { estructuras: [{ estructura_id: "EST_01_COLUMNA", lineas: [{ product_id: "P", variant_id: "x12", tamano_codigo: "R-12", color: "azul", unidades: 12 }, { product_id: "P", variant_id: "x20", tamano_codigo: "R-12", color: "azul", unidades: 20 }] }] };
assert.ok(piezasIntactas(antesPaquetes, despuesPaquetes), "los mismos globos en otros paquetes siguen siendo la misma pieza");
assert.ok(!piezasIntactas(antesPaquetes, { estructuras: [{ estructura_id: "EST_01_COLUMNA", lineas: [{ product_id: "P", variant_id: "x12", tamano_codigo: "R-12", color: "azul", unidades: 31 }] }] }), "un globo de menos sí es otra pieza");

// La pieza en un color pedido que el plan no lleva (el globo que eligió la vista, ya admitido).
const dorada = planConPiezaNueva(soloColumnas.plan, { estructura: "guirnalda", ubicacion: "arriba", medidas: { largo_m: 3 }, materialesNuevos: [{ product_id: "8634000000200", color: "dorado" }] });
assert.ok(dorada.ok);
assert.deepEqual(dorada.plan.estructuras.at(-1)!.materiales.map((material) => [material.product_id, material.color, material.participacion]), [["8634000000200", "dorado", 1]], "solo el color pedido");
assert.deepEqual(dorada.medidas, { largo_m: 3 });
assert.equal(dorada.ubicacion, "fondo_pared", "«arriba» de una guirnalda: sobre el fondo (libre)");

// «Agrégale otra columna» a un plan con una sola columna: copia exacta en espejo, al otro lado.
const unaColumna = { ...soloColumnas.plan, estructuras: [{ ...soloColumnas.plan.estructuras[0]!, nombre: "Columna" }] };
const otra = planConPiezaNueva(unaColumna, { estructura: "columna", ubicacion: null });
assert.ok(otra.ok);
assert.equal(otra.plantilla, "copia");
assert.equal(otra.ubicacion, "lateral_derecho");
assert.deepEqual(otra.plan.estructuras.map((estructura) => estructura.nombre), ["Columna izquierda", "Columna derecha"], "la de antes pasa a «Columna izquierda» y la nueva es la derecha");
assert.deepEqual(otra.plan.estructuras[1]!.armado_columna, unaColumna.estructuras[0]!.armado_columna, "con su mismo armado");
assert.deepEqual(otra.plan.estructuras[1]!.materiales, unaColumna.estructuras[0]!.materiales);
// Topes y lugares únicos.
assert.equal(ubicacionDePieza("fondo", "pared_densa", ["fondo_pared"]), null, "el fondo ya ocupado no admite otra pared");
const lleno = { ...plan.plan, estructuras: Array.from({ length: 8 }, (_, indice) => ({ ...plan.plan.estructuras[1]!, estructura_id: `EST_0${indice + 1}_COLUMNA`, nombre: `Columna ${indice + 1}`, rol_escena: indice === 0 ? "focal" as const : "soporte" as const })) };
const sinSitio = planConPiezaNueva(lleno, { estructura: "guirnalda", ubicacion: null });
assert.ok(!sinSitio.ok && sinSitio.motivo === "tope_piezas");

// U · Mover y renombrar (lo que hace el servidor en editar_pieza): solo cambian el lugar o el nombre.
const movida = planConPiezaEditada(conGuirnalda.plan, conGuirnalda.nueva, { ubicacion: "izquierda" });
assert.ok(movida.ok);
assert.equal(movida.plan.estructuras[2]!.ubicacion, "lateral_izquierdo");
assert.deepEqual({ ...movida.plan.estructuras[2]!, ubicacion: "arco_central" }, guirnalda, "medidas, materiales y nombre iguales");
const derechaAlCentro = planConPiezaEditada(soloColumnas.plan, DERECHA, { ubicacion: "centro" });
assert.ok(derechaAlCentro.ok && derechaAlCentro.despues.nombre === "Columna", `al centro la columna pierde su lado: ${JSON.stringify(derechaAlCentro.ok && derechaAlCentro.despues)}`);
const renombrada = planConPiezaEditada(conGuirnalda.plan, conGuirnalda.nueva, { nombre: "Cascada" });
assert.ok(renombrada.ok && renombrada.plan.estructuras[2]!.nombre === "Cascada");
const repetido = planConPiezaEditada(conGuirnalda.plan, conGuirnalda.nueva, { nombre: "columna izquierda" });
assert.ok(!repetido.ok && repetido.motivo === "nombre_repetido");

// --- 3. C con la lectura de una foto pendiente: ejemplo-01 (dos columnas) + «agrega una guirnalda en medio» ----------
type Ejemplo = { id: string; analisis: { blueprint: unknown } };
const lecturas = JSON.parse(readFileSync("src/lib/ia/amaterasu/lecturas-ejemplos.json", "utf8")) as { ejemplos: Ejemplo[] };
const ejemplo = lecturas.ejemplos.find((item) => item.id === "ejemplo-01");
assert.ok(ejemplo, "la lectura determinista de ejemplo-01");
const referencia = adaptarAnalisisReferencia(ejemplo.analisis);
assert.ok(referencia, "la vista adapta la lectura (la tarjeta «Sí, arma mi plan con estas 2 piezas»)");
assert.equal(referencia.piezas.length, 2, "dos piezas de globos: las dos columnas");
const blueprint: ReferenceBlueprintV2 = ReferenceBlueprintV2Schema.parse(referencia.blueprint);
const piezaPedida = detectarPiezaNueva("agrega una guirnalda en medio");
assert.deepEqual(piezaPedida, { estructura: "guirnalda", ubicacion: "centro", colores: [] });
const conPieza = lecturaConPiezaNueva(blueprint, piezaPedida!);
assert.ok(conPieza, "la lectura con la guirnalda cumple el contrato");
const globosAprobados = conPieza.blueprint.elements.filter((elemento) => elemento.approved && elemento.category === "balloon_structure");
assert.deepEqual(globosAprobados.map((elemento) => elemento.visual_semantics?.structure_type), ["columna", "columna", "guirnalda"], "el pedido del plan lleva 2 columnas + 1 guirnalda");
const elementoGuirnalda = globosAprobados[2]!;
assert.equal(elementoGuirnalda.visual_semantics?.placement, "arco_central", "en el centro");
const [colIzq, colDer] = globosAprobados as [typeof elementoGuirnalda, typeof elementoGuirnalda];
const centro = (elemento: typeof elementoGuirnalda) => elemento.reference_bbox.x + elemento.reference_bbox.width / 2;
assert.ok(elementoGuirnalda.reference_bbox.x >= centro(colIzq) - 0.001 && elementoGuirnalda.reference_bbox.x + elementoGuirnalda.reference_bbox.width <= centro(colDer) + 0.001, `la caja de la guirnalda va entre las dos columnas: ${JSON.stringify(elementoGuirnalda.reference_bbox)}`);
assert.ok(elementoGuirnalda.detection_confidence < 0.5, "no es una detección: Python no mide nada con su caja");
assert.deepEqual(elementoGuirnalda.appearance.observed_colors, ["matte pastel pink", "matte white", "chrome silver", "clear"], "en los colores de las columnas de la foto");
assert.deepEqual(conPieza.blueprint.elements.slice(0, blueprint.elements.length), blueprint.elements, "los elementos leídos de la foto no cambian");
const cuerpo = cuerpoPlanFoto({ reintento: false, blueprint, colores: referencia.colores.map((color) => color.nombre), cliente: { solicitud: "agrega una guirnalda en medio" }, imagen: null, piezaNueva: { pieza: piezaPedida!, lectura: conPieza } });
assert.equal(cuerpo.referenceBlueprint, conPieza.blueprint, "/api/chat recibe la lectura con la guirnalda");
assert.equal(cuerpo.piezasIndividuales, true);
const texto = cuerpo.messages[0]!.content;
assert.match(texto, /^Adjunto imágenes de referencia del estilo que busco\.\nConfirma el plan con confirmar_plan_decoracion/, "el mismo texto que la clásica con una foto sola");
assert.match(texto, new RegExp(`sumar una guirnalda en el centro: es el elemento ${conPieza.elemento}`));
assert.match(texto, /estructura_oficial: guirnalda; referencia_element_id: REF_01_E\d+; ubicacion: arco_central; repeticiones: 1; medidas: largo_m 2\.4/);
const restricciones = extraerRestriccionesUsuario(texto);
assert.deepEqual(restricciones.estructuras.map((item) => [item.tipo, item.repeticiones, item.polaridad]), [["guirnalda", 1, "obligatorio"]], "la guirnalda es obligatoria y no se le pide a /api/chat ningún número de columnas");
const sinPieza = cuerpoPlanFoto({ reintento: false, blueprint, colores: [], cliente: {}, imagen: null });
assert.equal(sinPieza.referenceBlueprint, blueprint, "«Sí, armémoslo» sin pieza pedida: la lectura de siempre");
assert.equal(sinPieza.messages[0]!.content, "Adjunto imágenes de referencia del estilo que busco.\nConfirma el plan con confirmar_plan_decoracion en este mismo turno, sin preguntarme nada.");
// Si el plan que vuelve de /api/chat no trae la guirnalda, la vista la suma con el editor (agregar_pieza).
const columnasDelPlan = [{ tipo: "columna", referencia_element_id: colIzq.element_id }, { tipo: "columna", referencia_element_id: colDer.element_id }];
assert.equal(planLlevaPiezaPedida({ plan: { estructuras: columnasDelPlan } }, conPieza, piezaPedida!), false, "solo las columnas: falta la guirnalda");
assert.equal(planLlevaPiezaPedida({ plan: { estructuras: [...columnasDelPlan, { tipo: "guirnalda", referencia_element_id: conPieza.elemento }] } }, conPieza, piezaPedida!), true);
assert.equal(planLlevaPiezaPedida({ plan: { estructuras: [...columnasDelPlan, { tipo: "guirnalda" }] } }, conPieza, piezaPedida!), true, "una guirnalda sin su elemento también cuenta");
const reintento = cuerpoPlanFoto({ reintento: true, blueprint, colores: ["Rosa"], cliente: {}, imagen: null, piezaNueva: { pieza: piezaPedida!, lectura: conPieza } });
assert.match(reintento.messages[0]!.content, /Sí, armémoslo\.[\s\S]*sumar una guirnalda en el centro/, "el reintento también lleva la guirnalda");

// --- 4. R · Consultas respondidas con el plan (las cifras que contó Python), sin cambiarlo --------------------------
const resumen = responderConsultaPlan("¿qué lleva mi plan?", plan);
assert.ok(resumen);
assert.match(resumen.texto, /^Tu plan lleva 3 piezas: el semiarco orgánico \(.*\), la columna izquierda \(2 m de alto, \d+ globos\) y la columna derecha \(2 m de alto, \d+ globos\)\. En total son \d+ globos, en /);
const globosIzq = plan.estructuras.find((estructura) => estructura.estructura_id === IZQUIERDA)!.lineas.reduce((suma, linea) => suma + (typeof linea.unidades === "number" ? linea.unidades : 0), 0);
assert.equal(responderConsultaPlan("¿cuántos globos tiene la columna izquierda?", plan)?.texto, `La columna izquierda lleva ${globosIzq} globos.`);
assert.match(responderConsultaPlan("¿de qué color es el semiarco?", plan)?.texto ?? "", /^El semiarco orgánico va en \w+ \(\d+ globos\), /);
assert.equal(responderConsultaPlan("¿cuánto mide la columna derecha?", plan)?.texto, "La columna derecha mide 2 m de alto.");
assert.equal(responderConsultaPlan("agrégale una guirnalda", plan), null, "un cambio no es una consulta");
assert.equal(responderConsultaPlan("¿cuánto me sale?", plan), null, "el precio va por «costear»");

// --- 5. Lo que manda el modelo con las herramientas nuevas se valida contra el plan --------------------------------
const ninguna: DeteccionEdicion = { estado: "ninguna" };
const delModelo = pedidoDesdeHerramienta("agregar_pieza_plan", { estructura: "guirnalda", ubicacion: "centro", medida_m: 3.2 }, { plan: actual, ultimoUsuario: "ponle algo en medio", deteccion: ninguna });
assert.ok(delModelo.ok);
assert.deepEqual(delModelo.pedido, { tipo: "agregar_pieza", pieza: { estructura: "guirnalda", ubicacion: "centro", medidas: { largo_m: 3.2 }, colores: [] } });
const bouquet = pedidoDesdeHerramienta("agregar_pieza_plan", { estructura: "bouquet" }, { plan: actual, ultimoUsuario: "", deteccion: ninguna });
assert.ok(!bouquet.ok && bouquet.motivo === "pieza_no_agregable");
const mover = pedidoDesdeHerramienta("editar_pieza_plan", { pieza: "columna derecha", ubicacion: "centro" }, { plan: actual, ultimoUsuario: "", deteccion: ninguna });
assert.ok(mover.ok && mover.pedido.tipo === "mover_pieza" && mover.pedido.pieza === "Columna derecha");
const pintar = pedidoDesdeHerramienta("colores_pieza_plan", { piezas: ["Semiarco orgánico"], colores: ["Dorado"] }, { plan: actual, ultimoUsuario: "", deteccion: ninguna });
assert.ok(pintar.ok && pintar.pedido.tipo === "colores_pieza" && pintar.pedido.colores[0] === "dorado");
// Las herramientas del turno: con una pieza que sumar, SOLO agregar_pieza_plan (sin proponer_composicion no puede rehacer el plan).
const BASE = [{ nombre: "proponer_composicion", descripcion: "", esquema: {} }];
const turno = (leida: DeteccionEdicion) => herramientasConEdicion({ base: BASE, plan: actualColumnas, ideas: [], deteccion: leida, eleccion: null }).herramientas.map((herramienta) => herramienta.nombre);
assert.deepEqual(turno(deteccion("puedes agregar una guirnalda en medio?", actualColumnas)), ["agregar_pieza_plan"], "el turno del dueño ya no puede armar un plan nuevo");
assert.deepEqual(turno(deteccion("¿qué lleva mi plan?", actualColumnas)), [], "una consulta no tiene herramientas: no cambia nada");
assert.equal(fraseDelPedido(edicionDe("puedes agregar una guirnalda en medio?", actualColumnas)), "Sumo una guirnalda en el centro a tu plan; lo demás queda igual.");

// --- 6. Los cambios de pieza con dobles de /api/plan-editar: el resto del plan queda igual -------------------------
type Llamada = { tipo: string; detalle: unknown };
function variante(id: string, diam: number, color: string) {
  return { variantId: id, titulo: `R-${diam}`, disponible: true, codigoTamano: `R-${diam}`, diamPulg: diam, forma: "redondo", colores: [color] };
}
const DORADO = "8634000000200";
const candidatosDorados: CandidatoDelServidor[] = [{ productId: DORADO, titulo: "B2b Globo Latex Redondo Reflex Dorado", imagen: null, variantes: [variante("rd12", 12, "dorado"), variante("rd5", 5, "dorado")] }];

function dobles(llamadas: Llamada[]): DependenciasEdicionChat {
  let version = 0;
  const firmado = (base: PlanGuiado, planNuevo: PlanGuiado["plan"]): PlanGuiado => PlanGuiadoSchema.parse({ ...base, plan: planNuevo, plan_hash: `${(version += 1)}`.padStart(64, "c") });
  return {
    buscarGlobos: async (familia, token, palabra) => { llamadas.push({ tipo: "buscar", detalle: { familia, palabra } }); return candidatosDorados; },
    agregarPieza: async (base, pieza: PiezaParaServidor) => {
      llamadas.push({ tipo: "agregar-pieza", detalle: pieza });
      // Lo mismo que hace el servidor (agregarPiezaPlan) antes de que Python cuente.
      const armada = planConPiezaNueva(base.plan, { estructura: pieza.estructura, ubicacion: pieza.ubicacion, ...(pieza.medidas ? { medidas: pieza.medidas } : {}), ...(pieza.colores.length ? { colores: pieza.colores } : {}), ...(pieza.globos.length ? { materialesNuevos: pieza.globos.map((globo) => ({ product_id: globo.productId, color: globo.color })) } : {}) });
      assert.ok(armada.ok, JSON.stringify(armada));
      const nuevo = firmado(base, armada.plan);
      // Las líneas de la pieza nueva: las de una columna del plan (mismos productos), como si Python las hubiera contado.
      return { plan: { ...nuevo, estructuras: [...base.estructuras, { estructura_id: armada.nueva, lineas: base.estructuras.at(-1)!.lineas }] }, cotizacion: null, nuevas: [armada.nueva] };
    },
    editarPieza: async (base, cambio) => {
      llamadas.push({ tipo: "editar-pieza", detalle: cambio });
      const editada = planConPiezaEditada(base.plan, cambio.estructuraId, { ...(cambio.ubicacion ? { ubicacion: cambio.ubicacion } : {}), ...(cambio.nombre ? { nombre: cambio.nombre } : {}) });
      assert.ok(editada.ok);
      return { plan: firmado(base, editada.plan), cotizacion: null };
    },
    reemplazarColor: async (base, cambio) => { llamadas.push({ tipo: "reemplazar", detalle: { color: cambio.color, estructuraIds: cambio.estructuraIds ?? null } }); return { plan: firmado(base, base.plan), cotizacion: null }; },
    agregarColor: async (base, globo, estructuraIds) => { llamadas.push({ tipo: "agregar-color", detalle: { productId: globo.productId, estructuraIds: estructuraIds ?? null } }); return { plan: firmado(base, base.plan), cotizacion: null }; },
    quitarPieza: async (base, estructuraId) => { llamadas.push({ tipo: "quitar-pieza", detalle: estructuraId }); return { plan: firmado(base, { ...base.plan, estructuras: base.plan.estructuras.filter((estructura) => estructura.estructura_id !== estructuraId) }), cotizacion: null }; },
    aplicar: async (base, edicion) => { llamadas.push({ tipo: "aplicar", detalle: edicion.accion }); return { plan: firmado(base, base.plan), cotizacion: null }; },
  };
}

async function probarEjecucion(): Promise<void> {
  // C · «puedes agregar una guirnalda en medio?» sobre el plan de las dos columnas.
  const llamadas: Llamada[] = [];
  const pedido = edicionDe("puedes agregar una guirnalda en medio?", actualColumnas);
  assert.equal(avisoEdicionChat(pedido), "Sumo una guirnalda en el centro a tu plan; lo demás queda igual…");
  const hecha = await ejecutarEdicionChat(soloColumnas, pedido, dobles(llamadas));
  assert.deepEqual(llamadas.map((llamada) => llamada.tipo), ["agregar-pieza"], "UNA petición a /api/plan-editar (agregar_pieza); ninguna a /api/chat ni al modelo");
  assert.deepEqual(llamadas[0]!.detalle, { estructura: "guirnalda", ubicacion: "centro", colores: [], globos: [] }, "en los colores del plan");
  assert.deepEqual(hecha.plan.plan.estructuras.slice(0, 2), soloColumnas.plan.estructuras, "las dos columnas, idénticas");
  assert.equal(hecha.plan.plan.estructuras.length, 3);
  assert.equal(hecha.nueva, "EST_03_GUIRNALDA");
  assert.equal(hecha.descripcion, "añadí una guirnalda de 2,4 m en el centro", "«Último ajuste: añadí una guirnalda de 2,4 m en el centro»");
  assert.equal(hecha.confirmacion, "Listo: añadí una guirnalda de 2,4 m en el centro; lo demás quedó igual.", "el chat lo confirma en una frase");

  // C · En un color que el plan no lleva: el globo liso del catálogo, admitido por el servidor.
  const doradas: Llamada[] = [];
  const conDorado = await ejecutarEdicionChat(soloColumnas, edicionDe("súmale una guirnalda dorada de 3 m arriba", actualColumnas), dobles(doradas));
  assert.deepEqual(doradas.map((llamada) => llamada.tipo), ["buscar", "agregar-pieza"]);
  assert.deepEqual((doradas[1]!.detalle as PiezaParaServidor).globos.map((globo) => [globo.productId, globo.color, globo.variantIds]), [[DORADO, "dorado", ["rd12", "rd5"]]]);
  assert.equal(conDorado.descripcion, "añadí una guirnalda de 3 m arriba en dorado");

  // U · «hazla de 4 m» tras «Listo: añadí una guirnalda…»: la medida es de la guirnalda.
  const actualConGuirnalda = planActualDesdePlan(hecha.plan)!;
  const hazla = edicionDe("hazla de 4 m", actualConGuirnalda, hecha.confirmacion);
  assert.deepEqual(hazla, { tipo: "medidas", medidas: { largo_m: 4 }, piezas: ["Guirnalda"] }, "la pieza de la que se habla, medida en largo");
  assert.equal(deteccion("hazla de 4 m", actualConGuirnalda).estado, "incompleta", "sin el mensaje anterior no se adivina la pieza");
  assert.deepEqual(edicionDe("cambia la guirnalda a dorado", actualConGuirnalda), { tipo: "colores_pieza", colores: ["dorado"], piezas: ["Guirnalda"] });
  assert.deepEqual(edicionDe("cámbiala a dorado", actualConGuirnalda, hecha.confirmacion), { tipo: "colores_pieza", colores: ["dorado"], piezas: ["Guirnalda"] }, "«cámbiala» es la guirnalda que se acaba de sumar");
  assert.deepEqual(edicionDe("pon la guirnalda arriba", actualConGuirnalda), { tipo: "mover_pieza", pieza: "Guirnalda", ubicacion: "arriba" });
  // D · «quita la guirnalda que agregué».
  assert.deepEqual(edicionDe("quita la guirnalda que agregué", actualConGuirnalda), { tipo: "quitar_pieza", piezas: ["Guirnalda"] });
  assert.deepEqual(edicionDe("quítala", actualConGuirnalda, hecha.confirmacion), { tipo: "quitar_pieza", piezas: ["Guirnalda"] });

  // U · Colores de una pieza: cada color pedido entra en lugar de uno que sobra; los demás se quitan. Solo en esa pieza.
  const pintadas: Llamada[] = [];
  const pintada = await ejecutarEdicionChat(hecha.plan, { tipo: "colores_pieza", colores: ["dorado"], piezas: ["Guirnalda"] }, dobles(pintadas));
  assert.deepEqual(pintadas.map((llamada) => llamada.tipo), ["buscar", "reemplazar", "aplicar", "aplicar", "aplicar"], "el azul de la guirnalda pasa a dorado y el plateado, el blanco y el rosado se quitan, uno a uno");
  assert.deepEqual(pintadas.slice(2).map((llamada) => llamada.detalle), ["quitar", "quitar", "quitar"], "con la edición «quitar» de siempre");
  assert.deepEqual(pintadas[1]!.detalle, { color: "azul", estructuraIds: ["EST_03_GUIRNALDA"] }, "solo en la guirnalda");
  assert.equal(pintada.confirmacion, "Listo: la guirnalda quedó en dorado; lo demás quedó igual.");

  // U · Mover y renombrar.
  const movidas: Llamada[] = [];
  const movidaChat = await ejecutarEdicionChat(hecha.plan, { tipo: "mover_pieza", pieza: "Guirnalda", ubicacion: "arriba" }, dobles(movidas));
  assert.deepEqual(movidas, [{ tipo: "editar-pieza", detalle: { estructuraId: "EST_03_GUIRNALDA", ubicacion: "arriba" } }]);
  assert.equal(movidaChat.plan.plan.estructuras[2]!.ubicacion, "fondo_pared");
  assert.deepEqual(movidaChat.plan.plan.estructuras.slice(0, 2), soloColumnas.plan.estructuras);
  assert.equal(movidaChat.descripcion, "moví la guirnalda arriba");
  const renombradaChat = await ejecutarEdicionChat(hecha.plan, { tipo: "renombrar_pieza", pieza: "Guirnalda", nombre: "Cascada" }, dobles([]));
  assert.equal(renombradaChat.plan.plan.estructuras[2]!.nombre, "Cascada");
  assert.equal(renombradaChat.confirmacion, "Listo: la guirnalda ahora se llama «Cascada».");

  // La tarjeta «Tu plan» se actualiza en su sitio con el último ajuste.
  const html = renderToStaticMarkup(createElement(TarjetaPlan, {
    plan: hecha.plan, imagen: null, estadoImagen: "nada" as const, usoCosteo: null, compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {},
    onAccion: () => undefined, onCosteo: () => undefined, onProveedores: () => undefined, onDistribuidor: () => undefined, onPlanAjustado: () => undefined,
    ajustes: [hecha.descripcion],
  })).replace(/<!-- -->/g, "");
  assert.match(html, /Último ajuste: añadí una guirnalda de 2,4 m en el centro/);
}

probarEjecucion()
  .then(() => console.log("crud-plan-chat-guiada: OK"))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
