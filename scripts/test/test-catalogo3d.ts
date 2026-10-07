/**
 * Catálogo de decoraciones digitalizadas del taller 3D (`CATALOGO_DECORACIONES`, fotos del banco de estructuras de
 * Sempertex). Sin coste: no llama a ningún servicio.
 * - ids únicos, fotoId con la forma del banco («e02-p040-001») y fuente coherente con él (edición y página);
 * - cada entrada arma con `armarPieza` y trae globos;
 * - cada color existe en su formato (`coloresDelFormato`), globos y tubitos;
 * - la caja que ocupa cuadra con las medidas declaradas en la pieza (±10 %): una columna de 1,8 m mide 1,8 m;
 * - lo contado en la foto se conserva (cuartetos por columna);
 * - si `BANCO_FOTOS_CATALOGO` apunta al catalogo.json del banco, cada fotoId existe ahí (el banco no vive en el repo).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CATALOGO_DECORACIONES } from "../../src/lib/globos3d/catalogo-fotos";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { RADIO_TRENZA_POR_DIAMETRO } from "../../src/lib/globos3d/trenza";

const TOLERANCIA = 0.1;
const cerca = (medido: number, esperado: number, que: string) =>
  assert.ok(Math.abs(medido - esperado) <= esperado * TOLERANCIA, `${que}: mide ${medido.toFixed(0)} cm, se declaró ${esperado.toFixed(0)} cm (±10 %)`);

/** Comprueba la caja contra las medidas que trae la pieza. */
function medidasRazonables(id: string, pieza: Pieza, armada: PiezaArmada): void {
  const { min, max } = armada.caja;
  const ancho = max.x - min.x, alto = max.y - min.y;
  switch (pieza.tipo) {
    case "columna":
      cerca(alto, pieza.alturaCm, `${id}: alto de la columna`);
      return;
    case "arco": {
      // Ancho y alto son los del eje de la trenza: por fuera suma el cuarteto (0,62 d + medio globo) a cada lado.
      const borde = pieza.infladoCm * (RADIO_TRENZA_POR_DIAMETRO + 0.5);
      cerca(ancho, pieza.anchoCm + 2 * borde, `${id}: ancho del arco por fuera`);
      cerca(max.y, pieza.altoCm + borde, `${id}: alto del arco por fuera`);
      return;
    }
    case "pared_malla":
      cerca(ancho, pieza.anchoCm, `${id}: ancho de la pared`);
      cerca(alto, pieza.altoCm, `${id}: alto de la pared`);
      return;
    case "pared_trenzas":
      cerca(ancho, pieza.opciones.anchoCm, `${id}: ancho de la pared de trenzas`);
      cerca(alto, pieza.opciones.altoCm, `${id}: alto de la pared de trenzas`);
      return;
    case "decoracion": {
      const mayor = Math.max(ancho, alto, max.z - min.z);
      assert.ok(mayor > 5 && mayor < 100, `${id}: una decoración suelta mide entre 5 cm y 1 m (mide ${mayor.toFixed(0)} cm)`);
      return;
    }
    default: {
      const mayor = Math.max(ancho, alto, max.z - min.z);
      assert.ok(mayor > 5 && mayor < 1000, `${id}: medida razonable (${mayor.toFixed(0)} cm)`);
    }
  }
}

assert.ok(CATALOGO_DECORACIONES.length >= 10, `el catálogo trae ${CATALOGO_DECORACIONES.length} decoraciones`);

const ids = new Set<string>();
for (const d of CATALOGO_DECORACIONES) {
  assert.ok(!ids.has(d.id), `id repetido: ${d.id}`);
  ids.add(d.id);
  assert.ok(d.nombre.trim().length > 0 && d.descripcion.trim().length > 20, `${d.id}: nombre y descripción`);

  // El fotoId del banco dice la fuente: «e02-p040-001» es Celebra ed. 2, p. 40.
  const foto = /^e(\d{2})-p(\d{3})-\d{3}$/.exec(d.fotoId);
  assert.ok(foto, `${d.id}: fotoId con la forma del banco (${d.fotoId})`);
  const edicion = Number(foto[1]), pagina = Number(foto[2]);
  assert.match(d.fuente, new RegExp(`^Celebra ed\\. ${edicion} \\(\\d{4}\\), p\\. ${pagina}$`), `${d.id}: la fuente cuadra con ${d.fotoId}`);

  const armada = armarPieza(d.pieza);
  assert.ok(armada.globos.length > 0, `${d.id}: arma globos`);
  for (const m of armada.materiales) {
    const fabricados = coloresDelFormato(m.formatoId).map((r) => r.codigo);
    assert.ok(fabricados.includes(m.codigo), `${d.id}: el color ${m.codigo} no se fabrica en ${m.formatoId}`);
  }
  medidasRazonables(d.id, d.pieza, armada);
}

// Lo contado en la foto: cuartetos (× 4 globos) de cada columna.
const contados: Record<string, number> = {
  columna_bloques_pirata: 8,
  columna_franjas_alternando_tamanos: 13,
  columna_espiral_roja_azul: 9,
  columna_espiral_azul_dorada: 23,
  base_cuartetos_satin_rosado: 4,
};
for (const [id, cuartetos] of Object.entries(contados)) {
  const d = CATALOGO_DECORACIONES.find((x) => x.id === id);
  assert.ok(d, `falta ${id}`);
  assert.equal(armarPieza(d.pieza).globos.length, cuartetos * 4, `${id}: ${cuartetos} cuartetos como en la foto`);
}
// La malla flor de Celebra ed. 2, p. 40: franjas diagonales que bajan hacia la derecha (Violeta arriba a la izquierda).
const malla = CATALOGO_DECORACIONES.find((x) => x.id === "malla_flor_diagonales");
assert.ok(malla && malla.pieza.tipo === "pared_malla" && malla.pieza.patron === "franjas");

// El banco de fotos no vive en el repo: si se indica dónde está, cada fotoId tiene que existir ahí.
const banco = process.env.BANCO_FOTOS_CATALOGO;
if (banco && existsSync(banco)) {
  const fotos = new Set((JSON.parse(readFileSync(banco, "utf8")) as Array<{ id: string }>).map((f) => f.id));
  for (const d of CATALOGO_DECORACIONES) assert.ok(fotos.has(d.fotoId), `${d.id}: la foto ${d.fotoId} no está en el banco`);
  console.log(`fotoIds comprobados contra el banco (${fotos.size} fotos)`);
} else {
  console.log("BANCO_FOTOS_CATALOGO no indicado: no se comprobó que cada fotoId exista en el banco");
}

console.log(`test-catalogo3d: ${CATALOGO_DECORACIONES.length} decoraciones digitalizadas OK`);
