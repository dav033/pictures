/**
 * Fixtures doradas del motor 3D de la vista guiada (REQ-007, fase 1). Sin coste: no llama a ninguna IA.
 * Una por cada una de las 28 ideas guardadas y por cada una de las 18 estructuras oficiales
 * (`contracts/domain/v1/golden/motor-guiada/`): las cantidades por (formato, código) por pieza y en total, el hash de
 * la espec, lo que no se pudo representar y la caja de cada pieza ± 5 cm.
 *
 * Si falla porque el motor cambió a propósito: sube `VERSION_MOTOR` (src/lib/globos3d/motor/v1.ts) y regenera con
 *   npx tsx --conditions=react-server scripts/motor/generar-golden-motor-guiada.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DIRECTORIO_DORADO, registroDe, todosLosCasos, type RegistroDorado } from "../lib/casos-motor-guiada";
import { formatosOrganicosDe } from "../../src/lib/globos3d/herramientas-escena-colores";
import { armarDesdeEspec, VERSION_MOTOR, type PiezaEspec } from "../../src/lib/globos3d/motor/v1";

const TOLERANCIA_CAJA_CM = 5;
const casos = todosLosCasos();
assert.equal(casos.length, 28 + 18, "28 ideas guardadas y 18 estructuras oficiales");

const esperados = new Set(casos.map((c) => `${c.id}.json`));
const sobrantes = readdirSync(DIRECTORIO_DORADO).filter((f) => f.endsWith(".json") && !esperados.has(f));
assert.deepEqual(sobrantes, [], `fixtures doradas sin caso: ${sobrantes.join(", ")}`);

let piezas = 0;
for (const caso of casos) {
  const ruta = path.join(DIRECTORIO_DORADO, `${caso.id}.json`);
  assert.ok(existsSync(ruta), `falta la fixture dorada ${caso.id}`);
  const dorado = JSON.parse(readFileSync(ruta, "utf8")) as RegistroDorado;
  const actual = registroDe(caso);
  const donde = `${caso.id}`;

  assert.equal(dorado.motor.version, VERSION_MOTOR, `${donde}: la fixture se tomó con el motor ${dorado.motor.version} y ahora es ${VERSION_MOTOR}: regenera las fixtures`);
  assert.equal(actual.especHash, dorado.especHash, `${donde}: la espec cambió (especHash)`);
  assert.deepEqual(actual.noRepresentable, dorado.noRepresentable, `${donde}: cambió lo que no se representa`);
  assert.deepEqual(Object.keys(actual.piezas), Object.keys(dorado.piezas), `${donde}: cambiaron las piezas`);
  for (const id of Object.keys(dorado.piezas)) {
    assert.deepEqual(actual.piezas[id]!.lineas, dorado.piezas[id]!.lineas, `${donde}/${id}: cambió la lista de materiales`);
    actual.piezas[id]!.caja.forEach((v, k) => assert.ok(Math.abs(v - dorado.piezas[id]!.caja[k]!) <= TOLERANCIA_CAJA_CM, `${donde}/${id}: la caja se movió más de ${TOLERANCIA_CAJA_CM} cm en el eje ${k} (${v} contra ${dorado.piezas[id]!.caja[k]})`));
    piezas += 1;
  }
  assert.deepEqual(actual.total.lineas, dorado.total.lineas, `${donde}: cambió el total`);
  assert.equal(actual.total.unidades, dorado.total.unidades);
  actual.caja.forEach((v, k) => assert.ok(Math.abs(v - dorado.caja[k]!) <= TOLERANCIA_CAJA_CM, `${donde}: la caja total se movió más de ${TOLERANCIA_CAJA_CM} cm en el eje ${k}`));
  assert.deepEqual(actual.referenciaPython, dorado.referenciaPython, `${donde}: cambió la referencia de Python`);
}

// Las ideas con pieza representable cuentan algo; lo que no se representa queda dicho, no en cero callado.
for (const caso of casos) {
  const dorado = JSON.parse(readFileSync(path.join(DIRECTORIO_DORADO, `${caso.id}.json`), "utf8")) as RegistroDorado;
  if (dorado.noRepresentable.length === 0) assert.ok(dorado.total.unidades > 0, `${caso.id}: sin globos y sin motivo`);
  else assert.ok(dorado.noRepresentable.every((n) => n.motivo.length > 10 && n.piezaId in Object.fromEntries(caso.espec.piezas.map((p) => [p.id, 1]))), `${caso.id}: un no representable sin motivo o sin pieza`);
}

// La densidad es monótona en las piezas orgánicas: sencilla < media < lujosa (a la inversa, el relleno tapaba lo que la estructura
// dejaba libre y la pieza ligera salía con más globos que la lujosa: 112 contra 94 en una guirnalda de 2,4 m). Y el relleno chico
// (R-5) no pasa de un tercio, ni se queda con los colores que solo se fabrican en algunos tamaños (Reflex, cristales).
const SOLO_ORGANICAS = new Set<PiezaEspec["oficial"]>(["semiarco", "semiarco_asimetrico", "arco_asimetrico", "columna_asimetrica", "aro_circular", "arco_no_denso", "columna_no_densa"]);
const ORGANICAS_SI_NO_SON_CLASICAS = new Set<PiezaEspec["oficial"]>(["arco", "columna", "guirnalda"]);
const esOrganica = (p: PiezaEspec) => !p.declarada && (SOLO_ORGANICAS.has(p.oficial) || (ORGANICAS_SI_NO_SON_CLASICAS.has(p.oficial) && p.tamanos !== "clasica"));
const DENSIDADES = ["sencilla", "media", "lujosa"] as const;
const TOPE_R5 = 0.34;
const TOPE_PREMIUM_EN_R5 = 0.5;
const vistas = new Set<string>();
let organicas = 0, conPremium = 0;
for (const caso of casos) {
  for (const pieza of caso.espec.piezas.filter(esOrganica)) {
    const clave = JSON.stringify({ ...pieza, id: "", nombre: "", densidad: "" });
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const conteos = DENSIDADES.map((densidad) => {
      const r = armarDesdeEspec({ ...caso.espec, piezas: [{ ...pieza, densidad }] });
      return { densidad, total: r.bom.total.reduce((s, l) => s + l.cantidad, 0), lineas: r.bom.total, noRepresentable: r.noRepresentable.length };
    });
    if (conteos.some((c) => c.noRepresentable)) continue;
    const donde = `${caso.id}/${pieza.id} (${pieza.oficial}, ${pieza.medidas.largoM ?? pieza.medidas.anchoM ?? pieza.medidas.altoM} m)`;
    const [sencilla, media, lujosa] = conteos as [(typeof conteos)[number], (typeof conteos)[number], (typeof conteos)[number]];
    assert.ok(sencilla.total < media.total && media.total < lujosa.total, `${donde}: la densidad debe ser monótona y da sencilla ${sencilla.total}, media ${media.total}, lujosa ${lujosa.total}`);
    for (const c of conteos) {
      const r5 = c.lineas.filter((l) => l.formatoId === "R-5").reduce((s, l) => s + l.cantidad, 0);
      assert.ok(r5 / c.total <= TOPE_R5, `${donde} ${c.densidad}: ${r5} de ${c.total} son R-5 (${Math.round((100 * r5) / c.total)} %): el relleno chico pasa del ${TOPE_R5 * 100} %`);
    }
    for (const color of pieza.colores.filter((c) => formatosOrganicosDe(c.codigo).length < 5 && formatosOrganicosDe(c.codigo).includes("R-5"))) {
      const suyas = lujosa.lineas.filter((l) => l.codigo === color.codigo);
      const total = suyas.reduce((s, l) => s + l.cantidad, 0);
      const enR5 = suyas.filter((l) => l.formatoId === "R-5").reduce((s, l) => s + l.cantidad, 0);
      if (total >= 8) { conPremium += 1; assert.ok(enR5 / total <= TOPE_PREMIUM_EN_R5, `${donde}: el color ${color.nombre} (${color.codigo}) va ${enR5} de ${total} en R-5: un acento de 12 cm`); }
    }
    organicas += 1;
  }
}
assert.ok(organicas >= 20 && conPremium >= 3, `la prueba de densidad vio ${organicas} piezas orgánicas y ${conPremium} colores premium: debe mirar las de las ideas`);

console.log(`test-motor-guiada-golden: ok (${casos.length} casos, ${piezas} piezas, ${organicas} orgánicas con densidad monótona, motor ${VERSION_MOTOR})`);
