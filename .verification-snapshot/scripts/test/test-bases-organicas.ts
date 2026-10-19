/**
 * Bases orgánicas de referencias web (`bases-organicas.ts`): ~10 arcos y ~10 columnas de fotos de decoradores y
 * fabricantes, digitalizados con los parámetros del generador. Sin coste: no llama a ninguna API (solo el motor).
 *
 * Lo que vigila, base por base:
 * - **arma sin avisos** (el único que se tolera es el informativo «no cupieron sin montarse: sus huecos los tapa el
 *   relleno», y con tope) y sin aplastar más de lo permitido;
 * - **compacta**: desde el eje de cada tramo, rayos hacia fuera cada 5 cm; casi todos tocan un globo (no se ve a través
 *   ni quedan huecos grandes entre racimos), y a lo largo del eje no hay ningún tramo de más de 15 cm sin globos;
 * - **medidas**: lo más alto de los globos es el alto declarado (±10 %; si solo cubre un lado del marco, no se pasa) y
 *   no se pasa del ancho declarado;
 * - **colores válidos por formato**: cada globo de la lista de compra se fabrica en su formato;
 * - **productos**: `productosDe` da la lista con cantidades;
 * - **editable**: cambiar el alto y los colores vuelve a armar bien (más alto; solo los colores nuevos);
 * - en la **biblioteca**: con fuente «referencia web» (sitio y enlace https), como estructura o conjunto, y el texto
 *   «bases orgánicas» las encuentra todas.
 *
 * Run: npx tsx scripts/test/test-bases-organicas.ts
 */
import assert from "node:assert/strict";
import { BASES_ORGANICAS, conjuntoDeBase, piezaDeBase, type BaseOrganica } from "@/lib/globos3d/bases-organicas";
import { BIBLIOTECA_FABRICA, filtrarBiblioteca, productosDe } from "@/lib/globos3d/biblioteca";
import { armarOrganico, APLASTAMIENTO_MAXIMO, type GloboOrganico, type OpcionesOrganico } from "@/lib/globos3d/organico";
import { opcionesArcoOrganico } from "@/lib/globos3d/formas-escena";
import { armarPieza, type Pieza } from "@/lib/globos3d/piezas";
import { coloresDelFormato } from "@/lib/globos3d/formatos";
import type { Vec3 } from "@/lib/globos3d/modulos";

const resta = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const punto = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norma = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unitario = (a: Vec3): Vec3 => { const n = norma(a) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };

function chocaGlobo(o: Vec3, u: Vec3, globos: readonly GloboOrganico[]): boolean {
  return globos.some((g) => {
    const r = g.infladoCm / 2, oc = resta(g.centro, o), t = punto(oc, u), d2 = punto(oc, oc) - t * t;
    return d2 <= r * r && t + Math.sqrt(r * r - d2) > 0;
  });
}

/**
 * Por tramo: la fracción de rayos (24 cada 5 cm del eje, en el plano normal) que toca un globo, y el mayor trecho del eje
 * sin ningún globo a menos de su radio de envoltura. No cuentan los rayos hacia el piso cerca de él (por ahí no se ve).
 */
function compacidad(op: OpcionesOrganico, globos: readonly GloboOrganico[]): Array<{ id: string; cobertura: number; trechoSinGlobosCm: number }> {
  return op.tramos.map((tr) => {
    let total = 0, tapados = 0, trecho = 0, peor = 0;
    const radio = Math.max(...tr.grosor.map((g) => g.radioCm));
    for (let i = 1; i < tr.recorrido.length; i++) {
      const a0 = tr.recorrido[i - 1]!, ab = resta(tr.recorrido[i]!, a0), largo = norma(ab), t = unitario(ab);
      const ref = Math.abs(t.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const n = unitario({ x: t.y * ref.z - t.z * ref.y, y: t.z * ref.x - t.x * ref.z, z: t.x * ref.y - t.y * ref.x });
      const b = { x: t.y * n.z - t.z * n.y, y: t.z * n.x - t.x * n.z, z: t.x * n.y - t.y * n.x };
      for (let s = 0; s < largo; s += 5) {
        const o = { x: a0.x + t.x * s, y: a0.y + t.y * s, z: a0.z + t.z * s };
        const cerca = globos.some((g) => norma(resta(g.centro, o)) - g.infladoCm / 2 <= radio);
        trecho = cerca ? 0 : trecho + 5;
        peor = Math.max(peor, trecho);
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2;
          const u = unitario({ x: n.x * Math.cos(ang) + b.x * Math.sin(ang), y: n.y * Math.cos(ang) + b.y * Math.sin(ang), z: n.z * Math.cos(ang) + b.z * Math.sin(ang) });
          if (u.y < -0.2 && o.y < 70) continue;
          total++;
          if (chocaGlobo(o, u, globos)) tapados++;
        }
      }
    }
    return { id: tr.id, cobertura: tapados / Math.max(1, total), trechoSinGlobosCm: peor };
  });
}

