/**
 * Taller 3D (/3d): formatos y geometría de los globos, sin three.js ni navegador. Sin coste.
 * - cada formato de la tabla oficial de color tiene su modelo, y cada modelo tiene colores que se fabrican;
 * - el perfil redondo mide lo que dice su inflado (ancho = diámetro, alto ≈ diámetro × 1,08 más cuello y nudo);
 * - el Link-O-Loon es más alargado que el redondo del mismo diámetro;
 * - el inflado se limita entre el 40 % y el máximo del formato.
 */
import assert from "node:assert/strict";
import { FORMATOS_GLOBO, coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { altoPerfil, anchoPerfil, centroCuerpo, contornoCorazon, nudoCm, perfilLink, perfilRedondo } from "../../src/lib/globos3d/geometria";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import { PARED_TRENZAS_INICIAL, armarParedTrenzas } from "../../src/lib/globos3d/pared-trenzas";
import { armarTrenza } from "../../src/lib/globos3d/trenza";
import { MODULOS, armarModulo, entradaDelCono, objetivoDeContacto, materialesModulo } from "../../src/lib/globos3d/modulos";

const modelados = new Set(FORMATOS_GLOBO.map((f) => f.id));
const enTabla = new Set(TABLA_SEMPERTEX.referencias.flatMap((r) => r.formatos).filter((f) => f !== "Stuffing"));
for (const id of enTabla) assert.ok(modelados.has(id), `falta el modelo 3D de ${id}`);
for (const f of FORMATOS_GLOBO) {
  assert.ok(coloresDelFormato(f.id).length > 0, `${f.id} no tiene colores en la tabla oficial`);
  assert.ok(f.infladoDecoracionCm <= f.diametroMaxCm, `${f.id}: el inflado de decoración pasa del máximo`);
}
assert.equal(coloresDelFormato("R-12").length, 90);
assert.equal(formatoPorId("R-12")?.diametroMaxCm, 30.5);

for (const diametro of [12, 25, 55, 85]) {
  const perfil = perfilRedondo(diametro);
  assert.ok(Math.abs(anchoPerfil(perfil) - diametro) < diametro * 0.02, `ancho del redondo de ${diametro} cm: ${anchoPerfil(perfil)}`);
  const alto = altoPerfil(perfil);
  assert.ok(alto > diametro * 1.08 && alto < diametro * 1.3, `alto del redondo de ${diametro} cm: ${alto}`);
  assert.equal(perfil[0]!.r, 0, "el perfil arranca en el eje (nudo cerrado)");
  assert.equal(perfil[perfil.length - 1]!.r, 0, "el perfil cierra arriba en el eje");
}
assert.ok(altoPerfil(perfilLink(25)) > altoPerfil(perfilRedondo(25)) * 1.2, "el Link-O-Loon es más alargado que el redondo");

const corazon = contornoCorazon(28);
const xs = corazon.map((p) => p.x);
assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 28) < 1, "el corazón mide su ancho");

const r12 = formatoPorId("R-12")!;
assert.equal(infladoValido(r12, 99), r12.diametroMaxCm);
assert.equal(infladoValido(r12, 1), r12.diametroMaxCm * 0.4);

