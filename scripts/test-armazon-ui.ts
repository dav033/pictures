/**
 * Iteración 4, armazón de la app: pasos en vivo desde eventos `herramienta`,
 * contexto del evento en la cabecera y presentación de errores ui-error.v1.
 * Determinista, sin red. Run: npx tsx scripts/test-armazon-ui.ts
 */
import assert from "node:assert/strict";
import { aplicarEventoHerramienta, cerrarPasos, textoPaso } from "../src/lib/estado/pasos-asistente";
import { readFileSync } from "node:fs";
import { contextoEvento, contextoEventoConversacion } from "../src/lib/estado/contexto-evento";
import { presentarError, respetarReintentable, uiErrorDesdeEventoChat } from "../src/lib/estado/estado-error";
import { construirUiErrorV1, type AccionUiV1 } from "../src/lib/ia/contracts/ui-error-v1";
import type { PlanResuelto } from "../src/lib/plan/resuelto";
import { crearEsperaAnalisis, DURACION_MINIMA_ANALISIS_MS, esperarDuracionMinima, restanteDuracionMinima } from "../src/lib/estado/espera-analisis";
import { MENSAJE_SIN_CONEXION, mensajeErrorCliente } from "../src/lib/estado/mensaje-error-cliente";
import { interpretarPreferenciaTema, OPCIONES_TEMA, resolverTema, siguienteTema } from "../src/lib/tema/tema";

// Pasos del asistente.
let pasos = aplicarEventoHerramienta([], "guardar_brief", "ejecutando");
assert.deepEqual(pasos, [{ id: "guardar_brief", texto: "Entendiendo tu idea", estado: "en_curso" }]);
pasos = aplicarEventoHerramienta(pasos, "guardar_brief", "lista");
pasos = aplicarEventoHerramienta(pasos, "buscar_catalogo_rag", "ejecutando");
assert.equal(pasos.length, 2);
assert.equal(pasos[0]!.texto, "Entendí tu idea");
assert.equal(pasos[1]!.texto, "Buscando globos en el catálogo");
pasos = aplicarEventoHerramienta(pasos, "buscar_catalogo_rag", "lista");
pasos = aplicarEventoHerramienta(pasos, "buscar_catalogo_rag", "ejecutando");
assert.equal(pasos.length, 2, "una herramienta repetida reabre su paso, no lo duplica");
assert.equal(pasos[1]!.estado, "en_curso");
pasos = aplicarEventoHerramienta(pasos, "confirmar_plan_decoracion", "ejecutando");
assert.equal(pasos[2]!.texto, "Armando la propuesta con medidas y cantidades");
const cerrados = cerrarPasos(pasos);
assert.ok(cerrados.every((paso) => paso.estado === "listo"), "al terminar el turno ningún paso sigue en curso");
assert.equal(textoPaso("herramienta_nueva_x", "en_curso"), "Trabajando en tu propuesta", "herramienta desconocida: frase genérica, nunca el nombre técnico");
for (const nombre of ["guardar_brief", "buscar_catalogo_rag", "confirmar_seleccion_rag", "confirmar_plan_decoracion"]) {
  for (const estado of ["en_curso", "listo", "fallido"] as const) {
    assert.ok(!/_/.test(textoPaso(nombre, estado)), `${nombre}: frase sin jerga en ${estado}`);
  }
}
console.log("[PASS] pasos del asistente: frases de cliente, sin duplicados y cerrados al terminar");