/** Las opciones del motor de una pieza orgánica (`organico` o `arco_organico`). */
function opcionesDe(p: Pieza): OpcionesOrganico {
  if (p.tipo === "organico") return p.opciones;
  if (p.tipo === "arco_organico") return opcionesArcoOrganico(p.arco);
  throw new Error(`no es orgánica: ${p.tipo}`);
}

/** Alto y ancho declarados de la base (por fuera). */
function medidasDeclaradas(b: BaseOrganica): { altoCm: number; anchoCm: number } {
  const f = b.forma;
  if (f.generador === "columna") {
    const c = f.columna;
    const ancho = Math.max(c.grosorBaseCm, c.monticulo?.anchoCm ?? 0) + (c.par?.separacionCm ?? 0) + 2 * Math.abs(Math.tan(((c.inclinacionGrados ?? 0) * Math.PI) / 180) * c.altoCm) + 2 * (c.serpenteoCm ?? 0) + (c.espiral ? c.espiral.grosorCm * 1.4 : 0);
    return { altoCm: c.altoCm, anchoCm: ancho };
  }
  if (f.generador === "arco") return { altoCm: f.arco.altoCm, anchoCm: f.arco.anchoCm };
  return { altoCm: f.arco.altoCm, anchoCm: f.arco.anchoCm + 2 * f.arco.radioBaseCm };
}

/** Si la pieza llega a lo más alto de su marco (una guirnalda que solo cubre un lado del aro no llega). */
function cubreArriba(b: BaseOrganica): boolean {
  if (b.forma.generador !== "arco") return true;
  const { marco, segmentos } = b.forma.arco;
  const [lo, hi] = marco.forma === "rectangulo" ? [0.3, 0.45] : [0.5, 0.5];
  return segmentos.some((s) => Math.min(s.desde, s.hasta) <= hi && Math.max(s.desde, s.hasta) >= lo);
}

const AVISO_INFORMATIVO = /no cupieron sin montarse: sus huecos los tapa el relleno/;

assert.ok(BASES_ORGANICAS.length >= 18, `al menos 18 bases (hay ${BASES_ORGANICAS.length})`);
assert.ok(BASES_ORGANICAS.filter((b) => b.tipo === "arco").length >= 9 && BASES_ORGANICAS.filter((b) => b.tipo === "columna").length >= 9, "unos 10 arcos y unas 10 columnas");
assert.equal(new Set(BASES_ORGANICAS.map((b) => b.id)).size, BASES_ORGANICAS.length, "ids sin repetir");
assert.equal(new Set(BASES_ORGANICAS.map((b) => b.nombre)).size, BASES_ORGANICAS.length, "nombres sin repetir");
assert.equal(new Set(BASES_ORGANICAS.map((b) => b.fuente.urlImagen)).size, BASES_ORGANICAS.length, "una foto de origen por base");

