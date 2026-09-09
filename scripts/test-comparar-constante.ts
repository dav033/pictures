import assert from "node:assert/strict";
import { compararEnTiempoConstante } from "../src/lib/seguridad/comparar-constante";

assert.equal(compararEnTiempoConstante("secreto-123", "secreto-123"), true, "strings iguales deben coincidir");
assert.equal(compararEnTiempoConstante("secreto-123", "secreto-124"), false, "un byte distinto debe rechazar");
assert.equal(compararEnTiempoConstante("corto", "mucho-mas-largo"), false, "largos distintos deben rechazar sin lanzar");
assert.equal(compararEnTiempoConstante("", ""), true, "dos strings vacíos son iguales");
assert.equal(compararEnTiempoConstante("", "algo"), false, "vacío contra no-vacío rechaza");
assert.equal(compararEnTiempoConstante("Secreto-123", "secreto-123"), false, "es sensible a mayúsculas");

console.log("[PASS] compararEnTiempoConstante: coincide exacto, rechaza distinto/largo distinto, sin lanzar");
