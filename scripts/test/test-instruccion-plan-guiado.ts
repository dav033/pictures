// Sin red: instrucción del plan guiado, brief para chat-v1, plan defectuoso, resumen del plan y estado `planActual`.
// Plan fijo tomado del recorrido 2 (boda) de rescate/registros/2026-10-06T22-28-50-274Z/recorridos.json.
import assert from "node:assert/strict";
import { AsistenteGuiadoRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { briefChatGuiado, defectoPlanGuiado, instruccionPlanFoto, instruccionPlanGuiado, planActualDesdePlan, resumenPlanGuiado, textoPlanActual } from "@/lib/ia/guiado/instruccion-plan";
import { extraerFiltrosDurosBusqueda } from "@/lib/rag/query-parser/hard-filters";
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
const instruccion = instruccionPlanGuiado(propuesta);
assert.ok(instruccion.includes("1 × Arco orgánico (estructura_oficial: arco_asimetrico; estructura_id: EST_01_ARCO_ASIMETRICO; repeticiones: 1)"), instruccion);
assert.ok(instruccion.includes("2 × Columna (estructura_oficial: columna; estructura_id: EST_02_COLUMNA; repeticiones: 2)"));
assert.ok(instruccion.includes("Todos deben aparecer en el plan."));
assert.ok(instruccion.includes("usa EXACTAMENTE estos colores: azul, blanco, dorado; no agregues otros; si uno no tiene cobertura usa el tono más cercano de ese mismo color"));
assert.ok(/Arco orgánico mezcla al menos 3 tamaños \(5", 12" y 18"\)/.test(instruccion), "pieza orgánica exige mezcla de tamaños");
assert.ok(!/Columna mezcla/.test(instruccion), "la columna clásica no está obligada a mezclar");
assert.ok(/confirma el plan en este mismo turno/i.test(instruccion) && /no le preguntes nada/i.test(instruccion));
assert.ok(/solo globos lisos de un solo color: nada estampado, impreso ni con dibujos, letras, números o frases/.test(instruccion));
assert.ok(!/l[aá]tex/i.test(instruccion), "«látex» en el texto del cliente bloquea la categoría en la búsqueda");
// El texto del mensaje es «lo que dijo el cliente» para /api/chat: un evento ahí se vuelve filtro duro de ocasión
// («Cumpleaños» → solo globos impresos de cumpleaños de 12"). Ni evento, ni edad, ni temática.
assert.ok(!/Contexto|cumplea|boda|princesa|\d+ años/i.test(instruccion), instruccion);
assert.ok(!/intento anterior/.test(instruccion));
const reintento = instruccionPlanGuiado(propuesta, { reintento: true });
assert.ok(reintento.includes('El intento anterior no sirvió: busca cada color en 5", 12" y 18", solo globos lisos de un solo color'), reintento);
const planAnterior = planActualDesdePlan(planBoda)!;
const cambio = instruccionPlanGuiado(propuesta, { planAnterior });
assert.ok(cambio.includes("el plan nuevo lleva SOLO las piezas de esta lista"), cambio);
assert.ok(!cambio.includes("Tu plan:") && !/columnas/.test(cambio), "no describe el plan anterior: /api/chat leería sus cantidades como restricciones");
assert.ok(!/(?:\bej-|\bdeco-|sku|variant_id)/i.test(instruccion), "sin ids internos del catálogo");
// Sin filtros duros de ocasión ni de categoría que salgan de la instrucción (el fallo del cumpleaños de princesas).
const filtros = extraerFiltrosDurosBusqueda(instruccion, briefChatGuiado(propuesta.colores));
assert.deepEqual([filtros.ocasiones, filtros.categorias, filtros.acabados], [[], [], []], JSON.stringify(filtros));

// (c) foto: los colores que la lectura le mostró al cliente
assert.ok(/confírmalo con confirmar_plan_decoracion/.test(instruccionPlanFoto()));
assert.ok(!/usa EXACTAMENTE/.test(instruccionPlanFoto()), "sin lectura de colores no inventa la línea");
const foto = instruccionPlanFoto({ colores: ["Dorado", "Blanco", "Azul", "Rosa"] });
assert.ok(foto.includes("usa EXACTAMENTE estos colores: dorado, blanco, azul, rosa; no agregues otros"), foto);
assert.ok(instruccionPlanFoto({ reintento: true }).includes("El intento anterior no sirvió"));

// (d) brief para chat-v1: solo colores, sin cadenas vacías (briefSchema exige min(1)) ni evento o temática
assert.deepEqual(briefChatGuiado(propuesta.colores), { colores: ["azul", "blanco", "dorado"] });
assert.deepEqual(briefChatGuiado([" ", ""]), {});
assert.deepEqual(briefChatGuiado(["Rosa", "rosa", "Dorado"]), { colores: ["rosa", "dorado"] });

// (d2) plan defectuoso: pieza orgánica de un solo tamaño o globos que no son lisos gastan el reintento automático
assert.match(defectoPlanGuiado(planBoda) ?? "", /Arco orgánico principal.*un solo tamaño/, "el arco orgánico de boda salió todo en 12\"");
const planBodaMezclado = { ...planBoda, estructuras: [{ ...planBoda.estructuras[0]!, lineas: [...planBoda.estructuras[0]!.lineas, { color: "blanco", tamano_codigo: "R-5", diam_pulg: 5, unidades: 20, titulo: "Globo Fashion Blanco R-5" }] }, planBoda.estructuras[1]!] };
assert.equal(defectoPlanGuiado(planBodaMezclado), null, "arco con 12\" y 5\" y columna clásica en un solo tamaño: sirve");
const impreso = { ...planBodaMezclado, compras: [{ titulo: "Globo Impreso 2 Caras Copa Dorada R-12" }] };
assert.match(defectoPlanGuiado(impreso) ?? "", /no son lisos/);
assert.match(defectoPlanGuiado(planBodaMezclado, { lineas: [{ nombre: "Infinity® Balón De Futbol Fashion Blanco R-12" }] }) ?? "", /no son lisos/);
assert.equal(defectoPlanGuiado(planBodaMezclado, { lineas: [{ nombre: "Globo Reflex Dorado R-12 x 50" }, { nombre: "Globo Pastel Mate Rosado R-5" }] }), null);
assert.equal(defectoPlanGuiado({ basura: true }), null);
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
