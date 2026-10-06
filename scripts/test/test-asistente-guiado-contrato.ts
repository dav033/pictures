import { strict as assert } from "node:assert";
import { AsistenteGuiadoRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

const base = { schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "Quiero un cumpleaños de 8 años, con estrellas" }], brief: { evento: "cumpleaños", edad: 8, tematica: "estrellas" } };
assert.equal(AsistenteGuiadoRequestSchema.safeParse(base).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, loraMode: "inventado" }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { decoracionId: "deco-no-real" } }).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, fotoInspiracion: { mime: "image/gif", base64: "abc" } }).success, false);
console.log("test-asistente-guiado-contrato: 4 comprobaciones correctas");