// Módulos: pareja 2, trío 3, cuarteto 4, quinteto 5, sexteto 6; los cuerpos vecinos no se montan y los nudos
// quedan en el centro (a menos de un diámetro); el cuarteto de R-12 a 25 cm mide unos 60-65 cm de ancho.
assert.deepEqual(MODULOS.map((m) => m.globos), [2, 3, 4, 5, 6]);
for (const modulo of MODULOS) {
  for (const id of ["R-5", "R-12", "R-24", "LOL-6", "LOL-12"]) {
    const f = formatoPorId(id)!;
    const d = f.infladoDecoracionCm;
    const armado = armarModulo(modulo, f, d);
    assert.equal(armado.globos.length, modulo.globos);
    const centro = centroCuerpo(f.tipo === "link" ? "link" : "redondo", d);
    const cuerpos = armado.globos.map((g) => { const l = centro + g.cuelloExtraCm; return { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l }; });
    for (let i = 0; i < cuerpos.length; i++) {
      const a = cuerpos[i]!, b = cuerpos[(i + 1) % cuerpos.length]!;
      // Se tocan aplastándose un poco (hasta un 12 % del diámetro), nunca más.
      if (cuerpos.length > 1) assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= d * 0.87, `${modulo.id} ${id}: los globos ${i} y ${i + 1} se montan`);
      // Y tampoco hay aire entre ellos (REQ-011): de centro a centro, a lo sumo 1,12 diámetros (el trío y el cuarteto de antes: 1,26 y 1,085).
      if (cuerpos.length > 1) assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= d * 1.12 + 1e-6, `${modulo.id} ${id}: entre los globos ${i} y ${i + 1} hay aire (${(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / d).toFixed(2)} diámetros)`);
    }
    // Los pitones quedan amarrados juntos en el centro (a menos de 1,5 cm): lo que separa los cuerpos es el cuello.
    for (const g of armado.globos) assert.ok(Math.hypot(g.nudo.x, g.nudo.y, g.nudo.z) <= 1.5, `${modulo.id} ${id}: un nudo quedó lejos del centro`);
    // La pareja es la de verdad (REQ-011): los dos cuellos atados en UN nudo y los cuerpos apenas tocándose (a 0,88 diámetros, el
    // 12 % que se aplasta el látex), no dos globos a 180° con casi medio globo de aire entre ellos.
    if (modulo.id === "pareja" && f.tipo === "redondo") {
      const distancia = Math.hypot(cuerpos[0]!.x - cuerpos[1]!.x, cuerpos[0]!.y - cuerpos[1]!.y, cuerpos[0]!.z - cuerpos[1]!.z);
      assert.ok(distancia >= d * 0.87 && distancia <= d * 0.9, `pareja ${id}: los cuerpos no se tocan justo (${(distancia / d).toFixed(2)} diámetros)`);
      const nudos = armado.globos.map((g) => g.nudo);
      assert.ok(Math.hypot(nudos[0]!.x - nudos[1]!.x, nudos[0]!.y - nudos[1]!.y, nudos[0]!.z - nudos[1]!.z) <= nudoCm(d) * 1.01, `pareja ${id}: los dos nudos no son uno`);
      assert.ok(armado.globos.every((g) => g.direccion.z < -0.4), `pareja ${id}: los globos no se abren hacia el fondo desde un vértice`);
    }
    // El trío es un cono: los tres globos inclinados hacia arriba por igual, con el nudo abajo (como se sienta atado de verdad).
    if (modulo.id === "trio") {
      const alturas = armado.globos.map((g) => g.direccion.y);
      assert.ok(alturas.every((y) => Math.abs(y - alturas[0]!) < 1e-9 && y > 0.4), `trío ${id}: no es un cono hacia arriba (${alturas.map((y) => y.toFixed(2)).join(", ")})`);
    }
    assert.equal(armado.anclas.length, modulo.globos >= 3 ? modulo.globos + 1 : 1);
    // Cuellos cortos: lo natural es que el cuerpo quede pegado al amarre, sin cuellos largos y finos.
    for (const g of armado.globos) assert.ok(g.cuelloExtraCm <= d * 0.12, `${modulo.id} ${id}: cuello estirado ${g.cuelloExtraCm.toFixed(1)} cm`);
  }
}
// Barrido del inflado (lo que el editor deja mover, del 40 % al 100 % del máximo, de 0,5 en 0,5 cm): en todo el rango los vecinos se
// tocan sin aire (≤ 1,12 diámetros: el 12 % de aire que admite el dueño) ni montarse de más (≥ 0,87), y la forma cambia poco a poco, sin saltos al mover el inflado.
for (const modulo of MODULOS) {
  for (const id of ["R-5", "R-9", "R-12", "R-24", "LOL-6", "LOL-12"]) {
    const f = formatoPorId(id)!;
    let anterior: { cono: number; d: number } | null = null;
    for (let d = Math.ceil(f.diametroMaxCm * 0.4 * 2) / 2; d <= f.diametroMaxCm + 1e-9; d += 0.5) {
      const armado = armarModulo(modulo, f, d);
      const natural = centroCuerpo(f.tipo === "link" ? "link" : "redondo", d);
      const c = armado.globos.map((g) => { const l = natural + g.cuelloExtraCm; return { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l }; });
      for (let i = 0; i < c.length; i++) {
        const dist = Math.hypot(c[i]!.x - c[(i + 1) % c.length]!.x, c[i]!.y - c[(i + 1) % c.length]!.y, c[i]!.z - c[(i + 1) % c.length]!.z) / d;
        assert.ok(dist >= 0.87 && dist <= 1.12 + 1e-6, `${modulo.id} ${id} a ${d} cm: vecinos ${i}-${i + 1} a ${dist.toFixed(3)} diámetros`);
      }
      const cono = Math.asin(armado.globos[0]!.direccion.y);
      if (anterior) assert.ok(Math.abs(cono - anterior.cono) <= 0.12, `${modulo.id} ${id}: al pasar de ${anterior.d} a ${d} cm el globo salta de ${anterior.cono.toFixed(2)} a ${cono.toFixed(2)} rad`);
      anterior = { cono, d };
    }
  }
}
assert.ok(entradaDelCono(1.0) === 0 && entradaDelCono(1.08) === 0 && entradaDelCono(1.18) === 1 && entradaDelCono(1.26) === 1 && entradaDelCono(1.13) > 0.4 && entradaDelCono(1.13) < 0.6);
// Fuera del rango del editor (un inflado diminuto) el cono no se pasa de la vertical ni da números absurdos: todos los globos siguen
// saliendo hacia fuera del centro (su dirección horizontal apunta a su lado) y todo es finito.
for (const modulo of MODULOS.filter((m) => m.globos >= 3)) {
  for (const id of ["R-5", "LOL-6", "LOL-12"]) {
    for (const d of [0.5, 1, 2, 3]) {
      const armado = armarModulo(modulo, formatoPorId(id)!, d);
      armado.globos.forEach((g, i) => {
        const azimut = (2 * Math.PI * i) / modulo.globos + Math.PI / modulo.globos;
        assert.ok([g.direccion.x, g.direccion.y, g.direccion.z, g.nudo.x, g.cuelloExtraCm].every(Number.isFinite), `${modulo.id} ${id} a ${d} cm: números no finitos`);
        assert.ok(g.direccion.x * Math.cos(azimut) + g.direccion.z * Math.sin(azimut) > 0.01, `${modulo.id} ${id} a ${d} cm: el globo ${i} pasó de la vertical`);
      });
    }
  }
}
// El objetivo de cierre es continuo: sin salto en el umbral y apenas aplastado (0,9) con el aire del trío.
assert.ok(Math.abs(objetivoDeContacto(1.0800001) - 1.08) < 1e-6 && Math.abs(objetivoDeContacto(1.2) - 0.9) < 1e-9 && objetivoDeContacto(1.16) < 1.08 && objetivoDeContacto(1.16) > 0.9);

