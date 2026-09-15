/**
 * Iteración 4, armazón de la app: pasos en vivo desde eventos `herramienta`,
 * contexto del evento en la cabecera y presentación de errores ui-error.v1.
 * Determinista, sin red. Run: npx tsx scripts/test-armazon-ui.ts
 */
import assert from "node:assert/strict";
import { aplicarEventoHerramienta, cerrarPasos, textoPaso } from "../src/lib/estado/pasos-asistente";
import { contextoEvento } from "../src/lib/estado/contexto-evento";
import { presentarError } from "../src/lib/estado/estado-error";
import { construirUiErrorV1, type AccionUiV1 } from "../src/lib/ia/contracts/ui-error-v1";
import { crearEsperaAnalisis } from "../src/lib/estado/espera-analisis";
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
for (const nombre of ["guardar_brief", "calcular_medidas", "buscar_catalogo_rag", "confirmar_seleccion_rag", "confirmar_plan_decoracion"]) {
  assert.ok(!/_/.test(textoPaso(nombre, "en_curso")) && !/_/.test(textoPaso(nombre, "listo")), `${nombre}: frase sin jerga`);
}
console.log("[PASS] pasos del asistente: frases de cliente, sin duplicados y cerrados al terminar");

// Contexto del evento.
assert.equal(contextoEvento({}), null, "sin brief no hay contexto");
assert.equal(contextoEvento({ tipo_evento: "Cumpleaños", colores: ["rosa", "blanco", "plateado"], presupuesto: 1_500_000 })?.replace(/\s/g, " "), "Cumpleaños · rosa, blanco y plateado · hasta $ 1.500.000");
assert.equal(contextoEvento({ colores: ["azul"] }), "azul");
assert.equal(contextoEvento({ tipo_evento: "Boda", presupuesto: "$100.000 a $200.000" }), "Boda · $100.000 a $200.000");
assert.equal(contextoEvento({ tipo_evento: "  ", presupuesto: 0 }), null, "valores vacíos no se muestran");
console.log("[PASS] contexto del evento: solo lo que trae el brief");

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
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