// Un resultado `ok:false` no puede pintarse como un paso cumplido: el cliente veía
// "Armé la propuesta con medidas y cantidades" en verde y sin propuesta ninguna.
{
  let fallidos = aplicarEventoHerramienta([], "confirmar_plan_decoracion", "ejecutando");
  fallidos = aplicarEventoHerramienta(fallidos, "confirmar_plan_decoracion", "lista", false);
  assert.equal(fallidos[0]!.estado, "fallido");
  assert.equal(fallidos[0]!.texto, "No pude armar la propuesta");
  assert.notEqual(fallidos[0]!.texto, textoPaso("confirmar_plan_decoracion", "listo"));

  // Cerrar el turno no puede convertir un fallo en éxito.
  assert.equal(cerrarPasos(fallidos)[0]!.estado, "fallido", "cerrarPasos no fabrica un éxito que no ocurrió");

  // Sin `ok` (herramientas que no usan el campo) nada cambia respecto de antes.
  const sinCampo = aplicarEventoHerramienta([], "buscar_catalogo_rag", "lista");
  assert.equal(sinCampo[0]!.estado, "listo");
  const conOkTrue = aplicarEventoHerramienta([], "buscar_catalogo_rag", "lista", true);
  assert.equal(conOkTrue[0]!.estado, "listo");

  // Un paso que falló y se reintenta vuelve a abrirse.
  const reabierto = aplicarEventoHerramienta(fallidos, "confirmar_plan_decoracion", "ejecutando");
  assert.equal(reabierto.length, 1);
  assert.equal(reabierto[0]!.estado, "en_curso");
}
console.log("[PASS] un paso con ok:false se pinta como fallido, no como cumplido");

// Contexto del evento.
assert.equal(contextoEvento({}), null, "sin brief no hay contexto");
assert.equal(contextoEvento({ tipo_evento: "Cumpleaños", colores: ["rosa", "blanco", "plateado"], presupuesto: 1_500_000 })?.replace(/\s/g, " "), "Cumpleaños · rosa, blanco y plateado · hasta $ 1.500.000");
assert.equal(contextoEvento({ colores: ["azul"] }), "azul");
assert.equal(contextoEvento({ tipo_evento: "Boda", presupuesto: "$100.000 a $200.000" }), "Boda · $100.000 a $200.000");
assert.equal(contextoEvento({ tipo_evento: "  ", presupuesto: 0 }), null, "valores vacíos no se muestran");
console.log("[PASS] contexto del evento: solo lo que trae el brief");

// E2E real 3 (P3–P7): tras «quita el azul» la cabecera seguía en «azul y blanco».
// Los colores salen de la propuesta más reciente; el brief solo manda si cambió después de ella.
{
  const planCon = (colores: Array<[string, number]>) => ({
    estructuras: [{ lineas: colores.map(([color, unidades]) => ({ color, unidades })) }],
    compras: [],
  }) as unknown as PlanResuelto;
  const briefViejo = { tipo_evento: "Cumpleaños", colores: ["azul", "blanco"] };
  const conversacion = [
    { role: "user" as const },
    { role: "assistant" as const, brief: briefViejo, plan: planCon([["azul", 40], ["plateado", 20]]) },
    { role: "user" as const },
    { role: "assistant" as const, brief: briefViejo, plan: planCon([["blanco", 30], ["plateado", 12], ["blanco", 20]]) },
  ];
  assert.equal(contextoEventoConversacion(conversacion, briefViejo), "Cumpleaños · blanco y plateado", "el plan más reciente manda sobre un brief desactualizado");
  assert.equal(contextoEventoConversacion([...conversacion, { role: "user" as const }, { role: "assistant" as const, brief: briefViejo }], briefViejo), "Cumpleaños · blanco y plateado", "un turno sin propuesta con el mismo brief no revive colores viejos");
  const briefNuevo = { tipo_evento: "Cumpleaños", colores: ["rojo"] };
  assert.equal(contextoEventoConversacion([...conversacion, { role: "user" as const }, { role: "assistant" as const, brief: briefNuevo }], briefNuevo), "Cumpleaños · rojo", "si el brief cambió después de la propuesta, manda el brief");
  assert.equal(contextoEventoConversacion([{ role: "assistant" as const }], briefViejo), "Cumpleaños · azul y blanco", "sin propuesta, el brief");
  assert.equal(contextoEventoConversacion([{ role: "assistant" as const, plan: planCon([]) }], briefViejo), "Cumpleaños · azul y blanco", "propuesta sin colores: el brief");
  assert.equal(contextoEventoConversacion([{ role: "assistant" as const, plan: planCon([["dorado rosa", 5]]) }], {}), "oro rosa", "nombres de color del cliente");
  const pagina = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /contextoEventoConversacion\(mensajes, brief\)/, "la cabecera usa la conversación, no solo el brief");
  assert.match(pagina, /brief: datos\.brief/, "cada respuesta guarda el brief de su evento fin");
  console.log("[PASS] contexto del evento: colores de la propuesta o brief más recientes");
}

