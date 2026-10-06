import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OPCIONES_GUIADAS } from "../../src/components/guiado/ChipsOpciones";
import { generarPasosPlan } from "../../src/lib/ia/guiado/generar-pasos-plan";

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
  const conArmados = JSON.parse(JSON.stringify(guardado)) as { plan: { estructuras: Array<Record<string, unknown>> } };
  conArmados.plan.estructuras[0]!.armado_arco = { patron: "espiral", capas: [null, null], secciones: [null] };
  conArmados.plan.estructuras[1]!.armado_columna = { patron: "apilado", capas: [{}, {}, {}], remate: { tipo: "racimo" } };
  const guiaConArmados = generarPasosPlan(conArmados);
  assert.ok(guiaConArmados.pasos.some((paso) => paso.texto.includes("2 capas") && paso.texto.includes("1 sección de color")));
  assert.ok(guiaConArmados.pasos.some((paso) => paso.texto.includes("3 capas o discos") && paso.texto.includes("remate racimo")));
  console.log(`OK: ${OPCIONES_GUIADAS.find((opcion) => opcion.id === "aprender")?.titulo}; ${resultado.pasos.length} pasos, ${resultado.total} globos resueltos.`);
}

void main();
