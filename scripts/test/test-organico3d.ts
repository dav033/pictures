/**
 * Generador orgánico 3D (/3d): columna, guirnalda y semiarco de globos de tamaños mezclados, sin three.js. Sin coste.
 * - determinista: la misma semilla da el mismo resultado (y otra semilla, otro);
 * - ningún par de globos se aplasta más del 12 % del diámetro del menor; nadie atraviesa el piso ni el pedestal;
 * - gradiente de tamaños: la base de la columna lleva globos más grandes que la punta;
 * - colores por proporción (±10 puntos) y cada color se fabrica en el formato de su globo;
 * - la réplica de la foto (`COLUMNA_QUINCE_AZUL`) mide lo pedido y cuenta lo esperado;
 * - las flores van sobre anclas de hueco válidas y salen como follaje, aparte de los globos;
 * - el cristal con confeti se marca transparente y con confeti;
 * - el armado del preset tarda menos de ~300 ms.
 */
import assert from "node:assert/strict";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { FLORES_ARTIFICIALES, repartirFlores } from "../../src/lib/globos3d/flores-artificiales";
import { APLASTAMIENTO_MAXIMO, aplastamiento, armarOrganico, estructuraPorCm, formaColumna, formaGuirnalda, formaSemiarco, mezclaEn, type GloboOrganico, type ResultadoOrganico } from "../../src/lib/globos3d/organico";
import { armarPreset, COLUMNA_QUINCE_AZUL } from "../../src/lib/globos3d/organico-presets";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";

const TOLERANCIA = 1e-9;

function comprobarFisica(r: ResultadoOrganico, nombre: string, pedestal?: { base: { x: number; y: number; z: number }; radioCm: number; altoCm: number }) {
  const g = r.globos;
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      const a = aplastamiento(g[i]!, g[j]!);
      assert.ok(a <= APLASTAMIENTO_MAXIMO + TOLERANCIA, `${nombre}: los globos ${i} y ${j} se aplastan ${(a * 100).toFixed(1)} %`);
    }
  }
  for (const b of g) {
    const radio = b.infladoCm / 2;
    assert.ok(b.centro.y >= radio * 0.94 - 1e-6, `${nombre}: el globo ${b.indice} atraviesa el piso`);
    if (pedestal && b.centro.y - radio * 0.97 < pedestal.base.y + pedestal.altoCm && b.centro.y + radio > pedestal.base.y) {
      const h = Math.hypot(b.centro.x - pedestal.base.x, b.centro.z - pedestal.base.z);
      assert.ok(h >= pedestal.radioCm + radio * 0.97 - 1e-6, `${nombre}: el globo ${b.indice} se mete en el pedestal`);
    }
    // El visor dibuja del nudo hacia el cuerpo: el centro del cuerpo queda a centroCuerpo del nudo, en la dirección.
    const l = centroCuerpo("redondo", b.infladoCm);
    assert.ok(Math.abs(Math.hypot(b.direccion.x, b.direccion.y, b.direccion.z) - 1) < 1e-9, `${nombre}: dirección no unitaria`);
    assert.ok(Math.hypot(b.nudo.x + b.direccion.x * l - b.centro.x, b.nudo.y + b.direccion.y * l - b.centro.y, b.nudo.z + b.direccion.z * l - b.centro.z) < 1e-6, `${nombre}: nudo y cuerpo no cuadran`);
    // Todos los colores se fabrican en el formato de su globo.
    assert.ok(coloresDelFormato(b.formatoId).some((c) => c.codigo === b.codigo), `${nombre}: ${b.codigo} no se fabrica en ${b.formatoId}`);
    assert.equal(b.confeti, b.confeti && b.transparente, `${nombre}: confeti en un globo que no es transparente`);
  }
  assert.ok(r.medidas.peorAplastamiento <= APLASTAMIENTO_MAXIMO + 1e-3);
  assert.equal(r.materiales.reduce((a, m) => a + m.cantidad, 0), g.length, `${nombre}: los materiales no suman los globos`);
}

