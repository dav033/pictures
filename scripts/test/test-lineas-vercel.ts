/**
 * `npm run registros -- --origen vercel` lee las líneas del servidor que `vercel logs --json` guarda en el arreglo `logs[]` de cada
 * entrada (antes solo miraba `message`: los registros de producción salían vacíos). Sin red: no llama a Vercel.
 *   npx tsx scripts/test/test-lineas-vercel.ts
 */
import assert from "node:assert/strict";
import { entradasDeVercel, lineasPropias, mensajesDe } from "../ops/lineas-vercel";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const registro = (evento: string) => JSON.stringify({ ts: "2026-10-09T10:31:25.000Z", evento, conversacion_id: "3d-20261009-103125-92b58a" });

prueba("las líneas propias que vienen en logs[] se leen (antes se perdían)", () => {
  const entrada = { requestPath: "/api/escena-ia", level: "info", message: "", logs: [{ message: registro("llamada_ia"), level: "info" }, { message: registro("herramienta:escena_ia") }] };
  const [e] = entradasDeVercel(JSON.stringify(entrada));
  assert.ok(e);
  assert.deepEqual(lineasPropias(e.mensajes).map((l) => (JSON.parse(l) as { evento: string }).evento), ["llamada_ia", "herramienta:escena_ia"]);
});
prueba("el message de la entrada sigue valiendo, y las dos fuentes juntas", () => {
  const [e] = entradasDeVercel(JSON.stringify({ message: registro("respuesta_ia"), logs: [{ message: registro("llamada_ia") }] }));
  assert.equal(lineasPropias(e!.mensajes).length, 2);
});
prueba("logs[] puede traer textos sueltos, objetos con payload y niveles anidados", () => {
  assert.deepEqual(mensajesDe({ logs: ["a", { payload: { text: "b" } }, { logs: [{ message: "c" }] }] }), ["a", "b", "c"]);
  assert.deepEqual(mensajesDe({ logs: [{ message: "" }, 3, null] }), []);
});
prueba("acepta una línea JSON por entrada, un arreglo, y descarta lo que no es JSON", () => {
  const dos = [{ message: "uno" }, { message: "dos" }];
  assert.equal(entradasDeVercel(dos.map((o) => JSON.stringify(o)).join("\n")).length, 2);
  assert.equal(entradasDeVercel(JSON.stringify(dos)).length, 2);
  assert.equal(entradasDeVercel("no es json\n\n{\"message\":\"x\"}\n").length, 1);
  assert.deepEqual(entradasDeVercel(""), []);
});
prueba("un mensaje con varias líneas separa las del servidor de lo demás", () => {
  const m = `inicio\n${registro("a")}\n  ${registro("b")}\nfin`;
  assert.equal(lineasPropias([m]).length, 2);
});

console.log(`\n${pruebas} pruebas ok`);
