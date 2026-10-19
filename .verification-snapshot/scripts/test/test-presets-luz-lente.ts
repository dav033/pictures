/**
 * T43: presets de luz (cálida / fría / UV) y de lente (gran angular / normal / tele) del visor del taller.
 * Prueba la config pura de `ambiente-visor.ts` (no importa `ambiente-sala.ts`).
 * Run: npx tsx --conditions=react-server scripts/test/test-presets-luz-lente.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AJUSTE_VISOR_DEFECTO, LENTES_VISOR, NOMBRES_LUZ_VISOR, OPTICO_NEUTRO, ajusteOpticoDe, guardarAmbienteVisor, leerAmbienteVisor, type IdLente, type IdLuz } from "../../src/lib/globos3d/ambiente-visor";

const LUCES: IdLuz[] = ["neutra", "calida", "fria", "uv"];
const LENTES: IdLente[] = ["gran_angular", "normal", "tele"];
const canal = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

test("cada preset de luz y de lente tiene nombre y produce un ajuste válido (colores hex, intensidades finitas)", () => {
  for (const luz of LUCES) {
    assert.ok(NOMBRES_LUZ_VISOR[luz].length > 0);
    for (const lente of LENTES) {
      const a = ajusteOpticoDe({ luz, lente });
      assert.ok(Number.isFinite(a.intensidadEntorno) && a.intensidadEntorno > 0);
      assert.ok(a.fovGrados > 0 && a.fovGrados < 180);
      if (a.luz) {
        assert.match(a.luz.colorSol, /^#[0-9a-f]{6}$/i);
        assert.match(a.luz.colorAmbiente, /^#[0-9a-f]{6}$/i);
        assert.ok(a.luz.intensidadSol > 0 && a.luz.intensidadAmbiente >= 0);
      }
    }
  }
  for (const lente of LENTES) assert.ok(LENTES_VISOR[lente].nombre.length > 0);
});

test("el defecto es neutro y normal, y deja el visor exactamente como estaba", () => {
  assert.deepEqual(ajusteOpticoDe(AJUSTE_VISOR_DEFECTO), OPTICO_NEUTRO);
  assert.equal(OPTICO_NEUTRO.luz, null);
});

test("cálida es más roja que fría, fría más azul que cálida, UV es violeta y más oscura que las demás", () => {
  const luz = (id: IdLuz) => ajusteOpticoDe({ luz: id, lente: "normal" });
  const [c, f, u] = [luz("calida"), luz("fria"), luz("uv")];
  assert.ok(canal(c.luz!.colorSol, 0) > canal(f.luz!.colorSol, 0));
  assert.ok(canal(f.luz!.colorSol, 2) > canal(c.luz!.colorSol, 2));
  assert.ok(canal(u.luz!.colorSol, 2) > canal(u.luz!.colorSol, 1), "violeta: más azul que verde");
  assert.ok(u.intensidadEntorno < c.intensidadEntorno && u.intensidadEntorno < f.intensidadEntorno);
  assert.ok(u.luz!.intensidadSol < c.luz!.intensidadSol);
});

test("la lente ordena el campo de visión: tele < normal < gran angular, y la luz no cambia con la lente", () => {
  const fov = (lente: IdLente) => ajusteOpticoDe({ luz: "calida", lente }).fovGrados;
  assert.ok(fov("tele") < fov("normal") && fov("normal") < fov("gran_angular"));
  assert.deepEqual(ajusteOpticoDe({ luz: "calida", lente: "tele" }).luz, ajusteOpticoDe({ luz: "calida", lente: "gran_angular" }).luz);
});

test("la persistencia valida cada campo y no lanza: valor ajeno cae al defecto del campo", () => {
  const mem: Record<string, string> = {};
  assert.equal(guardarAmbienteVisor({ setItem: (k, v) => { mem[k] = v; } }, { luz: "uv", lente: "tele" }), true);
  assert.deepEqual(leerAmbienteVisor({ getItem: (k) => mem[k] ?? null }), { luz: "uv", lente: "tele" });
  assert.deepEqual(leerAmbienteVisor({ getItem: () => JSON.stringify({ luz: "constructor", lente: 7 }) }), AJUSTE_VISOR_DEFECTO);
  assert.deepEqual(leerAmbienteVisor({ getItem: () => "null" }), AJUSTE_VISOR_DEFECTO);
  assert.equal(guardarAmbienteVisor({ setItem: () => { throw new Error("cuota"); } }, AJUSTE_VISOR_DEFECTO), false);
});