// Errores.
const todas = new Set<AccionUiV1>(["reintentar", "generar_estilo_estandar", "revisar_propuesta", "pedir_nueva_propuesta", "ajustar_propuesta", "activar_validacion_visual", "revisar_adjuntos"]);
const sinSaldo = presentarError(construirUiErrorV1("VISTA_PREVIA_NO_DISPONIBLE", { mensaje: "fal 403 Exhausted balance" }), "generacion", todas);
assert.equal(sinSaldo.mensaje.startsWith("La vista previa de la imagen no está disponible por ahora"), true);
assert.deepEqual(sinSaldo.acciones, [], "fal sin saldo: sin Reintentar");
assert.equal(sinSaldo.variante, "aviso");
assert.ok(!sinSaldo.mensaje.includes("403") && !sinSaldo.mensaje.includes("fal"), "nunca el texto técnico");
const red = presentarError(construirUiErrorV1("SIN_CONEXION", { mensaje: "fetch falló" }), "chat", new Set<AccionUiV1>(["reintentar"]));
assert.deepEqual(red.acciones, ["reintentar"]);
assert.equal(red.variante, "error");
const noReintentable = presentarError({ ...construirUiErrorV1("SERVICIO_NO_DISPONIBLE", { mensaje: "x" }), retryable: false }, "generacion", todas);
assert.deepEqual(noReintentable.acciones, [], "retryable false nunca ofrece Reintentar");
const soloDisponibles = presentarError(construirUiErrorV1("ESTILO_REQUIERE_PROPUESTA", { mensaje: "x" }), "catalogo", new Set());
assert.deepEqual(soloDisponibles.acciones, [], "solo acciones que el origen sabe ejecutar");
assert.equal(presentarError(construirUiErrorV1("ERROR_INTERNO", { mensaje: "x" }), "chat", todas).titulo, "No pude responder");
console.log("[PASS] estados de error: mensaje redactado, acciones filtradas y fal sin saldo no reintentable");

