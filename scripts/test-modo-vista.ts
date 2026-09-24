/**
 * B1 (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md): interpretación del modo de vista.
 * El comportamiento en navegador (clic, teclado, persistencia) se verifica con
 * el e2e de B3. Run: npx tsx scripts/test-modo-vista.ts
 */
import assert from "node:assert/strict";
import { interpretarModoVista, modoVistaDesdeQuery } from "../src/lib/estado/modo-vista";
import { abrirPromptAutomaticamente, usarLoraEfectivo } from "../src/lib/estado/modo-vista-reglas";

assert.equal(interpretarModoVista(null), "usuario", "sin preferencia guardada: modo usuario");
assert.equal(interpretarModoVista(undefined), "usuario");
assert.equal(interpretarModoVista("dev"), "dev");
assert.equal(interpretarModoVista("usuario"), "usuario");
assert.equal(interpretarModoVista("DEV"), "usuario", "un valor desconocido nunca activa dev");
assert.equal(interpretarModoVista("true"), "usuario");

assert.equal(modoVistaDesdeQuery("?dev=1"), "dev");
assert.equal(modoVistaDesdeQuery("?foo=bar&dev=0"), "usuario");
assert.equal(modoVistaDesdeQuery(""), null, "sin parámetro no cambia la preferencia");
assert.equal(modoVistaDesdeQuery("?dev=si"), null);

console.log("[PASS] modo de vista: default usuario, solo 'dev' activa dev, ?dev=1/0 explícitos");

// B2: reglas de comportamiento por modo.
const base = { selectorLora: true, estiloEstandarExplicito: false, hayFotoEspacio: false, hayReferencias: false, esAjusteDeImagen: false };
assert.equal(usarLoraEfectivo({ ...base, modo: "usuario" }), true, "sin adjuntos ni ajuste: LoRA por defecto");
assert.equal(usarLoraEfectivo({ ...base, modo: "usuario", hayFotoEspacio: true }), true, "foto del espacio: LoRA por /edit (decisión 2026-09-15)");
assert.equal(usarLoraEfectivo({ ...base, modo: "usuario", hayReferencias: true }), true, "referencias: LoRA por /edit");
assert.equal(usarLoraEfectivo({ ...base, modo: "usuario", esAjusteDeImagen: true }), true, "ajuste sobre la imagen previa: LoRA por /edit");
assert.equal(usarLoraEfectivo({ ...base, modo: "dev", hayFotoEspacio: true }), true, "modo dev: manda el selector");
assert.equal(usarLoraEfectivo({ ...base, modo: "dev", estiloEstandarExplicito: true }), false, "el pedido explícito del cliente siempre gana");
assert.equal(usarLoraEfectivo({ ...base, modo: "usuario", selectorLora: false }), false);

assert.equal(abrirPromptAutomaticamente("usuario", true), false);
assert.equal(abrirPromptAutomaticamente("dev", true), true);
assert.equal(abrirPromptAutomaticamente("dev", false), false);
console.log("[PASS] reglas por modo: estilo por capacidad en modo usuario; prompt solo en dev");
