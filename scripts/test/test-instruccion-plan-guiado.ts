// Sin red: instrucción del plan guiado, brief para chat-v1, resumen del plan y estado `planActual`.
// Plan fijo tomado del recorrido 2 (boda) de rescate/registros/2026-10-06T22-28-50-274Z/recorridos.json.
import assert from "node:assert/strict";
import { AsistenteGuiadoRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { briefChatGuiado, instruccionPlanFoto, instruccionPlanGuiado, planActualDesdePlan, resumenPlanGuiado, textoPlanActual } from "@/lib/ia/guiado/instruccion-plan";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";

const planBoda = {
  plan: {
    concepto: { titulo: "Boda Elegante en Blanco y Dorado", paleta: ["blanco", "dorado"] },
    estructuras: [
      { estructura_id: "EST_01_ARCO", nombre: "Arco orgánico principal", tipo: "arco", estructura_oficial: "arco_asimetrico", repeticiones: 1, medidas: { ancho_m: 2, alto_m: 2.2 } },
      { estructura_id: "EST_02_COLUMNA", nombre: "Columna elegante", tipo: "columna", estructura_oficial: "columna", repeticiones: 2, medidas: { alto_m: 2.4 } },
    ],
  },
  estructuras: [
    { estructura_id: "EST_01_ARCO", lineas: [{ color: "blanco", tamano_codigo: "R-12", diam_pulg: 12, unidades: 50 }, { color: "dorado", tamano_codigo: "R-12", diam_pulg: 12, unidades: 35 }] },
    { estructura_id: "EST_02_COLUMNA", lineas: [{ color: "blanco", tamano_codigo: "R-12", diam_pulg: 12, unidades: 32 }, { color: "dorado", tamano_codigo: "R-12", diam_pulg: 12, unidades: 26 }] },
  ],
};

const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: ["azul", "blanco", "dorado"], piezas: [{ estructura: "arco_asimetrico", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] });

// (b) instrucción del plan
const instruccion = instruccionPlanGuiado(propuesta, { evento: "Boda", edad: 0, tematica: "elegante" });
assert.ok(instruccion.includes("1 × Arco orgánico (estructura_oficial: arco_asimetrico; estructura_id: EST_01_ARCO_ASIMETRICO; repeticiones: 1)"), instruccion);
assert.ok(instruccion.includes("2 × Columna (estructura_oficial: columna; estructura_id: EST_02_COLUMNA; repeticiones: 2)"));
assert.ok(instruccion.includes("Todos deben aparecer en el plan."));
assert.ok(instruccion.includes("usa EXACTAMENTE estos colores: azul, blanco, dorado; no agregues otros; si uno no tiene cobertura usa el tono más cercano de ese mismo color"));
assert.ok(/Arco orgánico mezcla al menos 3 tamaños \(5", 12" y 18"\)/.test(instruccion), "pieza orgánica exige mezcla de tamaños");
assert.ok(!/Columna mezcla/.test(instruccion), "la columna clásica no está obligada a mezclar");
assert.ok(/confirma el plan en este mismo turno/i.test(instruccion) && /no le preguntes nada/i.test(instruccion));
assert.ok(/No pongas letras, números ni frases/.test(instruccion));
assert.ok(instruccion.includes("Contexto: Boda, temática elegante."), "boda sin edad");
assert.ok(!/\d+ años/.test(instruccion), "la edad solo va en cumpleaños");
assert.ok(!/intento anterior/.test(instruccion));
const cumple = instruccionPlanGuiado(propuesta, { evento: "Cumpleaños", edad: 7, tematica: "superhéroes" });
assert.ok(cumple.includes("Cumpleaños, de 7 años, temática superhéroes"));
const sinTematica = instruccionPlanGuiado(propuesta, { evento: "Baby shower", edad: 3, tematica: "pendiente" });
assert.ok(!sinTematica.includes("pendiente") && !sinTematica.includes("3 años"), sinTematica);
const reintento = instruccionPlanGuiado(propuesta, { evento: "Boda" }, { reintento: true });
assert.ok(reintento.includes('El intento anterior no se pudo confirmar: busca cada color en 5", 12" y 18" antes de confirmar y usa solo variantes con cobertura'));
const planAnterior = planActualDesdePlan(planBoda)!;
const cambio = instruccionPlanGuiado(propuesta, { evento: "Boda" }, { planAnterior });
assert.ok(cambio.includes("el plan nuevo lleva SOLO las piezas de esta lista"), cambio);
assert.ok(!cambio.includes("Tu plan:") && !/columnas/.test(cambio), "no describe el plan anterior: /api/chat leería sus cantidades como restricciones");
assert.ok(!/(?:\bej-|\bdeco-|sku|variant_id)/i.test(instruccion), "sin ids internos del catálogo");

// (c) foto
assert.ok(/confírmalo con confirmar_plan_decoracion/.test(instruccionPlanFoto()));
assert.ok(instruccionPlanFoto({ reintento: true }).includes("El intento anterior no se pudo confirmar"));

// (d) brief para chat-v1: sin cadenas vacías (briefSchema exige min(1))
assert.deepEqual(briefChatGuiado(propuesta, { evento: "Boda", tematica: "elegante" }), { tipo_evento: "Boda", colores: ["azul", "blanco", "dorado"], estilo: "elegante" });
assert.deepEqual(briefChatGuiado(null, { evento: " ", tematica: "" }), {});
assert.deepEqual(briefChatGuiado(null, { evento: "Boda", tematica: "por definir" }), { tipo_evento: "Boda" });

// (e) resumen del plan (content del mensaje, viaja en el historial)
const resumen = resumenPlanGuiado(planBoda);
assert.equal(resumen, "Tu plan: 1 arco orgánico de 2 × 2,2 m y 2 columnas de 2,4 m, en blanco y dorado; 143 globos en total.");
assert.ok(resumen.length <= 400 && !/EST_|R-12|sku/i.test(resumen));
assert.equal(resumenPlanGuiado({ basura: true }), "Tu plan está listo.");
const muchas = { ...planBoda, plan: { ...planBoda.plan, estructuras: Array.from({ length: 12 }, (_, indice) => ({ ...planBoda.plan.estructuras[0]!, estructura_id: `E${indice}`, nombre: `Pieza con un nombre bastante largo número ${indice}` , estructura_oficial: undefined })) } };
assert.ok(resumenPlanGuiado(muchas).length <= 400, "nunca pasa de 400 caracteres");

// (f) planActual
assert.deepEqual(planAnterior, {
  piezas: [{ estructura: "arco_asimetrico", cantidad: 1, nombre: "Arco orgánico principal" }, { estructura: "columna", cantidad: 2, nombre: "Columna elegante" }],
  colores: ["blanco", "dorado"], totalGlobos: 143, resumen,
});
assert.equal(planActualDesdePlan({ basura: true }), null);
assert.equal(textoPlanActual(planAnterior), resumen);
assert.equal(textoPlanActual({ ...planAnterior, resumen: undefined }), "1 Arco orgánico principal y 2 Columna elegante en blanco y dorado; 143 globos en total.");
// El estado que manda el cliente pasa el contrato del asistente guiado.
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ schema_version: "asistente-guiado.v1", messages: [{ role: "assistant", content: resumen }, { role: "user", content: "mejor en rosado y dorado, sin columnas" }], brief: {}, estadoGuiado: { planActual: planAnterior } }).success, true);

console.log(`test-instruccion-plan-guiado: OK — ${resumen}`);