// E2E real 3 (r2, da911f76): el evento SSE traía retryable:false y la UI ofreció «Reintentar».
{
  const interno = uiErrorDesdeEventoChat({ code: "INTERNAL_ERROR", error: "ZodError", retryable: false, request_id: "11111111-1111-4111-8111-111111111111" });
  assert.equal(interno.retryable, false);
  assert.equal(interno.accion_sugerida, null, "sin acción sugerida de reintento");
  assert.doesNotMatch(interno.mensaje_usuario, /intenta de nuevo/i, "el texto no invita a reintentar");
  assert.doesNotMatch(interno.mensaje_usuario, /\berror\b|zod/i);
  assert.deepEqual(presentarError(interno, "chat", todas).acciones, [], "chat no reintentable: sin Reintentar");
  const tiempo = uiErrorDesdeEventoChat({ code: "AI_TIMEOUT", error: "timeout", retryable: false });
  assert.ok(!presentarError(tiempo, "chat", todas).acciones.includes("reintentar"));
  assert.doesNotMatch(tiempo.mensaje_usuario, /intenta de nuevo/i);
  const reintentable = uiErrorDesdeEventoChat({ code: "AI_TIMEOUT", error: "timeout", retryable: true });
  assert.deepEqual(presentarError(reintentable, "chat", todas).acciones, ["reintentar"], "retryable true sí ofrece Reintentar");
  assert.deepEqual(presentarError(uiErrorDesdeEventoChat({ code: "INTERNAL_ERROR", error: "x" }), "chat", todas).acciones, ["reintentar"], "sin el campo se usa el catálogo");
  // Cuerpo de /api/generate sin ui_error pero con retryable:false.
  const generacion = respetarReintentable(construirUiErrorV1("ERROR_INTERNO", { mensaje: "x" }), false, "generacion");
  assert.deepEqual(presentarError(generacion, "generacion", todas).acciones, []);
  assert.match(generacion.mensaje_usuario, /imagen/, "el texto habla de la imagen, no de reescribir el mensaje");
  assert.doesNotMatch(generacion.mensaje_usuario, /intenta de nuevo/i);
  // La acción sugerida del contrato se respeta aunque no sea reintentar.
  const presupuesto = respetarReintentable(construirUiErrorV1("PRESUPUESTO_EXCEDIDO", { mensaje: "x" }), false);
  assert.equal(presupuesto.accion_sugerida, construirUiErrorV1("PRESUPUESTO_EXCEDIDO", { mensaje: "x" }).accion_sugerida);
  const pagina = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pagina, /uiErrorDesdeChatV1\(/, "page.tsx no traduce eventos de chat ignorando retryable");
  assert.match(pagina, /retryable\?: boolean/, "onError del SSE recibe retryable");
  const analisis = readFileSync(new URL("../src/components/references/ReferenceAnalysisController.tsx", import.meta.url), "utf8");
  assert.match(analisis, /onReintentar=\{reintentable \? reintentar : undefined\}/, "el análisis de la foto oculta Reintentar si no es reintentable");
  console.log("[PASS] errores no reintentables: nunca «Reintentar» (chat, generación y análisis)");
}

