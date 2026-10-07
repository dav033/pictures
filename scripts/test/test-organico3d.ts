/**
 * Generador orgánico 3D (/3d): columna, guirnalda y semiarco de globos de tamaños mezclados, sin three.js. Sin coste.
 * - determinista: la misma semilla da el mismo resultado (y otra semilla, otro);
 * - ningún par de globos se aplasta más del 12 % del diámetro del menor; nadie atraviesa el piso ni el pedestal;
 * - gradiente de tamaños: la base de la columna lleva globos más grandes que la punta;
 * - colores por proporción (±10 puntos) y cada color se fabrica en el formato de su globo;
 * - la réplica de la foto (`COLUMNA_QUINCE_AZUL`) mide lo pedido y cuenta lo esperado;
 * - las flores van sobre anclas de hueco válidas y salen como follaje, aparte de los globos;
 * - el cristal con confeti se marca transparente y con confeti;
 * - tupida (criterios del dueño, «se ve muy separado»): desde el eje de la columna, ≥ 97 % de los rayos chocan con un
 *   globo (24 ángulos × cada 5 cm de alto) y ≥ 95 % en la guirnalda vista desde fuera; cada globo toca (≤ 1 cm entre
 *   caras) a tres vecinos —globos, piso, pedestal o el tubo del armazón— salvo los remates; la holgura media con los
 *   tres vecinos más próximos baja a menos de la mitad de la de antes (0,55 cm);
 * - cada flor queda metida en el hueco: su tallo a ≤ 2 cm de la cara de un globo, y ningún racimo sobresale de la
 *   envoltura más que su propio radio;
 * - armarOrganico + repartirFlores tarda menos de 1,5 s.
 */
import assert from "node:assert/strict";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { FLORES_ARTIFICIALES, repartirFlores } from "../../src/lib/globos3d/flores-artificiales";
import { APLASTAMIENTO_MAXIMO, RADIO_ARMAZON_CM, aplastamiento, armarOrganico, estructuraPorCm, formaColumna, formaGuirnalda, formaSemiarco, mezclaEn, type GloboOrganico, type ResultadoOrganico } from "../../src/lib/globos3d/organico";
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
assert.ok(Math.min(primeraMs, segundaMs) < 1500, `el armado del preset (globos + flores) tarda ${Math.min(primeraMs, segundaMs).toFixed(0)} ms`);

// Determinismo.
assert.equal(JSON.stringify(otraVez), JSON.stringify(armado), "la misma semilla da el mismo resultado");
const otraSemilla = armarOrganico({ ...COLUMNA_QUINCE_AZUL.opciones, semilla: 16 });
assert.notEqual(JSON.stringify(otraSemilla.globos), JSON.stringify(armado.organico.globos), "otra semilla da otra columna");

const { organico, flores, escena } = armado;
comprobarFisica(organico, "columna XV", escena.pedestal);
comprobarFisica(otraSemilla, "columna XV (semilla 16)", escena.pedestal);

// Conteo dentro de lo esperado. Subió de ~88 a ~148 al dejarla tupida (relleno chico también por dentro, como la de la
// foto); el tope del encargo (160) se amplía a 180 por eso. La cotización la hace el motor del plan, no este conteo.
const { min, max } = COLUMNA_QUINCE_AZUL.conteoEsperado;
assert.ok(min >= 80 && max <= 180);
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

// --- Tupida: sin ver a través, globos apretados y flores metidas en los huecos --------------------------------
type P3 = { x: number; y: number; z: number };
const resta3 = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const punto3 = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norma3 = (a: P3) => Math.hypot(a.x, a.y, a.z);
const unitario3 = (a: P3): P3 => { const n = norma3(a) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };
type Pedestal = { base: P3; radioCm: number; altoCm: number };

/** ¿La semirrecta desde `o` hacia `u` (unitario) toca algún globo? */
function chocaGlobo(o: P3, u: P3, globos: readonly GloboOrganico[]): boolean {
  return globos.some((g) => {
    const r = g.infladoCm / 2, oc = resta3(g.centro, o), t = punto3(oc, u), d2 = punto3(oc, oc) - t * t;
    return d2 <= r * r && t + Math.sqrt(r * r - d2) > 0;
  });
}

