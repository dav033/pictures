/**
 * Fondos y muebles (`fondos-escenografia.ts`). Sin coste.
 * - cada uno del catálogo arma como escenografía (sólidos, sin globos ni materiales) y apoyado en el piso;
 * - la media luna es un solo contorno cerrado, más alto que ancho y del lado pedido;
 * - los pedestales salen lado a lado con sus alturas; el letrero lleva su texto.
 *
 * Run: npx tsx scripts/test/test-fondos-escenografia.ts
 */
import assert from "node:assert/strict";
import { FONDOS_CATALOGO, letrero, mediaLuna, pedestales } from "@/lib/globos3d/fondos-escenografia";
import { armarPieza } from "@/lib/globos3d/piezas";

for (const f of FONDOS_CATALOGO) {
  const a = armarPieza({ tipo: "escenografia", elementos: f.elementos() });
  assert.equal(a.globos.length, 0);
  assert.equal(a.materiales.length, 0, `${f.id} no cotiza`);
  assert.ok(a.caja.min.y > -1 && a.caja.min.y < 1, `${f.id}: apoyado en el piso (${a.caja.min.y})`);
}
for (const lado of ["derecha", "izquierda"] as const) {
  const [luna] = mediaLuna({ diametroCm: 180, hex: "#1c2f5e", lado });
  assert.ok(luna && luna.forma === "panel");
  const xs = luna.contorno.map((p) => p.x), ys = luna.contorno.map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs), "más alta que ancha");
  const medio = (Math.max(...xs) + Math.min(...xs)) / 2;
  assert.ok(lado === "derecha" ? medio > 0 : medio < 0, `${lado}: ${medio.toFixed(0)}`);
}
const ped = pedestales({ cilindros: [{ diametroCm: 50, altoCm: 70, hex: "#fff" }, { diametroCm: 40, altoCm: 100, hex: "#000" }] });
assert.ok(ped.every((p) => p.forma === "cilindro"));
assert.ok(ped[0]!.forma === "cilindro" && ped[1]!.forma === "cilindro" && ped[1]!.base.x - ped[0]!.base.x >= 45);
const [cartel] = letrero({ texto: "Asher", anchoCm: 90, altoCm: 40, hex: "#eee", tinta: "#234" });
assert.equal(cartel?.motivo?.texto, "Asher");
console.log("test-fondos-escenografia: ok");
