/**
 * Racimos de globitos y el orbe con flecos (`racimos-globos.ts`). Sin coste.
 * - cada predefinido arma con la cantidad pedida, sin globos montados (los centros a más de 0,8 inflados) y con
 *   colores que se fabrican en su formato;
 * - el racimo de uvas es más largo que ancho, cuelga hacia −z y abomba hacia +y; el orbe lleva sus flecos bajo la esfera;
 * - están en DECORACIONES_PREDEFINIDAS y tienen su texto para FLUX.
 *
 * Run: npx tsx scripts/test/test-racimos-globos.ts
 */
import assert from "node:assert/strict";
import { RACIMOS_PREDEFINIDOS, armarRacimo } from "@/lib/globos3d/racimos-globos";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, decoracionEnIngles } from "@/lib/globos3d/figuras";
import { coloresDelFormato } from "@/lib/globos3d/formatos";

const centro = (g: { nudo: { x: number; y: number; z: number }; direccion: { x: number; y: number; z: number }; infladoCm: number }) => ({ x: g.nudo.x + g.direccion.x * g.infladoCm * 0.5, y: g.nudo.y + g.direccion.y * g.infladoCm * 0.5, z: g.nudo.z + g.direccion.z * g.infladoCm * 0.5 });

for (const r of RACIMOS_PREDEFINIDOS) {
  assert.ok(DECORACIONES_PREDEFINIDAS.some((d) => d.id === r.id), `${r.id} no está en las predefinidas`);
  const a = armarDecoracion(r.decoracion);
  for (const m of a.materiales) assert.ok(coloresDelFormato(m.formatoId).some((c) => c.codigo === m.codigo), `${r.id}: ${m.codigo} no viene en ${m.formatoId}`);
  const globos = a.globos;
  for (let i = 0; i < globos.length; i++) for (let j = i + 1; j < globos.length; j++) {
    const p = centro(globos[i]!), q = centro(globos[j]!);
    const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    assert.ok(d > 0.8 * Math.min(globos[i]!.infladoCm, globos[j]!.infladoCm) * 0.5 * 2 * 0.8, `${r.id}: globos ${i} y ${j} montados (${d.toFixed(1)} cm)`);
  }
  assert.ok(decoracionEnIngles(r.decoracion).length > 10);
}

const uvas = armarRacimo({ forma: "uvas", globo: { formatoId: "R-5", infladoCm: 11 }, codigos: ["970"], cantidad: 18, semilla: 1 });
assert.equal(uvas.globos.length, 18);
const zs = uvas.globos.map((g) => centro(g).z), xs = uvas.globos.map((g) => centro(g).x), ys = uvas.globos.map((g) => centro(g).y);
assert.ok(Math.max(...zs) - Math.min(...zs) > Math.max(...xs) - Math.min(...xs), "las uvas son más largas que anchas");
assert.ok(Math.min(...zs) < -20, "cuelgan hacia −z (abajo, de frente o sobre una superficie)");
assert.ok(Math.min(...ys) > 0, "la cara abombada hacia +y (fuera de la superficie)");

const orbe = armarDecoracion(RACIMOS_PREDEFINIDOS.find((r) => r.id === "orbe_flecos_dorado")!.decoracion);
assert.ok(orbe.tubos.length >= 20 && orbe.tubos.every((t) => t.puntos.every((p) => p.z < 0)), "los flecos cuelgan bajo la esfera");

console.log("test-racimos-globos: ok");
