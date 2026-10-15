import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import { packageSchema } from "../../packages/happie-package-ia/src/esquemas";
import { aPaqueteV1, recomendacionesV1 } from "../../src/lib/happie/paquete-v1";
import { HappiePackageRecommendationResponseV1Schema, HappiePackageV1Schema } from "../../src/lib/ia/contracts/happie-v1";

// Real shape of /api/packages since 2026-10-13: extra fields on the package and on its items, `description: null`
// on most items, decimal totals, blank provider names. The strict happie.v1 response must carry all of it.

const real = {
  id: "pkg-1",
  event_type_id: "evt-1",
  city_id: "city-1",
  city: "Barranquilla",
  city_slug: "barranquilla",
  name: "Cumpleaños Acuarela",
  base_guests: 8,
  standard_duration_minutes: null,
  conditions: null,
  restrictions: null,
  is_active: true,
  is_featured: true,
  package_items: [
    {
      id: "item-1", package_id: "pkg-1", total: 75166.5, charge_type: "total", charge_mode: "event", quantity_editable: false,
      sale_unit: null, removable: false, suggested_start_time: null, description: null, is_active: true, provider_name: "", category_name: "Pastelería",
    },
    {
      id: "item-2", package_id: "pkg-1", total: 1200, charge_type: "per_person", charge_mode: "per_person", quantity_editable: true,
      sale_unit: { singular: "refrigerio", plural: "refrigerios" }, removable: true, suggested_start_time: "15:00:00", description: "Refrigerio", is_active: false,
      provider_name: "Dulce Fiesta", category_name: null,
    },
  ],
} as unknown as HappiaPackage;

// The fixture is a real-shaped record: it must pass the client's own validation too, not just a cast.
packageSchema.parse(real);

// Both UI routes must keep projecting: without it the raw package hits the strict schema again (502 in production).
for (const ruta of ["src/app/api/happie/recomendar/route.ts", "src/app/api/happie/recomendar-pasos/route.ts"]) {
  assert.match(readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8"), /recomendacionesV1\(/, `${ruta} proyecta los paquetes a happie.v1`);
}

// The raw object is what used to be 502: the strict schema rejects the unknown keys.
assert.throws(() => HappiePackageV1Schema.parse(real), "the raw package is not a happie.v1 package");

const proyectado = aPaqueteV1(real);
assert.deepEqual(Object.keys(proyectado).sort(), ["base_guests", "conditions", "event_type_id", "id", "is_active", "is_featured", "name", "package_items", "restrictions", "standard_duration_minutes"]);
assert.equal(proyectado.package_items[0]?.description, null, "null description stays null");
assert.equal(proyectado.package_items[0]?.provider_name, null, "a blank provider name becomes null");
assert.equal(proyectado.package_items[0]?.total, 75166.5, "decimal totals are kept");
assert.ok(!("charge_mode" in (proyectado.package_items[0] ?? {})), "new upstream item fields are not leaked");
HappiePackageV1Schema.parse(proyectado);

const respuesta = HappiePackageRecommendationResponseV1Schema.parse({
  schema_version: "happie.v1",
  recomendaciones: recomendacionesV1([{ paquete: real, razon: "Encaja con 8 invitados" }]),
  resumen: "Una opción",
});
assert.equal(respuesta.recomendaciones[0]?.paquete.id, "pkg-1");

// An invalid value is still rejected: the projection does not hide a broken total.
assert.throws(() => HappiePackageV1Schema.parse({ ...proyectado, package_items: [{ ...proyectado.package_items[0], total: -1 }] }));

console.log("happie.v1: un paquete real de Happia (campos nuevos, description null, total decimal) se proyecta y valida PASS");
