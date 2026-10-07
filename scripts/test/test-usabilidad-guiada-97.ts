/**
 * Arreglos de usabilidad de la vista guiada (informes usabilidad-97 y comparador-100). Sin red, sin modelo, sin coste.
 * Run: npx tsx scripts/test/test-usabilidad-guiada-97.ts
 *
 * A. El uso no se pregunta dos veces (idea, «soy decorador», «para mi casa»): ni «Cuánto cuesta» ni el modelo.
 * B. La cabecera dice el rango de edad que eligió («4 a 6 años», no «5 años»). (El saneo de la pregunta de la edad está
 *    en test-respuesta-guiada-sin-fracaso.ts.)
 * C. «Soy decorador… arco orgánico de unos 3 metros… boda… cotizarle» → brief con evento, uso, medida y pieza; la
 *    propuesta lleva `arco` (completo) de 3 m.
 * D. La instrucción del plan lleva las palabras del cliente que importan, sin volver la ocasión un filtro del catálogo.
 * F. «Ajustes que hice» en «Tu plan»: lo que Python sustituyó o supuso, en palabras de cliente.
 * (E, la imagen con el brief completo y las palabras del cliente, está en test-cuerpo-generacion.ts.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { briefConHechos, estructuraDeTexto, etiquetaEdadCliente, hechosDelCliente, medidaDeTexto, medidasParaPieza, propuestaConLoPedido, textoHechosCliente, usoDeTexto } from "../../src/lib/ia/guiado/hechos-cliente";
import { contextoClienteGuiado, lineaPalabrasCliente, solicitudDelCliente } from "../../src/lib/ia/guiado/contexto-cliente";
import { cuerpoPlanGuiado, instruccionPlanGuiado } from "../../src/lib/ia/guiado/instruccion-plan";
import { normalizarPropuestaComposicion } from "../../src/lib/ia/guiado/propuesta-composicion";
import { ajustesDePython } from "../../src/lib/ia/guiado/ajustes-python";
import { AsistenteGuiadoRequestSchema, BriefGuiadoSchema, RespuestaGuiadaSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { ChatRequestV1Schema } from "../../src/lib/ia/contracts/chat-v1";
import { filtrosDurosDeBusqueda } from "../../src/lib/rag/chat/filtros-turno";
import { extraerRestriccionesConversacion } from "../../src/lib/plan/restricciones-conversacion";
import { numerosPedidos } from "../../src/lib/plan/numeros-pedidos";
import { parseEventSearchIntent } from "../../src/lib/rag/query-parser/event-search";
import { parseEventIntent } from "../../src/lib/rag/query-parser/parse-event";
import { SelectorUsoCosteo } from "../../src/components/guiado/SelectorUsoCosteo";
import { AjustesPropuesta } from "../../src/components/plan/AjustesPropuesta";
import { TarjetaPlan } from "../../src/components/guiado/TarjetaPlan";

let fallos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
const leer = (ruta: string) => readFileSync(path.join(process.cwd(), ruta), "utf8");
const DECORADOR = "Soy decorador. Un cliente me pide un arco orgánico de unos 3 metros en blanco y dorado para una boda y necesito cotizarle";

// ── A. El uso ────────────────────────────────────────────────────────────────────────────────────────────────────
caso("A: el uso se lee de lo que dijo el cliente (sin modelo)", () => {
  assert.equal(usoDeTexto(DECORADOR), "negocio");
  for (const texto of ["Es para mi negocio.", "Tengo un emprendimiento de decoración", "Una clienta me pidió columnas", "Negocio de eventos"]) assert.equal(usoDeTexto(texto), "negocio", texto);
  for (const texto of ["Es para uso personal.", "Es para mi casa", "No soy decoradora, es para mi familia", "no es para mi negocio"]) assert.equal(usoDeTexto(texto), "personal", texto);
  // Pedir un decorador o buscar uno no dice nada del uso del cliente.
  for (const texto of ["Quiero contratar un decorador", "Busca decoradores en Bogotá para mi plan.", "Cumpleaños", "Quiero saber cuánto cuestan los materiales."]) assert.equal(usoDeTexto(texto), null, texto);
  // Lo más reciente manda: «Para uso personal» elegido después de «soy decorador».
  assert.equal(hechosDelCliente([DECORADOR, "Es para uso personal."]).uso, "personal");
});

caso("A: «Cuánto cuesta» con el uso ya dicho no vuelve a preguntar y deja cambiarlo con un enlace", () => {
  const conocido = renderToStaticMarkup(createElement(SelectorUsoCosteo, { uso: "personal", ocupado: false, onElegir: () => undefined }));
  assert.ok(!conocido.includes("¿Para qué es la decoración?"), conocido);
  assert.ok(conocido.includes("Precio para uso personal") && conocido.includes("¿Es para tu negocio?"), conocido);
  const negocio = renderToStaticMarkup(createElement(SelectorUsoCosteo, { uso: "negocio", ocupado: false, onElegir: () => undefined }));
  assert.ok(negocio.includes("Precio para tu negocio") && negocio.includes("¿Es para uso personal?"), negocio);
  // Sin uso todavía: la pregunta de siempre.
  const sinUso = renderToStaticMarkup(createElement(SelectorUsoCosteo, { uso: null, ocupado: false, onElegir: () => undefined }));
  assert.ok(sinUso.includes("¿Para qué es la decoración?") && sinUso.includes("Uso personal") && sinUso.includes("Para mi negocio"), sinUso);
});

caso("A: la tarjeta abre el costeo con el uso conocido y la vista ya no lo borra al elegir idea o plan", () => {
  const tarjeta = leer("src/components/guiado/TarjetaPlan.tsx");
  assert.match(tarjeta, /const usoMostrado = usoCosteo \?\? usoConocido \?\? null;/);
  assert.match(tarjeta, /if \(abrir && usoCosteo === null && usoConocido\) onCosteo\(usoConocido, "conocido"\);/);
  assert.match(tarjeta, /<SelectorUsoCosteo uso=\{usoMostrado\}/);
  const vista = leer("src/components/guiado/VistaGuiada.tsx");
  assert.match(vista, /usoConocido=\{uso\}/);
  assert.ok(!/setUso\(null\)/.test(vista.replace(/setMensajes\(\[\]\); setBrief\(\{\}\); setSeleccionada\(null\); setUso\(null\);/, "")), "solo «Empezar de nuevo» borra el uso");
  assert.match(vista, /const usoDicho = datos\.uso \?\? datos\.brief\?\.uso;/);
});

caso("A: el servidor no deja al modelo volver a preguntar el uso", () => {
  const ruta = leer("src/app/api/asistente-guiado/route.ts");
  assert.match(ruta, /const usoConfirmado = usoDelTurno \?\? estado\?\.uso \?\? hechos\.uso;/);
  assert.match(ruta, /!\(usoConfirmado && herramienta\.nombre === "preguntar_uso"\)/, "sin preguntar_uso en el turno");
  assert.match(ruta, /motivo: "uso_ya_elegido"/, "y si aun así la llama, no pregunta");
  assert.match(ruta, /decidir\("regla:uso_del_cliente"/);
});

// ── B. La edad en la cabecera ────────────────────────────────────────────────────────────────────────────────────
caso("B: la cabecera dice el rango que eligió el cliente", () => {
  assert.equal(etiquetaEdadCliente(5, ["Cumpleaños", "4 a 6 años", "Rosa y lila"]), "4 a 6 años");
  assert.equal(etiquetaEdadCliente(9, ["Cumpleaños", "7 a 12 años."]), "7 a 12 años");
  assert.equal(etiquetaEdadCliente(30, ["Cumpleaños", "Adulto"]), "Adulto");
  assert.equal(etiquetaEdadCliente(15, ["Adolescente"]), "Adolescente");
  assert.equal(etiquetaEdadCliente(9, ["Cumple 9 años"]), "9 años");
  // Un rango que no cuadra con la edad guardada no se inventa.
  assert.equal(etiquetaEdadCliente(5, ["7 a 12 años"]), undefined);
  const brief = briefConHechos({ evento: "Cumpleaños", edad: 5, tematica: "Rosa y lila" }, hechosDelCliente(["Cumpleaños", "4 a 6 años", "Rosa y lila"]), { edadTexto: "4 a 6 años" });
  assert.equal(brief.edadTexto, "4 a 6 años");
  assert.match(leer("src/components/guiado/VistaGuiada.tsx"), /brief\.edadTexto \?\? \(brief\.edad \? `\$\{brief\.edad\} años` : null\)/);
});

// ── C. Los datos del decorador ───────────────────────────────────────────────────────────────────────────────────
caso("C: del mensaje del decorador se guardan evento, uso, medida y pieza (sin modelo)", () => {
  const hechos = hechosDelCliente([DECORADOR]);
  assert.equal(hechos.evento, "boda");
  assert.equal(hechos.uso, "negocio");
  assert.deepEqual(hechos.medida, { texto: "unos 3 metros", metros: 3 });
  assert.deepEqual(hechos.estructura, { id: "arco", texto: "arco orgánico", organica: true });
  const brief = briefConHechos({}, hechos, { uso: "negocio" });
  assert.ok(BriefGuiadoSchema.safeParse(brief).success, "el brief cabe en el contrato");
  assert.ok(RespuestaGuiadaSchema.safeParse({ brief }).success, "y vuelve al cliente aunque no tenga temática");
  assert.ok(AsistenteGuiadoRequestSchema.safeParse({ schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "hola" }], brief }).success, "y el cliente lo puede volver a mandar");
  const texto = textoHechosCliente(brief) ?? "";
  assert.ok(texto.includes("boda") && texto.includes("arco orgánico") && texto.includes("unos 3 metros"), texto);
});

caso("C: «arco orgánico» es el arco completo; «asimétrico» es el que se afina; otras piezas y medidas", () => {
  assert.equal(estructuraDeTexto("un arco orgánico")?.id, "arco");
  assert.equal(estructuraDeTexto("un arco orgánico asimétrico")?.id, "arco_asimetrico");
  assert.equal(estructuraDeTexto("arco asimétrico de globos")?.id, "arco_asimetrico");
  assert.equal(estructuraDeTexto("un medio arco orgánico")?.id, "semiarco");
  assert.equal(estructuraDeTexto("dos columnas orgánicas")?.id, "columna_asimetrica");
  assert.equal(estructuraDeTexto("una guirnalda de 4 metros")?.id, "guirnalda");
  assert.equal(estructuraDeTexto("algo arcoíris para mi hija"), null);
  assert.deepEqual(medidaDeTexto("de 3 x 2,4 m"), { texto: "3 x 2,4 m", ancho_m: 3, alto_m: 2.4 });
  assert.deepEqual(medidaDeTexto("columnas de 2 metros de alto"), { texto: "2 metros de alto", alto_m: 2 });
  assert.deepEqual(medidaDeTexto("de 250 cm"), { texto: "250 cm", metros: 2.5 });
  assert.equal(medidaDeTexto("4 a 6 años"), null);
  assert.equal(medidaDeTexto("300 mil pesos"), null);
  assert.deepEqual(medidasParaPieza("columna", { texto: "2 metros", metros: 2 }), { alto_m: 2 });
  assert.deepEqual(medidasParaPieza("guirnalda", { texto: "4 metros", metros: 4 }), { largo_m: 4 });
  assert.equal(medidasParaPieza("bouquet", { texto: "1 metro", metros: 1 }), null);
  // Los textos de la interfaz y los pedidos de ver ideas no son pedidos de pieza.
  assert.equal(hechosDelCliente(["Propónme una pieza individual: Arco orgánico.", "Me gusta «Dos columnas rosa, lila y dorado»."]).estructura, undefined);
  assert.equal(hechosDelCliente(["Muéstrame ideas con columnas"]).estructura, undefined);
});

caso("C: la propuesta del modelo (arco_asimetrico sin medidas) sale con el arco de 3 m que pidió", () => {
  const brief = briefConHechos({}, hechosDelCliente([DECORADOR]), {});
  const pedido = propuestaConLoPedido([{ estructura: "arco_asimetrico" as const, cantidad: 1 }], brief, { individual: false, conservarPieza: false });
  assert.deepEqual(pedido.piezas, [{ estructura: "arco", cantidad: 1, medidas: { ancho_m: 3 } }]);
  assert.equal(pedido.cambios.length, 2, pedido.cambios.join(" | "));
  // Un botón de pieza individual manda sobre la pieza; la medida igual se aplica.
  const boton = propuestaConLoPedido([{ estructura: "arco_asimetrico" as const, cantidad: 1 }], brief, { individual: true, conservarPieza: true });
  assert.deepEqual(boton.piezas, [{ estructura: "arco_asimetrico", cantidad: 1, medidas: { ancho_m: 3 } }]);
  // Sin pieza de su familia, la pedida se agrega; con varias piezas y sin pieza nombrada, la medida no se adivina.
  assert.deepEqual(propuestaConLoPedido([{ estructura: "columna" as const, cantidad: 2 }], brief, { individual: false, conservarPieza: false }).piezas.map((pieza) => pieza.estructura), ["arco", "columna"]);
  assert.deepEqual(propuestaConLoPedido([{ estructura: "columna" as const, cantidad: 2 }, { estructura: "guirnalda" as const, cantidad: 1 }], { medida: { texto: "2 metros", metros: 2 } }, { individual: false, conservarPieza: false }).piezas, [{ estructura: "columna", cantidad: 2 }, { estructura: "guirnalda", cantidad: 1 }]);
  const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: ["blanco", "dorado"], piezas: pedido.piezas });
  assert.equal(propuesta.frase, "Te propongo un arco en blanco y dorado.");
  assert.deepEqual(propuesta.piezas[0]?.medidas, { ancho_m: 3 });
  assert.match(leer("src/app/api/asistente-guiado/route.ts"), /decidir\("regla:propuesta_con_lo_pedido"/);
});

// ── D. La instrucción del plan con las palabras del cliente ──────────────────────────────────────────────────────
caso("D: la instrucción y el cuerpo del plan llevan lo que dijo el cliente, y el evento no filtra el catálogo", () => {
  const mensajes = [DECORADOR, "Será en un jardín, de noche, y tengo un presupuesto de 300 mil pesos"];
  const brief = briefConHechos({}, hechosDelCliente(mensajes), { uso: "negocio" });
  const cliente = contextoClienteGuiado(brief, mensajes);
  const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: ["blanco", "dorado"], piezas: propuestaConLoPedido([{ estructura: "arco_asimetrico" as const, cantidad: 1 }], brief, { individual: false, conservarPieza: false }).piezas });
  const instruccion = instruccionPlanGuiado(propuesta, { cliente });
  assert.match(instruccion, /estructura_oficial: arco;/);
  assert.match(instruccion, /medidas: ancho_m 3/);
  // La medida ya va en su pieza (ancho_m 3): en palabras solo lo demás, sin repetirla ni contradecirla.
  assert.match(instruccion, /Lo que pidió el cliente, con sus palabras \(respétalo\): lugar «en un jardín»; momento «de noche»; presupuesto «presupuesto de 300 mil pesos»\./);
  // Si no se pudo poner en una pieza (varias piezas y ninguna nombrada), va en palabras.
  const sinPieza = instruccionPlanGuiado(normalizarPropuestaComposicion({ frase: "x", colores: ["blanco"], piezas: [{ estructura: "columna", cantidad: 2 }, { estructura: "guirnalda", cantidad: 1 }] }), { cliente: { medida: "unos 3 metros" } });
  assert.match(sinPieza, /Lo que pidió el cliente, con sus palabras \(respétalo\): medida «unos 3 metros»\./);
  assert.match(instruccion, /Mezcla de tamaños: en Arco /, "el arco orgánico que pidió mezcla tamaños");
  assert.ok(!/boda/i.test(instruccion), "el evento no va en el texto: sería un filtro duro de ocasión (globos «Nuestra Boda»)");
  // Lo que /api/chat sacará del texto: presupuesto como techo, ninguna ocasión, ningún número de figura.
  assert.deepEqual(filtrosDurosDeBusqueda({ mensaje: "globo redondo blanco", solicitudOriginal: instruccion, brief: { tipo_evento: "boda" } }).ocasiones, []);
  assert.equal(extraerRestriccionesConversacion([instruccion], {}).presupuesto?.techo_cop, 300_000);
  assert.deepEqual(numerosPedidos(instruccion), []);
  const cuerpo = cuerpoPlanGuiado(propuesta, { reintento: false, cliente });
  assert.deepEqual(cuerpo.brief, { colores: ["blanco", "dorado"], tipo_evento: "boda", espacio: "en un jardín", momento_dia: "de noche" });
  assert.equal(cuerpo.solicitudCliente, `${DECORADOR}. Será en un jardín, de noche, y tengo un presupuesto de 300 mil pesos.`);
  assert.ok(ChatRequestV1Schema.safeParse(cuerpo).success, "chat-v1 acepta el cuerpo (solicitudCliente es aditivo)");
  // La ocasión y la petición del plan salen de las palabras del cliente.
  assert.equal(parseEventSearchIntent(cuerpo.solicitudCliente!).event_label, "boda");
  assert.equal(parseEventIntent(cuerpo.solicitudCliente!).original_request, cuerpo.solicitudCliente);
  const registro = leer("src/lib/ia/herramientas/registro-herramientas.ts");
  assert.match(registro, /parseEventSearchIntent\(options\.solicitudCliente \?\? estado\.solicitudOriginal\)/);
  assert.match(registro, /enriquecerPlanResueltoEvento\(resuelto, intentoDelPlan,/);
  // Un cambio sobre un plan ya hecho conserva el plan: sin las palabras del principio.
  const cambio = instruccionPlanGuiado(propuesta, { cliente, planAnterior: { piezas: [{ estructura: "arco", cantidad: 1 }], colores: ["blanco", "dorado"] } });
  assert.ok(!cambio.includes("Lo que pidió el cliente"), "en un cambio no se reimponen la medida ni el presupuesto del principio");
});

caso("D: las palabras del cliente no llevan los textos de la interfaz", () => {
  assert.equal(solicitudDelCliente(["Cumpleaños", "4 a 6 años", "Rosa y lila", "Me gusta «Dos columnas rosa, lila y dorado».", "Quiero saber cuánto cuestan los materiales.", "Es para uso personal.", "Arma mi plan con «Dos columnas»."]), "Cumpleaños. 4 a 6 años. Rosa y lila.");
  assert.equal(solicitudDelCliente(["Propónme algo para una decoración completa con varias piezas.", "Sí, armémoslo."]), undefined);
  assert.equal(lineaPalabrasCliente({ evento: "boda" }), null, "solo el evento no hace línea: va en el brief");
});

// ── F. Ajustes que hice ──────────────────────────────────────────────────────────────────────────────────────────
caso("F: «Ajustes que hice» en palabras de cliente, como la clásica", () => {
  const plan = {
    plan: {
      estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco", estructura_oficial: "arco" }, { estructura_id: "EST_02_COLUMNA_A", nombre: "Columna izquierda", estructura_oficial: "columna" }],
      supuestos: [],
    },
    sustituciones: [{ estructura_id: "EST_01_ARCO", pedido: "R-18", entregado: "R-24", motivo: "sin_variante" }, { estructura_id: "EST_01_ARCO", pedido: "R-18", entregado: "R-24", motivo: "sin_variante" }],
    sin_cobertura: [{ estructura_id: "EST_02_COLUMNA_A", product_id: "P", tamano: "R-5" }],
    advertencias: [
      "sobrante_alto:46594221474087",
      "puerta_fisica:EST_01_ARCO: estimated material quantity appears too low",
      "pista_patron_incompleta:EST_02_COLUMNA_A: Columna izquierda: la foto muestra rosado en la base y el patrón no lo lleva",
      "color_sin_globos:EST_01_ARCO:dorado: Arco: el dorado que declara el plan se queda sin globos y no se compra: una pieza de 10 globos no alcanza.",
    ],
  };
  const ajustes = ajustesDePython(plan);
  const textos = ajustes.map((ajuste) => ajuste.texto);
  assert.ok(textos.includes("Para el arco no hay globos de 18″ en ese color; usamos globos de 24″.") || textos.some((texto) => /arco no hay globos de 18.*24/.test(texto)), textos.join(" | "));
  assert.ok(textos.some((texto) => /la columna izquierda/.test(texto) && /5/.test(texto)), `faltante de la columna: ${textos.join(" | ")}`);
  assert.ok(textos.includes("La foto muestra rosado en la base y el patrón no lo lleva."), textos.join(" | "));
  assert.ok(textos.includes("El arco no lleva dorado: no alcanzan sus globos para todos sus colores."), textos.join(" | "));
  assert.ok(!textos.some((texto) => /sobrante|puerta|estimated|EST_|R-\d/.test(texto)), `sin jerga ni avisos internos: ${textos.join(" | ")}`);
  assert.equal(ajustes.filter((ajuste) => /18/.test(ajuste.texto)).length, 1, "sin repetidos");
  assert.equal(ajustes[0]?.tipo, "faltante");
  const html = renderToStaticMarkup(createElement(AjustesPropuesta, { ajustes }));
  assert.ok(html.includes("Ajustes que hice"), html.slice(0, 300));
  assert.deepEqual(ajustesDePython({ plan: { estructuras: [] } }), []);
  assert.deepEqual(ajustesDePython(null), []);
  const tarjeta = leer("src/components/guiado/TarjetaPlan.tsx");
  assert.match(tarjeta, /ajustesDePython\(plan, \{ sinColoresDeFoto: Boolean\(avisoColores\) \}\)/);
  assert.match(tarjeta, /<AjustesPropuesta ajustes=\{ajustesPython\}/);
});

caso("A + F: «Tu plan» (fixture real) con el costeo abierto no pregunta el uso y muestra «Ajustes que hice»", () => {
  const fixture = JSON.parse(leer("scripts/test/fixtures/plan-guiado-columnas-repetidas.json")) as Record<string, unknown> & { plan: Record<string, unknown> };
  const plan = { ...fixture, sustituciones: [{ estructura_id: "EST_02_COLUMNA", pedido: "R-18", entregado: "R-24", motivo: "sin_variante" }], plan: { ...fixture.plan, supuestos: [] } };
  const props = { plan, estadoImagen: "nada", compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {}, onAccion: () => undefined, onCosteo: () => undefined, onProveedores: () => undefined, onDistribuidor: () => undefined };
  const html = renderToStaticMarkup(createElement(TarjetaPlan, { ...props, usoCosteo: "personal", usoConocido: "personal" } as unknown as Parameters<typeof TarjetaPlan>[0]));
  assert.ok(!html.includes("¿Para qué es la decoración?"), "con el uso ya elegido no se vuelve a preguntar");
  assert.ok(html.includes("Precio para uso personal") && html.includes("¿Es para tu negocio?"), "el precio sale directo, con el enlace para cambiarlo");
  assert.ok(html.includes("Ajustes que hice") && /Para la columna de globos no hay globos de 18.{1,12} en ese color; usamos globos de 24/.test(html), "lo que Python sustituyó, en palabras de cliente");
});

if (fallos > 0) {
  console.error(`\n${fallos} caso(s) fallaron.`);
  process.exit(1);
}
console.log("\nUsabilidad guiada 97/100: uso una vez, edad con su rango, datos del decorador, palabras del cliente y ajustes de Python.");
