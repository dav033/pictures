import assert from "node:assert/strict";
import test from "node:test";
import { agregarFeedback, type FilaParaAnalisis } from "./analisis";
import { TOPE_COSTE_RESUMEN_USD, construirPrompt, costeMaximoUsd } from "./resumen-gemini";

function fila(id: number, parcial: Partial<FilaParaAnalisis>): FilaParaAnalisis {
  return { id, turnoId: `t${id}`, producto: "taller", calificacion: 2, motivos: ["colores"], comentario: null, pedido: null, herramientas: ["pintar"], deshecho: false, ...parcial };
}

test("el prompt para Gemini no lleva correos ni teléfonos de las personas", () => {
  const resultado = agregarFeedback([
    fila(1, { comentario: "escribí a ana@correo.co y llamé al 300 123 4567, el azul salió negro", pedido: "arco azul, mi cel 3001234567" }),
    fila(2, { comentario: "el azul salió negro de nuevo, contacto ana@correo.co" }),
  ]);
  const prompt = construirPrompt(resultado, 7);
  assert.ok(!prompt.includes("ana@"));
  assert.ok(!prompt.includes("3001234567") && !prompt.includes("300 123 4567"));
  assert.ok(prompt.includes("[correo]") || prompt.includes("[teléfono]"));
});

test("la entrada está acotada y el coste máximo de una llamada queda muy por debajo del tope de US$0,02", () => {
  const muchos = Array.from({ length: 2_000 }, (_, i) => fila(i + 1, { comentario: `comentario largo número ${i} `.repeat(40), pedido: "p".repeat(500), motivos: ["colores", "lento", "otra"] }));
  const prompt = construirPrompt(agregarFeedback(muchos), 30);
  assert.ok(prompt.length <= 9_000);
  assert.ok(costeMaximoUsd(prompt) < TOPE_COSTE_RESUMEN_USD / 2, `cota ${costeMaximoUsd(prompt)}`);
});