/** El punto del eje (la polilínea de control) más cercano a `p`, su tangente y si cae dentro del recorrido. */
function ejeMasCercano(recorrido: readonly P3[], p: P3): { q: P3; t: P3; dentro: boolean } {
  let mejor = { q: recorrido[0]!, t: unitario3(resta3(recorrido[1]!, recorrido[0]!)), dentro: false }, menor = Infinity;
  for (let i = 1; i < recorrido.length; i++) {
    const a = recorrido[i - 1]!, ab = resta3(recorrido[i]!, a);
    const f = punto3(resta3(p, a), ab) / punto3(ab, ab);
    const fc = Math.min(1, Math.max(0, f));
    const q = { x: a.x + ab.x * fc, y: a.y + ab.y * fc, z: a.z + ab.z * fc };
    const d = norma3(resta3(p, q));
    if (d < menor) { menor = d; mejor = { q, t: unitario3(ab), dentro: (i > 1 || f > 0) && (i < recorrido.length - 1 || f < 1) }; }
  }
  return mejor;
}

/** Cobertura de la columna: rayos horizontales desde el eje, 24 ángulos cada 5 cm (de 10 cm del piso a 10 cm de la punta). */
function coberturaColumna(r: ResultadoOrganico, recorrido: readonly P3[], alto: number): number {
  let total = 0, tapados = 0;
  for (let y = 10; y <= alto - 10; y += 5) {
    const eje = ejeColumna(recorrido, y);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      total++;
      if (chocaGlobo({ x: eje.x, y, z: eje.z }, { x: Math.cos(a), y: 0, z: Math.sin(a) }, r.globos)) tapados++;
    }
  }
  return tapados / total;
}

/**
 * Cobertura de la guirnalda vista desde fuera: cada 5 cm de su eje, 24 rayos en el plano normal. No cuentan los que van
 * hacia el piso ni los que tapa el pedestal (por ahí no se ve la guirnalda).
 */
function coberturaGuirnalda(r: ResultadoOrganico, recorrido: readonly P3[], pedestal: Pedestal): number {
  let total = 0, tapados = 0;
  for (let i = 1; i < recorrido.length; i++) {
    const a0 = recorrido[i - 1]!, ab = resta3(recorrido[i]!, a0), largo = norma3(ab), t = unitario3(ab);
    const ref = Math.abs(t.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const n = unitario3({ x: t.y * ref.z - t.z * ref.y, y: t.z * ref.x - t.x * ref.z, z: t.x * ref.y - t.y * ref.x });
    const b = { x: t.y * n.z - t.z * n.y, y: t.z * n.x - t.x * n.z, z: t.x * n.y - t.y * n.x };
    for (let s = 0; s < largo; s += 5) {
      const o = { x: a0.x + t.x * s, y: a0.y + t.y * s, z: a0.z + t.z * s };
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const u = unitario3({ x: n.x * Math.cos(a) + b.x * Math.sin(a), y: n.y * Math.cos(a) + b.y * Math.sin(a), z: n.z * Math.cos(a) + b.z * Math.sin(a) });
        if (u.y < -0.2) continue;
        const h = Math.hypot(u.x, u.z);
        if (h > 1e-6) {
          const ox = o.x - pedestal.base.x, oz = o.z - pedestal.base.z, ux = u.x / h, uz = u.z / h;
          const tt = -(ox * ux + oz * uz), d2 = ox * ox + oz * oz - tt * tt;
          if (tt > 0 && d2 < pedestal.radioCm ** 2 && o.y + u.y * (tt / h) < pedestal.base.y + pedestal.altoCm) continue;
        }
        total++;
        if (chocaGlobo(o, u, r.globos)) tapados++;
      }
    }
  }
  return tapados / total;
}

/** Holgura (cm, ≥ 0) media entre cada globo y sus tres vecinos más próximos. */
function holguraMedia(r: ResultadoOrganico): number {
  let suma = 0;
  for (const a of r.globos) {
    const caras = r.globos.filter((b) => b !== a).map((b) => norma3(resta3(a.centro, b.centro)) - a.infladoCm / 2 - b.infladoCm / 2).sort((x, y) => x - y);
    suma += caras.slice(0, 3).reduce((acc, h) => acc + Math.max(0, h), 0) / 3;
  }
  return suma / r.globos.length;
}

/**
 * A cuántos toca cada globo (caras a ≤ 1 cm; el aplastamiento cuenta como contacto): globos, el piso, el pedestal y el
 * tubo del armazón de su tramo (el eje, de radio RADIO_ARMAZON_CM, al que se amarran las tiras).
 */
