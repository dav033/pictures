import { strict as assert } from "node:assert";
import { decoracionesSempertex, proveedoresSempertex, bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { DecoracionSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";

assert.equal(decoracionesSempertex.length, 3);
assert.equal(proveedoresSempertex.length, 4);
assert.ok(decoracionesSempertex.every((decoracion) => decoracion.origen === "ejemplo" && decoracion.id.startsWith("ej-") && decoracion.aviso === "DATO DE EJEMPLO — no es real"));
assert.ok(proveedoresSempertex.every((proveedor) => proveedor.origen === "ejemplo" && proveedor.id.startsWith("ej-prov-") && proveedor.contacto === null && new URL(proveedor.url).hostname === "example.com"));
assert.ok(bibliotecaVisible().every((decoracion) => decoracion.origen === "ejemplo" || decoracion.id.startsWith("deco-")));
assert.equal(DecoracionSempertexSchema.safeParse({ ...decoracionesSempertex[0], id: "deco-incorrecto" }).success, false);
assert.equal(DecoracionSempertexSchema.safeParse({ ...decoracionesSempertex[0], materiales: [{ variantId: "x", sku: null, cantidad: 1, precio: 100 }] }).success, false);
console.log("test-biblioteca-sempertex: 6 comprobaciones correctas");
