/**
 * Decoraciones pequeñas en la escena (pestaña Escena del taller 3D). Sin coste: no llama a ninguna IA.
 * - las 14 predefinidas quedan en sus grupos (Flores, Flores de tubito, Moños, Estrellas, Corazones, Racimos), una vez;
 * - la miniatura de cada una tiene una forma por globo y por tubito, con su color oficial (`hexGlobo`), ordenadas
 *   por profundidad y dentro de su caja; las que llevan globos tienen círculos/elipses;
 * - el reparto sugerido en una columna da unas pocas copias, todas en anclas de frente;
 * - `agregarDecoracion` la cuelga de un nodo con anclas (repetida) y la pone en la pared, el piso y el techo; los
 *   materiales de la escena suben exactamente lo de la decoración × sus copias;
 * - en la pared queda pegada y de frente al salón; en el piso apoyada; del techo colgada bajo el techo.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena, type EscenaArmada } from "../../src/lib/globos3d/escena";
import { piezaNueva } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, decoracionPredefinida, type MaterialDecoracion } from "../../src/lib/globos3d/figuras";
import {
  ALTURA_EN_PARED_CM, CUELGA_DEL_TECHO_CM, GRUPOS_DECORACION, agregarDecoracion, decoracionesPorGrupo, globosDe, grupoDe, miniaturaDecoracion, repartoSugerido,
} from "../../src/lib/globos3d/decoraciones-escena";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";

const cerca = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;
const porClave = (m: readonly MaterialDecoracion[]) => {
  const salida = new Map<string, number>();
  for (const x of m) salida.set(`${x.formatoId}|${x.codigo}`, (salida.get(`${x.formatoId}|${x.codigo}`) ?? 0) + x.cantidad);
  return salida;
};
/** Lo que subieron los materiales de `antes` a `despues` es exactamente `decoracion` × `copias`. */
function subieronExacto(antes: EscenaArmada, despues: EscenaArmada, decoracion: readonly MaterialDecoracion[], copias: number, contexto: string) {
  const a = porClave(antes.materiales), d = porClave(despues.materiales), esperado = porClave(decoracion);
  for (const clave of new Set([...a.keys(), ...d.keys(), ...esperado.keys()])) {
    assert.equal((d.get(clave) ?? 0) - (a.get(clave) ?? 0), (esperado.get(clave) ?? 0) * copias, `${contexto}: ${clave} sube lo de la decoración × ${copias}`);
  }
}

// 1. Grupos.
const grupos = decoracionesPorGrupo();
const ids = grupos.flatMap((g) => g.decoraciones.map((d) => d.id));
assert.equal(ids.length, DECORACIONES_PREDEFINIDAS.length, "todas las predefinidas están en algún grupo");
assert.equal(new Set(ids).size, ids.length, "ninguna está dos veces");
assert.deepEqual(grupos.map((g) => g.id), GRUPOS_DECORACION.map((g) => g.id).filter((id) => grupos.some((g) => g.id === id)), "los grupos van en su orden");
assert.ok(grupos.length >= 6, `hay flores, de tubito, moños, estrellas, corazones y racimos (${grupos.map((g) => g.nombre).join(", ")})`);
assert.equal(grupoDe({ id: "racimo_dorado", decoracion: decoracionPredefinida("racimo_dorado") }), "racimos");
assert.equal(grupoDe({ id: "flor5", decoracion: decoracionPredefinida("flor5") }), "flores");
for (const g of grupos) for (const d of g.decoraciones) {
  assert.equal(d.globos, globosDe(armarDecoracion(d.decoracion).materiales), `${d.id}: cuenta sus globos`);
  assert.ok(d.globos > 0 || d.noEsGlobo, `${d.id}: lleva globos (o es papel: fantasma, telaraña)`);
  assert.equal(d.noEsGlobo, d.globos === 0, `${d.id}: «no es globo» solo si no lleva ninguno`);
}