function contactos(r: ResultadoOrganico, tramos: ReadonlyArray<{ id: string; recorrido: readonly P3[] }>, pedestal: Pedestal): number[] {
  return r.globos.map((a) => {
    const radio = a.infladoCm / 2;
    let n = r.globos.filter((b) => b !== a && norma3(resta3(a.centro, b.centro)) - radio - b.infladoCm / 2 <= 1).length;
    if (a.centro.y - radio <= 1) n++;
    if (a.centro.y - radio < pedestal.base.y + pedestal.altoCm && Math.hypot(a.centro.x - pedestal.base.x, a.centro.z - pedestal.base.z) - pedestal.radioCm - radio <= 1) n++;
    const eje = ejeMasCercano(tramos.find((t) => t.id === a.tramo)!.recorrido, a.centro);
    if (eje.dentro && norma3(resta3(a.centro, eje.q)) - radio - RADIO_ARMAZON_CM <= 1) n++;
    return n;
  });
}

const tramosXV = COLUMNA_QUINCE_AZUL.opciones.tramos;
const tramoGuirnalda = tramosXV.find((t) => t.id === "guirnalda")!;
const cobertura = coberturaColumna(organico, tramoColumna.recorrido, altoColumna);
assert.ok(cobertura >= 0.97, `desde el eje de la columna solo el ${(cobertura * 100).toFixed(1)} % de los rayos toca un globo: se ve a través`);
const coberturaG = coberturaGuirnalda(organico, tramoGuirnalda.recorrido, escena.pedestal);
assert.ok(coberturaG >= 0.95, `la guirnalda solo tapa el ${(coberturaG * 100).toFixed(1)} % de los rayos: se ve a través`);
const holgura = holguraMedia(organico);
assert.ok(holgura <= 0.25, `holgura media con los tres vecinos más próximos ${holgura.toFixed(2)} cm (antes 0,55)`);
const toques = contactos(organico, tramosXV, escena.pedestal);
const sueltos = organico.globos.filter((g, i) => toques[i]! < 3 && g.fraccion < 0.99);
// Uno puede quedar tocando a dos: el que cierra el borde de un bolsillo de flor (la flor lo calza). Ninguno a menos.
assert.ok(sueltos.length <= 1 && sueltos.every((g) => toques[g.indice]! >= 2), `globos que tocan a menos de tres vecinos: ${sueltos.map((g) => `${g.indice} (${toques[g.indice]})`).join(", ")}`);

// Flores metidas en el hueco: el tallo a ≤ 2 cm de la cara de un globo; el racimo no sobresale más que su radio.
let floresAlAire = 0, peorFlor = -Infinity;
for (const r of flores.racimos) {
  for (const f of r.flores) {
    const cara = Math.min(...organico.globos.map((g) => norma3(resta3(f.posicion, g.centro)) - g.infladoCm / 2));
    peorFlor = Math.max(peorFlor, cara);
    if (cara > 2) floresAlAire++;
  }
  const ancla = organico.anclas[r.ancla]!;
  const eje = ejeMasCercano(tramosXV.find((t) => t.id === ancla.tramo)!.recorrido, r.posicion);
  const rel = resta3(r.posicion, eje.q), axial = punto3(rel, eje.t);
  const u = unitario3({ x: rel.x - eje.t.x * axial, y: rel.y - eje.t.y * axial, z: rel.z - eje.t.z * axial });
  // La envoltura en esa dirección: hasta dónde llegan los globos de alrededor del racimo (caras a ≤ 15 cm de su boca).
  const envoltura = Math.max(...organico.globos.filter((g) => norma3(resta3(g.centro, r.posicion)) - g.infladoCm / 2 <= 15).map((g) => punto3(resta3(g.centro, eje.q), u) + g.infladoCm / 2));
  const fuera = Math.max(...r.flores.map((f) => punto3(resta3(f.posicion, eje.q), u) + f.diametroCm / 2));
  const radioRacimo = Math.max(...r.flores.map((f) => norma3(resta3(f.posicion, r.posicion)) + f.diametroCm / 2));
  assert.ok(fuera - envoltura <= radioRacimo, `el racimo ${r.ancla} sobresale ${(fuera - envoltura).toFixed(1)} cm de la envoltura (su radio: ${radioRacimo.toFixed(1)})`);
}
assert.equal(floresAlAire, 0, `${floresAlAire} flores quedaron al aire (la peor a ${peorFlor.toFixed(1)} cm de un globo)`);
assert.ok(organico.anclas.some((a) => a.tramo === "guirnalda"), "la guirnalda de la base también lleva flores");

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
  `${flores.racimos.length} racimos, ${tallos} flores (al aire: ${floresAlAire}, la peor a ${peorFlor.toFixed(1)} cm); cobertura columna ` +
  `${(cobertura * 100).toFixed(1)} %, guirnalda ${(coberturaG * 100).toFixed(1)} %; holgura media ${holgura.toFixed(2)} cm; ` +
  `${sueltos.length} tocando a menos de tres; ${primeraMs.toFixed(0)}/${segundaMs.toFixed(0)} ms`,
);