const t0 = Date.now();
for (const b of BASES_ORGANICAS) {
  const que = `${b.id} (${b.nombre})`;
  assert.ok(b.id.startsWith("base-organica:"), `${que}: id`);
  assert.ok(/^https:\/\//.test(b.fuente.urlPagina) && (!b.fuente.urlImagen || /^https:\/\//.test(b.fuente.urlImagen)), `${que}: urls https públicas`);
  assert.ok(b.fuente.sitio.trim() && b.nota.length > 60 && b.ocasiones.length > 0, `${que}: sitio, nota y ocasiones`);
  const pieza = piezaDeBase(b);
  const opciones = opcionesDe(pieza);
  const r = armarOrganico(opciones);
  const otros = r.avisos.filter((a) => !AVISO_INFORMATIVO.test(a));
  assert.deepEqual(otros, [], `${que}: arma sin avisos`);
  const sinCupo = Number(r.avisos.find((a) => AVISO_INFORMATIVO.test(a))?.match(/^(\d+)/)?.[1] ?? 0);
  const estructura = r.conteo.porTamano.grande + r.conteo.porTamano.mediano;
  assert.ok(sinCupo <= Math.max(6, estructura * 0.25), `${que}: ${sinCupo} de estructura sin sitio (de ${estructura})`);
  assert.ok(r.medidas.peorAplastamiento <= APLASTAMIENTO_MAXIMO + 1e-9, `${que}: aplastamiento ${r.medidas.peorAplastamiento}`);

  // Compacta: casi todos los rayos tapados y sin trechos vacíos en el eje.
  for (const c of compacidad(opciones, r.globos)) {
    assert.ok(c.cobertura >= 0.9, `${que}: el tramo ${c.id} solo tapa el ${(c.cobertura * 100).toFixed(1)} % (se ve a través)`);
    assert.ok(c.trechoSinGlobosCm <= 15, `${que}: el tramo ${c.id} tiene ${c.trechoSinGlobosCm} cm de eje sin globos`);
  }

  // Medidas: dentro de su alto y ancho.
  const armada = armarPieza(pieza);
  // El alto es hasta lo más alto de los globos (una guirnalda sobre marco no tiene por qué tocar el piso).
  const alto = armada.caja.max.y, ancho = armada.caja.max.x - armada.caja.min.x;
  const declarado = medidasDeclaradas(b);
  assert.ok(alto <= declarado.altoCm * 1.1 && (!cubreArriba(b) || alto >= declarado.altoCm * 0.9), `${que}: alto ${alto.toFixed(0)} y se declaró ${declarado.altoCm}`);
  assert.ok(ancho <= declarado.anchoCm * 1.1 + 10, `${que}: ancho ${ancho.toFixed(0)} y se declaró ${declarado.anchoCm.toFixed(0)}`);
  assert.ok(armada.caja.min.y >= -1, `${que}: no atraviesa el piso`);

  // Colores válidos por formato.
  for (const m of armada.materiales) assert.ok(coloresDelFormato(m.formatoId).some((c) => c.codigo === m.codigo), `${que}: ${m.codigo} no se fabrica en ${m.formatoId}`);

  // Productos con cantidades.
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === b.id);
  assert.ok(item, `${que}: está en la biblioteca`);
  assert.equal(item.fuente?.tipo, "referencia-web", `${que}: fuente referencia web`);
  assert.equal(item.fuente?.url, b.fuente.urlPagina, `${que}: enlace a la página de origen`);
  assert.equal(item.tipo, conjuntoDeBase(b) ? "conjunto" : "estructura", `${que}: estructura o conjunto`);
  const productos = productosDe(item);
  assert.ok(productos.globos.length > 0 && productos.globos.every((g) => g.cantidad > 0), `${que}: productos con cantidad`);
  assert.equal(productos.totalGlobos, productos.globos.reduce((s, g) => s + g.cantidad, 0), `${que}: total de globos`);
  assert.ok(productos.totalGlobos >= armada.materiales.reduce((s, m) => s + m.cantidad, 0), `${que}: la lista cuenta la estructura`);

  // Editable: más alta y con otros colores, vuelve a armar bien.
  const masAlta = armarPieza(piezaDeBase(b, { altoCm: Math.round(declarado.altoCm * 1.15) }));
  const altoNuevo = masAlta.caja.max.y;
  assert.ok(altoNuevo > alto + declarado.altoCm * 0.07, `${que}: al subir el alto un 15 % pasa de ${alto.toFixed(0)} a ${altoNuevo.toFixed(0)}`);
  const nuevos = [{ codigo: "040", peso: 2 }, { codigo: "005", peso: 1 }];
  const recoloreada = piezaDeBase(b, { colores: nuevos });
  const rr = armarOrganico(opcionesDe(recoloreada));
  assert.deepEqual(rr.avisos.filter((a) => !AVISO_INFORMATIVO.test(a)), [], `${que}: recoloreada sin avisos`);
  assert.deepEqual([...new Set(rr.materiales.map((m) => m.codigo))].sort(), ["005", "040"], `${que}: solo los colores nuevos`);
  console.log(`  ${b.id}: ${r.globos.length} globos, ${alto.toFixed(0)}×${ancho.toFixed(0)} cm, cobertura mín ${(Math.min(...compacidad(opciones, r.globos).map((c) => c.cobertura)) * 100).toFixed(1)} %`);
}

// La biblioteca las encuentra por «bases orgánicas».
const encontradas = filtrarBiblioteca(BIBLIOTECA_FABRICA, new Map(), { texto: "bases orgánicas" });
assert.deepEqual(encontradas.map((i) => i.id).sort(), BASES_ORGANICAS.map((b) => b.id).sort(), "el texto «bases orgánicas» las encuentra todas y solo ellas");
assert.ok(filtrarBiblioteca(BIBLIOTECA_FABRICA, new Map(), { texto: "bases organicas columna" }).length >= 9, "y se pueden afinar (columnas)");

console.log(`OK test-bases-organicas: ${BASES_ORGANICAS.length} bases (${BASES_ORGANICAS.filter((b) => b.tipo === "arco").length} arcos, ${BASES_ORGANICAS.filter((b) => b.tipo === "columna").length} columnas, ${BASES_ORGANICAS.filter((b) => conjuntoDeBase(b)).length} con decoraciones) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