/** El eje de la columna a la altura `y`, interpolando sus puntos de control. */
function ejeColumna(recorrido: ReadonlyArray<{ x: number; y: number; z: number }>, y: number) {
  for (let i = 1; i < recorrido.length; i++) {
    const a = recorrido[i - 1]!, b = recorrido[i]!;
    if (y <= b.y || i === recorrido.length - 1) {
      const t = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y || 1)));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return { x: 0, z: 0 };
}

const media = (l: readonly GloboOrganico[], f: (g: GloboOrganico) => number) => l.reduce((a, g) => a + f(g), 0) / Math.max(1, l.length);

// --- Utilidades ---------------------------------------------------------------------------------------------
{
  const m = mezclaEn([{ t: 0, pesos: { "R-24": 2, "R-12": 2 } }, { t: 1, pesos: { "R-12": 1 } }], 0.5);
  assert.ok(Math.abs([...m.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12, "la mezcla se normaliza");
  assert.ok(Math.abs(m.get("R-24")! - 1 / 2.5) < 1e-12 && Math.abs(m.get("R-12")! - 1.5 / 2.5) < 1e-12, "la mezcla se interpola");
  assert.ok(estructuraPorCm(25, 35) > estructuraPorCm(25, 25), "más envoltura, más globos por centímetro");
  assert.ok(estructuraPorCm(18, 30) > estructuraPorCm(25, 30) && estructuraPorCm(25, 30) > estructuraPorCm(48, 30), "más grande, menos globos por centímetro");
}

// --- La réplica de la foto ----------------------------------------------------------------------------------
const t0 = performance.now();
const armado = armarPreset(COLUMNA_QUINCE_AZUL);
const primeraMs = performance.now() - t0;
const t1 = performance.now();
const otraVez = armarPreset(COLUMNA_QUINCE_AZUL);
const segundaMs = performance.now() - t1;
assert.ok(Math.min(primeraMs, segundaMs) < 300, `el armado del preset tarda ${Math.min(primeraMs, segundaMs).toFixed(0)} ms`);

// Determinismo.
assert.equal(JSON.stringify(otraVez), JSON.stringify(armado), "la misma semilla da el mismo resultado");
const otraSemilla = armarOrganico({ ...COLUMNA_QUINCE_AZUL.opciones, semilla: 16 });
assert.notEqual(JSON.stringify(otraSemilla.globos), JSON.stringify(armado.organico.globos), "otra semilla da otra columna");

const { organico, flores, escena } = armado;
comprobarFisica(organico, "columna XV", escena.pedestal);
comprobarFisica(otraSemilla, "columna XV (semilla 16)", escena.pedestal);

// Conteo dentro de lo esperado (y de lo que pidió el encargo: 80-160).
const { min, max } = COLUMNA_QUINCE_AZUL.conteoEsperado;
assert.ok(min >= 80 && max <= 160);
assert.ok(organico.conteo.total >= min && organico.conteo.total <= max, `conteo ${organico.conteo.total} fuera de ${min}-${max}`);
assert.ok(otraSemilla.conteo.total >= min && otraSemilla.conteo.total <= max, `conteo (semilla 16) ${otraSemilla.conteo.total} fuera de ${min}-${max}`);
assert.equal(organico.conteo.porTamano.grande + organico.conteo.porTamano.mediano + organico.conteo.porTamano.relleno, organico.conteo.total);
assert.ok(organico.conteo.porTamano.relleno > 0 && organico.conteo.porTamano.grande > 0, "hay anclas grandes y relleno");

// La columna mide lo pedido (2,3 m ± 5 %) y la guirnalda, ~1,2 m.
const tramoColumna = COLUMNA_QUINCE_AZUL.opciones.tramos[0]!;
const columna = organico.globos.filter((g) => g.tramo === tramoColumna.id);
const guirnalda = organico.globos.filter((g) => g.tramo === "guirnalda");
const altoColumna = Math.max(...columna.map((g) => g.centro.y + g.infladoCm / 2));
assert.ok(Math.abs(altoColumna - 230) <= 230 * 0.05, `la columna mide ${altoColumna.toFixed(0)} cm`);
const largoGuirnalda = organico.medidas.tramos.find((t) => t.id === "guirnalda")!.largoCm;
assert.ok(largoGuirnalda >= 105 && largoGuirnalda <= 140, `la guirnalda mide ${largoGuirnalda} cm`);
assert.ok(guirnalda.length >= 8, "la guirnalda tiene globos");
// Gruesa abajo, fina arriba: ancho de la base frente al de la punta.
const anchoEn = (l: readonly GloboOrganico[]) => Math.max(...l.map((g) => g.centro.x + g.infladoCm / 2)) - Math.min(...l.map((g) => g.centro.x - g.infladoCm / 2));
assert.ok(anchoEn(columna.filter((g) => g.fraccion < 0.25)) > anchoEn(columna.filter((g) => g.fraccion > 0.75)), "la columna es más ancha abajo que arriba");

// Gradiente de tamaños: el diámetro medio de la base es mayor que el de la punta (todos los globos, y solo la estructura).
const base = columna.filter((g) => g.fraccion < 0.2), punta = columna.filter((g) => g.fraccion > 0.8);
const dBase = media(base, (g) => g.infladoCm), dPunta = media(punta, (g) => g.infladoCm);
assert.ok(dBase > dPunta, `diámetro medio base ${dBase.toFixed(1)} ≤ punta ${dPunta.toFixed(1)}`);
const estructura = (l: readonly GloboOrganico[]) => l.filter((g) => g.tamano !== "relleno");
assert.ok(media(estructura(base), (g) => g.infladoCm) > media(estructura(punta), (g) => g.infladoCm), "la estructura decrece hacia la punta");
assert.ok(base.some((g) => g.tamano === "grande") && !punta.some((g) => g.tamano === "grande"), "los grandes van en la base");

// Los globos apuntan hacia fuera del eje (nudo hacia dentro).
for (const g of columna.filter((x) => x.fraccion > 0.05 && x.fraccion < 0.95)) {
  const eje = ejeColumna(tramoColumna.recorrido, g.centro.y);
  const fuera = { x: g.centro.x - eje.x, z: g.centro.z - eje.z };
  assert.ok(g.direccion.x * fuera.x + g.direccion.z * fuera.z > 0, `el globo ${g.indice} apunta hacia dentro`);
  assert.ok(Math.hypot(g.nudo.x - eje.x, g.nudo.z - eje.z) < Math.hypot(fuera.x, fuera.z), `el nudo del globo ${g.indice} no queda hacia dentro`);
}

// Proporciones de color dentro de ±10 puntos.
const paleta = COLUMNA_QUINCE_AZUL.opciones.colores;
const pesoTotal = paleta.reduce((a, c) => a + c.peso, 0);
for (const c of paleta) {
  const real = (organico.conteo.porColor[c.codigo] ?? 0) / organico.conteo.total;
  assert.ok(Math.abs(real - c.peso / pesoTotal) <= 0.1, `color ${c.codigo}: ${(real * 100).toFixed(0)} % frente a ${((c.peso / pesoTotal) * 100).toFixed(0)} %`);
  for (const g of organico.globos.filter((x) => x.codigo === c.codigo)) if (c.formatos) assert.ok(c.formatos.includes(g.formatoId), `${c.codigo} fuera de sus formatos (${g.formatoId})`);
}
// Sin dos del mismo color pegados cuando se puede: los colores minoritarios casi nunca tocan a uno igual.
let paresMinoritarios = 0;
for (let i = 0; i < organico.globos.length; i++) {
  for (let j = i + 1; j < organico.globos.length; j++) {
    const a = organico.globos[i]!, b = organico.globos[j]!;
    if (a.codigo !== b.codigo || a.codigo === "640") continue;
    if (Math.hypot(a.centro.x - b.centro.x, a.centro.y - b.centro.y, a.centro.z - b.centro.z) <= (a.infladoCm + b.infladoCm) / 2 + 2) paresMinoritarios++;
  }
}
assert.ok(paresMinoritarios <= 4, `${paresMinoritarios} pares de blanco/plata/cristal pegados entre sí`);

// Cristal con confeti: transparente y con confeti; el resto, opaco y sin confeti.
const cristales = organico.globos.filter((g) => g.codigo === "390");
assert.ok(cristales.length > 0 && cristales.every((g) => g.transparente && g.confeti), "el cristal va transparente y con confeti");
assert.ok(organico.globos.filter((g) => g.codigo !== "390").every((g) => !g.transparente && !g.confeti));
assert.ok(organico.materiales.some((m) => m.codigo === "390" && m.confeti && m.nombre.includes("confeti")), "el confeti es su propio material");

// Flores: sobre anclas de hueco válidas, del lado que se ve, y como follaje aparte.
assert.equal(organico.anclas.length, COLUMNA_QUINCE_AZUL.opciones.huecosFlores, "se reservaron todos los huecos para flores");
for (const a of organico.anclas) {
  assert.ok(a.normal.z >= 0.15 - 1e-9, `el ancla ${a.indice} no mira a quien ve`);
  assert.ok(a.holguraCm >= 2, `el ancla ${a.indice} quedó tapada por los globos (${a.holguraCm} cm)`);
  assert.ok(a.posicion.y > 0 && a.fraccion >= 0 && a.fraccion <= 1);
}
assert.equal(flores.racimos.length, organico.anclas.length);
for (const r of flores.racimos) {
  const ancla = organico.anclas[r.ancla];
  assert.ok(ancla, `racimo sobre un ancla que no existe (${r.ancla})`);
  assert.deepEqual(r.posicion, ancla.posicion);
  assert.equal(r.flores.length, COLUMNA_QUINCE_AZUL.flores.tallosPorRacimo);
  for (const f of r.flores) {
    assert.ok(Math.hypot(f.posicion.x - ancla.posicion.x, f.posicion.y - ancla.posicion.y, f.posicion.z - ancla.posicion.z) <= FLORES_ARTIFICIALES.hortensia.diametroCm, "una flor quedó lejos de su ancla");
    assert.ok(FLORES_ARTIFICIALES[f.tipo].colores.some((c) => c.id === f.colorId && c.hex === f.hex));
  }
  // La flor del centro es la más grande del racimo.
  assert.ok(r.flores.every((f) => f.diametroCm <= r.flores[0]!.diametroCm));
}
const tallos = flores.materiales.reduce((a, m) => a + m.cantidad, 0);
assert.equal(tallos, organico.anclas.length * COLUMNA_QUINCE_AZUL.flores.tallosPorRacimo);
assert.ok(flores.materiales.every((m) => m.categoria === "follaje" && m.cotizaComoGlobo === false && m.nota === "follaje, no cotiza como globo"));
const pesoFlores = COLUMNA_QUINCE_AZUL.flores.proporcion.reduce((a, p) => a + p.peso, 0);
for (const p of COLUMNA_QUINCE_AZUL.flores.proporcion) {
  const real = (flores.materiales.find((m) => m.tipo === p.tipo && m.colorId === p.colorId)?.cantidad ?? 0) / tallos;
  assert.ok(Math.abs(real - p.peso / pesoFlores) <= 0.05, `flor ${p.tipo} ${p.colorId}: ${(real * 100).toFixed(0)} %`);
}
assert.deepEqual(repartirFlores(organico.anclas, COLUMNA_QUINCE_AZUL.flores), flores, "las flores también son deterministas");

// --- Otras formas y la regla de color por formato ----------------------------------------------------------
const semiarco = armarOrganico({
  semilla: 7,
  tramos: [formaSemiarco({ anchoCm: 120, altoCm: 200, radioBaseCm: 34, radioPuntaCm: 22 })],
  variacionInflado: 0.06,
  relleno: [{ formatoId: "R-5", infladoCm: 12, trios: true }],
  colores: [{ codigo: "009", peso: 1 }, { codigo: "005", peso: 1 }],
  suelo: true,
  huecosFlores: 4,
});
comprobarFisica(semiarco, "semiarco");
assert.ok(semiarco.conteo.total > 30, `semiarco con ${semiarco.conteo.total} globos`);
assert.ok(semiarco.medidas.altoCm >= 190 && semiarco.medidas.altoCm <= 215, `el semiarco mide ${semiarco.medidas.altoCm} cm de alto`);

// Una columna sola, de otro alto, también mide lo que se pide.
const columna180 = armarOrganico({
  semilla: 11,
  tramos: [formaColumna({ altoCm: 180, radioBaseCm: 38, radioMedioCm: 32, radioPuntaCm: 25 })],
  variacionInflado: 0.06,
  relleno: [{ formatoId: "R-5", infladoCm: 12, trios: true }],
  colores: [{ codigo: "640", peso: 3 }, { codigo: "005", peso: 1 }],
  suelo: true,
  huecosFlores: 0,
});
comprobarFisica(columna180, "columna de 1,8 m");
assert.ok(Math.abs(columna180.medidas.altoCm - 180) <= 180 * 0.06, `la columna de 1,8 m mide ${columna180.medidas.altoCm} cm`);
assert.equal(columna180.anclas.length, 0);

// Reflex Plata no se fabrica en R-36 y su familia (Reflex) tampoco tiene ese formato: en los R-36 no se usa, y se avisa.
const conR36 = armarOrganico({
  semilla: 3,
  tramos: [formaGuirnalda({ puntos: [{ x: 0, y: 60, z: 0 }, { x: 150, y: 60, z: 0 }], radioInicioCm: 50, radioFinCm: 50, mezcla: [{ t: 0, pesos: { "R-36": 1, "R-12": 2 } }] })],
  inflados: { "R-36": 70 },
  variacionInflado: 0,
  relleno: [],
  colores: [{ codigo: "981", peso: 1 }, { codigo: "640", peso: 1 }],
  suelo: true,
  huecosFlores: 0,
});
comprobarFisica(conR36, "con R-36");
assert.ok(conR36.globos.some((g) => g.formatoId === "R-36"), "hay R-36");
assert.ok(conR36.globos.filter((g) => g.formatoId === "R-36").every((g) => g.codigo === "640"), "los R-36 no llevan Reflex Plata");
assert.ok(conR36.avisos.some((a) => a.includes("981") && a.includes("R-36")), "se avisa de que Reflex Plata no viene en R-36");

const c = organico.conteo;
const porColor = Object.entries(c.porColor).map(([k, v]) => `${k}:${v}`).join(" ");
const porFormato = Object.entries(c.porFormato).map(([k, v]) => `${k}:${v}`).join(" ");
const densidades = organico.medidas.tramos.map((t) => `${t.id} ${t.globos} (${t.globosPorMetro}/m, ${t.globosPorPie}/pie)`).join("; ");
console.log(
  `OK test-organico3d: réplica XV ${c.total} globos (${porFormato}; ${porColor}; ${c.porTamano.grande} grandes, ${c.porTamano.mediano} medianos, ` +
  `${c.porTamano.relleno} de relleno), ${densidades}; columna ${altoColumna.toFixed(0)} cm, guirnalda ${largoGuirnalda} cm; ` +
  `diámetro medio base ${dBase.toFixed(1)} > punta ${dPunta.toFixed(1)} cm; peor aplastamiento ${(organico.medidas.peorAplastamiento * 100).toFixed(1)} %; ` +
  `${flores.racimos.length} racimos, ${tallos} flores; ${primeraMs.toFixed(0)}/${segundaMs.toFixed(0)} ms`,
);
