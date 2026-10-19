import assert from "node:assert/strict";
import { juzgarPeticion, MAX_TURNOS_DE_CHAT } from "../e2e/humo/guardia-de-gasto";

const bloquea = (metodo: string, ruta: string, turnos = 0) => juzgarPeticion(metodo, ruta, turnos).accion === "bloquear";

// Lo que genera imágenes o llama a la IA de pago se aborta, venga por donde venga.
for (const ruta of ["/api/generate", "/api/guiada-imagen", "/api/guiada/motor/imagen", "/api/render-3d-imagen", "/api/modulos-render", "/api/escena-ia", "/api/chat", "/api/generate/recuperar", "/api/guiada-imagen/abc"]) {
  assert.equal(bloquea("POST", ruta), true, `POST ${ruta} se bloquea`);
}

// Las lecturas de esas mismas rutas (comprobar la caché de un render, el estado de una generación) no gastan.
assert.equal(bloquea("GET", "/api/modulos-render"), false, "GET /api/modulos-render (caché) pasa");
assert.equal(bloquea("GET", "/api/guiada-imagen/abc"), false, "GET de estado pasa");

// Lo que la interfaz usa sin pagar sigue pasando.
for (const [metodo, ruta] of [["GET", "/api/taller/hoja-armado"], ["GET", "/api/ia/salud"], ["POST", "/api/registro-cliente"], ["POST", "/api/login"], ["GET", "/api/productos"]] as const) {
  assert.deepEqual(juzgarPeticion(metodo, ruta, 0), { accion: "permitir" }, `${metodo} ${ruta} pasa`);
}

// Los turnos del asistente se cuentan y topan: el tercero se aborta.
for (let hechos = 0; hechos < MAX_TURNOS_DE_CHAT; hechos += 1) {
  assert.deepEqual(juzgarPeticion("POST", "/api/asistente-guiado", hechos), { accion: "contar-turno" }, `turno ${hechos + 1} cuenta`);
}
assert.equal(bloquea("POST", "/api/asistente-guiado", MAX_TURNOS_DE_CHAT), true, "el turno siguiente al tope se bloquea");
assert.equal(juzgarPeticion("GET", "/api/asistente-guiado", 0).accion, "permitir", "un GET al asistente no es un turno");

// Un prefijo parecido no es la misma ruta.
assert.equal(bloquea("POST", "/api/generated-docs"), false, "/api/generated-docs no es /api/generate");

console.log("[PASS] guardia de gasto del humo e2e: bloquea rutas de pago y el turno extra, deja pasar lecturas y rutas gratuitas");