// La trenza y el mural de trenzas solo toman las DIRECCIONES del cuarteto (con `cerrarHuecos: false`): no deben cambiar nunca, ni en
// Link-O-Loon, ni por un error de 1e-16 (con él, una flor de la biblioteca escogía otro hueco). Se comparan bit a bit con la cuenta de siempre.
for (const id of ["R-12", "R-5", "LOL-12", "LOL-660"]) {
  const f = formatoPorId(id)!;
  const cuarteto = { ...MODULOS[2]!, inclinacion: 0.12 };
  const apretado = armarModulo(cuarteto, f, f.infladoDecoracionCm, { cerrarHuecos: false });
  apretado.globos.forEach((g, i) => {
    const angulo = (2 * Math.PI * i) / 4 + Math.PI / 4;
    const subida = Math.sin(0.12) * (i % 2 === 0 ? 1 : -1), plano = Math.cos(0.12);
    const v = { x: Math.cos(angulo) * plano, y: subida, z: Math.sin(angulo) * plano };
    const n = Math.hypot(v.x, v.y, v.z) || 1;
    assert.deepEqual(g.direccion, { x: v.x / n, y: v.y / n, z: v.z / n }, `${id}: la dirección ${i} del cuarteto de la trenza cambió`);
  });
}
// Con el cuarteto de Link-O-Loon sin esa opción, en cambio, sí se cierra el aire (más inclinado hacia arriba).
{
  const f = formatoPorId("LOL-12")!;
  const cerrado = armarModulo(MODULOS[2]!, f, 25), abierto = armarModulo(MODULOS[2]!, f, 25, { cerrarHuecos: false });
  assert.ok(cerrado.globos[0]!.direccion.y > abierto.globos[0]!.direccion.y + 0.3);
}
// La trenza (columna, arco, festón) arma su cuarteto con `cerrarHuecos: false`: en Link-O-Loon, donde el módulo suelto se cierra en cono,
// la trenza sigue con las direcciones planas de siempre (apenas ±0,12 rad a lo largo del eje, nunca un cono).
for (const id of ["LOL-12", "R-12"]) {
  const f = formatoPorId(id)!;
  const trenza = armarTrenza({ formato: f, infladoCm: f.infladoDecoracionCm, patron: "un_color", colores: ["009"], recorrido: [{ x: 0, y: 0 }, { x: 0, y: 100 }], reparto: "paso" });
  assert.ok(trenza.globos.length >= 8);
  for (const g of trenza.globos) assert.ok(Math.abs(g.direccion.y) <= Math.sin(0.12) + 1e-9, `${id}: un cuarteto de la trenza se inclinó ${g.direccion.y.toFixed(2)} a lo largo del eje`);
}
// El mural de trenzas, igual: en Link-O-Loon sigue con los cuartetos planos (±0,12 rad), sin cono.
{
  const pared = armarParedTrenzas({ ...PARED_TRENZAS_INICIAL, grande: { formatoId: "LOL-12", infladoCm: 25 }, chico: { formatoId: "LOL-12", infladoCm: 20 }, anchoCm: 100, altoCm: 100 });
  assert.ok(pared.globos.length >= 8);
  for (const g of pared.globos) assert.ok(Math.abs(g.direccion.y) <= Math.sin(0.12) + 1e-9, `mural LOL-12: un cuarteto se inclinó ${g.direccion.y.toFixed(2)}`);
}
// El cuarteto suelto es la cruz plana de la trenza (dos parejas, una apenas por encima de la otra: ±0,12 rad) y sus vecinos se tocan sin cono.
{
  const sueltoR12 = armarModulo(MODULOS[2]!, formatoPorId("R-12")!, 25);
  sueltoR12.globos.forEach((g, i) => assert.ok(Math.abs(Math.asin(g.direccion.y) - (i % 2 === 0 ? 0.12 : -0.12)) < 1e-9, `cuarteto R-12: el globo ${i} se inclina ${Math.asin(g.direccion.y).toFixed(2)}`));
}
const cuartetoR12 = armarModulo(MODULOS[2]!, formatoPorId("R-12")!, 25);
assert.ok(cuartetoR12.anchoCm >= 55 && cuartetoR12.anchoCm <= 70, `ancho del cuarteto R-12: ${cuartetoR12.anchoCm}`);
assert.deepEqual(materialesModulo(["009", "005", "009", "005"]), [{ codigo: "009", cantidad: 2 }, { codigo: "005", cantidad: 2 }]);

console.log(`OK test-globos3d: ${FORMATOS_GLOBO.length} formatos modelados, todos con colores oficiales; perfiles a escala real; 5 módulos armados sin montarse`);
