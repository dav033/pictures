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
  assert.equal((completa as unknown as { piezas: { items: { properties: { cantidad: { maximum: number } } } } }).piezas.items.properties.cantidad.maximum, 4, "la decoración completa admite repeticiones («dos columnas»)");
  const conPieza = esquemaHerramientaPropuesta({ properties: { piezas: { items: { properties: { estructura: { type: "string", enum: ["arco", "columna"] }, cantidad: { type: "integer" } } } } } }, "individual", "columna").properties as { piezas: { items: { properties: { estructura: { enum: string[] } } } } };
  assert.deepEqual(conPieza.piezas.items.properties.estructura.enum, ["columna"], "la pieza pedida fija la estructura");
  const conArmados = JSON.parse(JSON.stringify(guardado)) as { plan: { estructuras: Array<Record<string, unknown>> } };
  conArmados.plan.estructuras[0]!.armado_arco = { patron: "espiral", capas: [null, null], secciones: [null] };
  conArmados.plan.estructuras[1]!.armado_columna = { patron: "apilado", capas: [{}, {}, {}], remate: { tipo: "racimo" } };
  const guiaConArmados = generarPasosPlan(conArmados);
  assert.ok(guiaConArmados.pasos.some((paso) => paso.texto.includes("2 capas") && paso.texto.includes("1 sección de color")));
  assert.ok(guiaConArmados.pasos.some((paso) => paso.texto.includes("3 capas o discos") && paso.texto.includes("remate de arriba")));
  // Sin jerga del motor ni del catálogo en los pasos.
  const textoPasos = guiaConArmados.pasos.map((paso) => `${paso.texto} ${paso.globos ?? ""}`).join(" ");
  assert.ok(!/R-\d|motor|patr[oó]n|dibujo del plan|remate racimo/i.test(textoPasos), `pasos con jerga: ${textoPasos}`);
  assert.ok(!guiaConArmados.pasos[1]?.globos && !guiaConArmados.pasos[1]?.texto.includes("globos blanco"), "el paso 2 no repite la lista de globos");
  // Dos líneas «negro 12"» (una con código R-12) se fusionan y el color va en plural.
  const negro = generarPasosPlan({
    plan: { concepto: {}, estructuras: [{ estructura_id: "EST_01", nombre: "Columna negra", tipo: "columna", estructura_oficial: "columna", repeticiones: 1, medidas: { alto_m: 2 } }] },
    estructuras: [{ estructura_id: "EST_01", lineas: [{ color: "negro", tamano_codigo: "R-12", unidades: 40 }, { color: "negro", diam_pulg: 12, unidades: 29 }, { color: "dorado", tamano_codigo: "R-5", unidades: 10 }] }],
  });
  assert.deepEqual(negro.globos, [{ color: "negro", tamano: "12\"", cantidad: 69 }, { color: "dorado", tamano: "5\"", cantidad: 10 }]);
  assert.ok(negro.pasos[0]?.texto.includes("69 globos negros de 12\""), negro.pasos[0]?.texto);
  assert.equal(negro.pasos[2]?.globos, "69 globos negros de 12\", 10 globos dorados de 5\"");
  // «Mezcla los tamaños» solo con dos o más (los que Python resolvió), y las medidas con coma decimal.
  const organico = (lineas: Array<{ color: string; diam_pulg: number; unidades: number }>) => generarPasosPlan({
    plan: { concepto: {}, estructuras: [{ estructura_id: "EST_01", nombre: "Arco orgánico", tipo: "arco", estructura_oficial: "arco_asimetrico", repeticiones: 1, medidas: { ancho_m: 1.5, alto_m: 2.25 }, armado_arco_organico: { volumen: { racimo: 4 }, tamanos: { mezcla: { 5: 0.2, 12: 0.6, 18: 0.2 } } } }] },
    estructuras: [{ estructura_id: "EST_01", lineas }],
  }).pasos[2]!.texto;
  const unTamano = organico([{ color: "rosado", diam_pulg: 12, unidades: 47 }, { color: "dorado", diam_pulg: 12, unidades: 36 }]);
  assert.ok(unTamano.includes("usa los globos de 12\"") && !/mezcla/i.test(unTamano), unTamano);
  assert.ok(unTamano.includes("de 1,5 m de ancho por 2,25 m de alto") && !/\d\.\d/.test(unTamano), unTamano);
  const variosTamanos = organico([{ color: "rosado", diam_pulg: 18, unidades: 4 }, { color: "rosado", diam_pulg: 5, unidades: 20 }, { color: "dorado", diam_pulg: 12, unidades: 36 }]);
  assert.ok(variosTamanos.includes("mezcla los tamaños (5\", 12\" y 18\")"), variosTamanos);
  console.log(`OK: ${OPCIONES_GUIADAS.find((opcion) => opcion.id === "aprender")?.titulo}; ${resultado.pasos.length} pasos, ${resultado.total} globos resueltos.`);
}

void main();
