import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OPCIONES_GUIADAS } from "../../src/components/guiado/ChipsOpciones";
import { generarPasosPlan } from "../../src/lib/ia/guiado/generar-pasos-plan";
import { estructurasOficialesSinGuia, GUIAS_ARMADO, guiaParaEstructura } from "../../src/lib/ia/guiado/guias-armado";
import { ESTRUCTURAS_OFICIALES_IDS } from "../../src/lib/plan/estructuras-oficiales";
import { WidgetGuiadoSchema } from "../../src/lib/ia/guiado/widgets";
import { esquemaHerramientaPropuesta } from "../../src/lib/ia/guiado/esquema-herramienta-propuesta";

async function main() {
  const guardado = JSON.parse(await readFile("eval/ui/plan-resuelto-arco-columnas.json", "utf8")) as unknown;
  const resultado = generarPasosPlan(guardado);
  assert.equal(OPCIONES_GUIADAS.find((opcion) => opcion.id === "aprender")?.titulo, "Aprender a hacerlo");
  assert.ok(resultado.total > 0, "debe contar solo unidades resueltas del plan guardado");
  assert.equal(resultado.pasos[0]?.orden, 1);
  assert.ok(resultado.pasos.some((paso) => paso.texto.includes("Arco Orgánico Principal")));
  assert.ok(resultado.pasos.some((paso) => paso.texto.includes("Columnas Laterales Coordinadas")));
  assert.ok(resultado.globos.some((globo) => globo.color === "blanco" && globo.tamano === "5\""));
  assert.equal(resultado.total, resultado.globos.reduce((suma, globo) => suma + globo.cantidad, 0));
  assert.equal(estructurasOficialesSinGuia().length, 0, "cada estructura oficial debe tener guía aproximada");
  assert.ok(ESTRUCTURAS_OFICIALES_IDS.every((id) => guiaParaEstructura(id)), "guías cubren estructuras oficiales");
  assert.ok(GUIAS_ARMADO.every((guia) => guia.fuentes.every((fuente) => /^https?:\/\//.test(fuente.url))), "conserva URLs de fuentes");
  assert.equal(resultado.guias.length, (guardado as { plan: { estructuras: unknown[] } }).plan.estructuras.length, "el plan guardado debe combinar cada pieza con guía");
  assert.ok(resultado.guias.some((pieza) => pieza.globos.some((globo) => globo.cantidad > 0)), "la guía incluye cantidades reales del plan por pieza");
  assert.equal(WidgetGuiadoSchema.parse({ tipo: "pregunta-propuesta", alcance: "tipo" }).tipo, "pregunta-propuesta");
  assert.equal(WidgetGuiadoSchema.parse({ tipo: "pregunta-propuesta", alcance: "pieza" }).tipo, "pregunta-propuesta");
  const schemaBase = { properties: { piezas: { items: { properties: { cantidad: { type: "integer", minimum: 1, maximum: 12 } } } } } };
  const completa = esquemaHerramientaPropuesta(schemaBase, "completa").properties as { piezas: { minItems: number; maxItems: number } };
  const individual = esquemaHerramientaPropuesta(schemaBase, "individual").properties as { piezas: { minItems: number; maxItems: number; items: { properties: { cantidad: { minimum: number; maximum: number } } } } };
  assert.deepEqual([completa.piezas.minItems, completa.piezas.maxItems], [2, 3]);
  assert.deepEqual([individual.piezas.minItems, individual.piezas.maxItems, individual.piezas.items.properties.cantidad.maximum], [1, 1, 1]);
  const conArmados = JSON.parse(JSON.stringify(guardado)) as { plan: { estructuras: Array<Record<string, unknown>> } };
  conArmados.plan.estructuras[0]!.armado_arco = { patron: "espiral", capas: [null, null], secciones: [null] };
  conArmados.plan.estructuras[1]!.armado_columna = { patron: "apilado", capas: [{}, {}, {}], remate: { tipo: "racimo" } };
  const guiaConArmados = generarPasosPlan(conArmados);
  assert.ok(guiaConArmados.pasos.some((paso) => paso.texto.includes("2 capas") && paso.texto.includes("1 sección de color")));
  assert.ok(guiaConArmados.pasos.some((paso) => paso.texto.includes("3 capas o discos") && paso.texto.includes("remate racimo")));
  console.log(`OK: ${OPCIONES_GUIADAS.find((opcion) => opcion.id === "aprender")?.titulo}; ${resultado.pasos.length} pasos, ${resultado.total} globos resueltos.`);
}

void main();