// D4 del E2E real: sin red el análisis de la foto mostraba «Failed to fetch».
for (const tecnico of [new TypeError("Failed to fetch"), new TypeError("NetworkError when attempting to fetch resource."), new TypeError("Load failed")]) {
  assert.equal(mensajeErrorCliente(tecnico, "No se pudo analizar tu foto."), MENSAJE_SIN_CONEXION, `${tecnico.message} → mensaje de conexión`);
}
assert.equal(MENSAJE_SIN_CONEXION, "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
assert.equal(mensajeErrorCliente(new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"), "No se pudo analizar tu foto."), "No se pudo analizar tu foto.", "HTML de un proxy: respaldo");
assert.equal(mensajeErrorCliente(new Error("La foto pesa demasiado."), "respaldo"), "La foto pesa demasiado.", "un mensaje ya redactado pasa tal cual");
assert.equal(mensajeErrorCliente("boom", "respaldo"), "respaldo");
assert.equal(mensajeErrorCliente(new Error("  "), "respaldo"), "respaldo");
console.log("[PASS] errores del navegador: sin «Failed to fetch» ni textos técnicos para el cliente");

// D10 del E2E real: tras tocar el interruptor había que poder volver a seguir al sistema.
assert.deepEqual(OPCIONES_TEMA.map((opcion) => [opcion.valor, opcion.etiqueta]), [["light", "Claro"], ["dark", "Oscuro"], ["sistema", "Sistema"]], "menú de tema con tres opciones");
assert.equal(interpretarPreferenciaTema(null), "sistema", "sin elección guardada se sigue al sistema");
assert.equal(resolverTema("sistema", true), "dark");
assert.equal(resolverTema("sistema", false), "light");
assert.equal(resolverTema("light", true), "light", "una elección explícita manda sobre el sistema");
assert.equal(siguienteTema(resolverTema("sistema", true)), "light", "el cambio rápido sigue alternando lo que se ve");
console.log("[PASS] tema: Claro / Oscuro / Sistema y cambio rápido");

// Espera del análisis de la foto antes de enviar el turno (revisión iteración 4).
void (async () => {
  const temporizadores: Array<{ fn: () => void; ms: number; activo: boolean }> = [];
  const reloj = {
    programar: (fn: () => void, ms: number) => temporizadores.push({ fn, ms, activo: true }) - 1,
    cancelar: (id: number) => { temporizadores[id]!.activo = false; },
  };
  const espera = crearEsperaAnalisis(reloj);
  assert.equal(await espera.esperar(45_000), "sin_analisis", "sin foto analizándose no se espera");
  espera.notificar("analyzing");
  const fallida = espera.esperar(45_000);
  espera.notificar("error");
  assert.equal(await fallida, "fallo", "un análisis fallido libera el envío al instante, sin agotar el límite");
  assert.ok(temporizadores.every((t) => !t.activo), "el límite se cancela al resolver");
  assert.equal(await espera.esperar(45_000), "fallo", "tras el fallo no se vuelve a esperar");
  espera.notificar("analyzing");
  const lista = espera.esperar(45_000);
  espera.notificar("ready");
  assert.equal(await lista, "listo");
  espera.notificar("analyzing");
  const colgada = espera.esperar(45_000);
  temporizadores.at(-1)!.fn();
  assert.equal(await colgada, "limite", "un análisis que no responde tiene límite");
  console.log("[PASS] espera del análisis: sale al terminar, al fallar o al límite");

  // Un análisis desde caché llega al instante: el escaneo dura al menos 5 s.
  assert.equal(DURACION_MINIMA_ANALISIS_MS, 5_000);
  assert.equal(restanteDuracionMinima(1_000, 1_200), 4_800, "respuesta desde caché: falta casi todo el mínimo");
  assert.equal(restanteDuracionMinima(1_000, 9_000), 0, "un análisis real más largo que el mínimo no espera de más");
  assert.equal(restanteDuracionMinima(1_000, 500), 5_000, "un reloj que retrocede no acorta ni alarga el mínimo");
  const temporizadoresMinimo: Array<{ fn: () => void; ms: number; activo: boolean }> = [];
  const relojMinimo = {
    programar: (fn: () => void, ms: number) => temporizadoresMinimo.push({ fn, ms, activo: true }) - 1,
    cancelar: (id: number) => { temporizadoresMinimo[id]!.activo = false; },
  };
  let resuelta = false;
  const minimo = esperarDuracionMinima(0, new AbortController().signal, { ahora: () => 300, reloj: relojMinimo }).then(() => { resuelta = true; });
  await Promise.resolve();
  assert.equal(temporizadoresMinimo[0]!.ms, 4_700, "espera solo lo que falta del mínimo");
  assert.equal(resuelta, false, "no marca listo antes del mínimo");
  temporizadoresMinimo[0]!.fn();
  await minimo;
  assert.equal(resuelta, true);
  assert.equal(temporizadoresMinimo.length, 1);
  await esperarDuracionMinima(0, new AbortController().signal, { ahora: () => 6_000, reloj: relojMinimo });
  assert.equal(temporizadoresMinimo.length, 1, "sin tiempo pendiente no programa nada");
  const cancelacion = new AbortController();
  const cancelada = esperarDuracionMinima(0, cancelacion.signal, { ahora: () => 0, reloj: relojMinimo });
  cancelacion.abort(new Error("otra foto"));
  await assert.rejects(cancelada, /otra foto/, "cambiar de foto cancela la espera");
  assert.equal(temporizadoresMinimo.at(-1)!.activo, false, "la cancelación limpia el temporizador");
  const yaCancelado = new AbortController();
  yaCancelado.abort(new Error("desmontado"));
  await assert.rejects(esperarDuracionMinima(0, yaCancelado.signal, { ahora: () => 0, reloj: relojMinimo }), /desmontado/);
  console.log("[PASS] análisis desde caché: el escaneo dura al menos 5 s y se cancela con la foto");
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
