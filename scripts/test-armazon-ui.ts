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