// 2. Miniaturas.
for (const p of DECORACIONES_PREDEFINIDAS) {
  const armada = armarDecoracion(p.decoracion);
  const mini = miniaturaDecoracion(p.decoracion);
  const globos = mini.formas.filter((f) => f.tipo === "globo"), tubitos = mini.formas.filter((f) => f.tipo === "tubito");
  assert.equal(globos.length, armada.globos.length, `${p.id}: un círculo por globo`);
  assert.equal(tubitos.length, armada.tubos.length, `${p.id}: un trazo por tubito`);
  assert.ok(mini.formas.length > 0, `${p.id}: la miniatura dibuja algo`);
  if (armada.globos.length) assert.ok(globos.every((f) => f.rx > 0 && f.ry > 0 && f.rx >= f.ry - 1e-9), `${p.id}: círculos/elipses con radio`);
  for (const f of mini.formas) {
    // El papel (fantasma, telaraña) no es globo: va en su propio color.
    if (f.tipo === "tubito" && f.papel) { assert.match(f.hex, /^#[0-9a-f]{6}$/i); continue; }
    const ref = referenciaPorCodigo(f.codigo);
    assert.ok(ref, `${p.id}: el código ${f.codigo} es oficial`);
    assert.equal(f.hex, ref.hexGlobo, `${p.id}: ${f.codigo} con su hexGlobo`);
    assert.match(f.hex, /^#[0-9a-f]{6}$/i);
  }
  for (let i = 1; i < mini.formas.length; i++) assert.ok(mini.formas[i]!.profundidad >= mini.formas[i - 1]!.profundidad, `${p.id}: de lo lejano a lo cercano`);
  const { x, y, ancho, alto } = mini.caja;
  assert.ok(ancho > 0 && cerca(ancho, alto, 0.02), `${p.id}: caja cuadrada`);
  for (const f of mini.formas) {
    const puntos = f.tipo === "globo" ? [[f.cx, f.cy]] : f.puntos;
    for (const [px, py] of puntos) assert.ok(px! >= x && px! <= x + ancho && py! >= y && py! <= y + alto, `${p.id}: todo dentro de la caja`);
  }
}
// De frente: el centro de la flor (lo más cercano) se pinta al final y queda en el medio.
const flor5 = miniaturaDecoracion(decoracionPredefinida("flor5"));
const ultimo = flor5.formas[flor5.formas.length - 1]!;
assert.ok(ultimo.tipo === "globo" && ultimo.codigo === "570" && Math.hypot(ultimo.cx, ultimo.cy) < 3, "el centro dorado de la flor de 5 va encima y al medio");
// La estrella apunta hacia arriba en el dibujo (y negativa en SVG).
const estrella = miniaturaDecoracion(decoracionPredefinida("estrella_dorada"));
const masAlto = Math.min(...estrella.formas.flatMap((f) => (f.tipo === "tubito" ? f.puntos.map((q) => q[1]) : [f.cy])));
const masBajo = Math.max(...estrella.formas.flatMap((f) => (f.tipo === "tubito" ? f.puntos.map((q) => q[1]) : [f.cy])));
assert.ok(-masAlto > masBajo, "la primera punta de la estrella queda arriba");

// 3. Colgada de una columna.
const sala = SALA_INICIAL;
const columna = piezaNueva("columna").pieza;
const base: Escena = { sala, nodos: [{ id: "columna", nombre: "Columna", pieza: columna, colocacion: { en: "piso", xCm: -150, zCm: 0, giroGrados: 0 } }] };
const armadaBase = armarEscena(base);
const anclas = armadaBase.porNodo[0]!.anclas;
assert.ok(anclas.length > 10, `la columna tiene anclas (${anclas.length})`);
const reparto = repartoSugerido(anclas);
assert.ok(reparto.cada > 0 && reparto.copias >= 2 && reparto.copias <= 8, `reparto con unas pocas copias (${JSON.stringify(reparto)})`);
for (let i = reparto.ancla; i < anclas.length; i += reparto.cada) assert.ok(anclas[i]!.normal.z > 0.5, `ancla ${i}: mira al frente`);
assert.deepEqual(repartoSugerido([]), { ancla: 0, cada: 0, copias: 0 });
assert.equal(repartoSugerido(anclas, 0).copias, 1, "cada = 0 es una sola");
assert.equal(repartoSugerido(anclas, 3).cada, 3, "respeta el cada pedido");
const flor = decoracionPredefinida("flor5");
const materialesFlor = armarDecoracion(flor).materiales;
const colgada = agregarDecoracion(base, flor, { en: "ancla", padreId: "columna", cada: reparto.cada, ancla: reparto.ancla }, { nombre: "Flor de 5 pétalos", idBase: "flor5" });
assert.equal(base.nodos.length, 1, "la escena de entrada no cambia");
assert.equal(colgada.id, "flor5");
const armadaColgada = armarEscena(colgada.escena);
assert.deepEqual(armadaColgada.avisos, [], "colgada sin avisos");
const nodoColgado = armadaColgada.porNodo.find((n) => n.id === colgada.id)!;
assert.equal(nodoColgado.copias, reparto.copias, "tantas copias como dijo el reparto");
assert.equal(nodoColgado.globos.length, armarDecoracion(flor).globos.length * reparto.copias);
subieronExacto(armadaBase, armadaColgada, materialesFlor, reparto.copias, "colgada");
assert.throws(() => agregarDecoracion(base, flor, { en: "ancla", padreId: "no-existe", cada: 2 }), /no-existe/);

// 4. En la pared del fondo: pegada a la pared, de frente al salón, a la vista.
const moño = decoracionPredefinida("mono_fucsia");
const enPared = agregarDecoracion(colgada.escena, flor, { en: "pared" }, { nombre: "Flor", idBase: "flor5" });
assert.equal(enPared.id, "flor5-2", "id nuevo sin chocar");
const nodoPared = enPared.escena.nodos.find((n) => n.id === enPared.id)!;
assert.ok(nodoPared.pieza.tipo === "decoracion" && nodoPared.pieza.deFrente === true, "en la pared va de frente");
const armadaPared = armarEscena(enPared.escena);
const hechoPared = armadaPared.porNodo.find((n) => n.id === enPared.id)!;
assert.ok(cerca(hechoPared.caja.min.z, -sala.fondoCm / 2), `pegada a la pared del fondo (${hechoPared.caja.min.z.toFixed(1)})`);
assert.ok(cerca(hechoPared.caja.min.y, ALTURA_EN_PARED_CM), "a la vista");
const centroPared = hechoPared.globos.find((g) => g.codigo === "570")!;
assert.ok(centroPared.direccion.z > 0.9, "su centro mira al salón (+z)");
subieronExacto(armadaColgada, armadaPared, materialesFlor, 1, "pared");
const segunda = agregarDecoracion(enPared.escena, moño, { en: "pared" });
const c1 = nodoPared.colocacion, c2 = segunda.escena.nodos.find((n) => n.id === segunda.id)!.colocacion;
assert.ok(c1.en === "pared" && c2.en === "pared" && Math.abs(c1.aLoLargoCm - c2.aLoLargoCm) >= 60, "la segunda en la pared se corre a un lado");
// El giro de frente no cambia los materiales.
assert.deepEqual(armarPieza({ tipo: "decoracion", decoracion: moño, deFrente: true }).materiales, armarPieza({ tipo: "decoracion", decoracion: moño }).materiales);

// 5. En el piso y del techo.
const enPiso = agregarDecoracion(base, moño, { en: "piso" });
const armadaPiso = armarEscena(enPiso.escena);
const hechoPiso = armadaPiso.porNodo.find((n) => n.id === enPiso.id)!;
assert.ok(cerca(hechoPiso.caja.min.y, 0), "en el piso queda apoyada");
subieronExacto(armadaBase, armadaPiso, armarDecoracion(moño).materiales, 1, "piso");
const corazones = decoracionPredefinida("flor_corazones");
const delTecho = agregarDecoracion(base, corazones, { en: "techo" });
const armadaTecho = armarEscena(delTecho.escena);
const hechoTecho = armadaTecho.porNodo.find((n) => n.id === delTecho.id)!;
assert.ok(cerca(hechoTecho.caja.max.y, sala.altoCm - CUELGA_DEL_TECHO_CM), "del techo, colgada a su altura");
assert.ok(armadaTecho.cilindros.some((c) => c.nodo === delTecho.id), "con su hilo hasta el techo");
subieronExacto(armadaBase, armadaTecho, armarDecoracion(corazones).materiales, 1, "techo");

console.log(`OK decoraciones en la escena: ${grupos.length} grupos, ${ids.length} predefinidas con miniatura; colgada ×${reparto.copias} (cada ${reparto.cada}), pared, piso y techo.`);

// Orientación según el sitio: una decoración guardada sin `deFrente` que va en una pared se arma de frente igual.
{
  const flor = DECORACIONES_PREDEFINIDAS[0]!.decoracion;
  const enPared: Escena = { sala: SALA_INICIAL, nodos: [{ id: "f", nombre: "Flor", pieza: { tipo: "decoracion", decoracion: flor }, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 150 } }] };
  const conBandera: Escena = { ...enPared, nodos: [{ ...enPared.nodos[0]!, pieza: { tipo: "decoracion", decoracion: flor, deFrente: true } }] };
  assert.deepEqual(armarEscena(enPared).globos, armarEscena(conBandera).globos, "en la pared, de frente aunque no traiga la bandera");
  console.log("OK test-decoraciones-escena: la decoración en una pared siempre va de frente");
}
