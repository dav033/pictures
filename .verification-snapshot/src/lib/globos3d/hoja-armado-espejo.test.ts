import assert from "node:assert/strict";
import test from "node:test";
import { armarEscena, SALA_INICIAL, type Escena, type MarcoPieza, type NodoArmado } from "./escena";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "./biblioteca";
import { columnaClasica } from "./escenas-presets";
import { agruparPorNivel } from "./hoja-armado-comun";
import { centroDelGlobo, globosDeUnidad, type CentroLocal } from "./hoja-armado-local";
import { hojaDeEscena, type EstructuraHoja } from "./hoja-armado";
import type { Vec3 } from "./modulos";

/**
 * Las piezas puestas `sobre` otra o en un ancla tienen un marco con determinante −1 (un espejo). La hoja se lee en el espacio de
 * la pieza, pero tiene que describir lo que se ve en el 3D: el giro de la espiral y el sentido de la numeración se miden aquí en
 * el MUNDO, sin pasar por el espacio de la pieza, y se comparan con lo que imprime la hoja.
 */

const determinante = ({ m }: MarcoPieza) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
const resta = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cruz = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const punto = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const centroide = (ps: readonly Vec3[]): Vec3 => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length });

/** Las capas de la primera copia en el mundo (los centros de sus globos, en el orden en que se arman). */
function capasEnElMundo(nodo: NodoArmado): Vec3[][] {
  const centros: CentroLocal[] = globosDeUnidad(nodo).map((globo) => ({ globo, ...centroDelGlobo(globo) }));
  return agruparPorNivel(centros).niveles.map((capa) => capa.map(({ x, y, z }) => ({ x, y, z })));
}

/**
 * +1 si de `a` a `b` se gira a la derecha mirando desde arriba (sentido horario), −1 si a la izquierda. `arriba` es el eje de la
 * pieza en el mundo; el mundo es dextrógiro, así que un giro positivo alrededor de `arriba` se ve antihorario desde arriba.
 */
const sentidoVistoDesdeArriba = (a: Vec3, b: Vec3, arriba: Vec3) => -Math.sign(punto(arriba, cruz(a, b)));

test("idea:fantasia-metalizada: el tallo en espiral, puesto sobre otra pieza con un marco espejo, gira en la hoja hacia donde gira en el 3D", () => {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === "idea:fantasia-metalizada")!;
  const escena = escenaDeItem(item);
  const armada = armarEscena(escena);
  const tallo = armada.porNodo.find((n) => n.id === "tallo")!;
  const marco = tallo.puestas[0]!.marco;
  assert.ok(determinante(marco) < 0, "el tallo está puesto con un marco espejo: es el caso que se prueba");
  const arriba = { x: marco.m[1], y: marco.m[4], z: marco.m[7] };
  const capas = capasEnElMundo(tallo);
  const giros = capas.slice(1).map((capa, k) => {
    const abajo = capas[k]!;
    return sentidoVistoDesdeArriba(resta(abajo[0]!, centroide(abajo)), resta(capa[0]!, centroide(capa)), arriba);
  });
  assert.ok(giros.length > 2 && giros.every((g) => g === giros[0]), "la espiral gira siempre hacia el mismo lado");

  const estructura = hojaDeEscena(item.nombre ?? item.id, escena, armada).estructuras.find((e) => e.id === "tallo")!;
  assert.equal(estructura.modo, "anillos");
  const conGiro = estructura.capas.filter((c) => c.giroGrados !== null && c.giroGrados !== 0);
  assert.ok(conGiro.length > 0);
  for (const capa of conGiro) assert.equal(Math.sign(capa.giroGrados!), giros[0], `capa ${capa.numero}: la hoja dice ${capa.giroGrados}°`);

  // La numeración de cada anillo: del globo 1 al 2, hacia donde se ve en el 3D.
  for (const capa of estructura.capas) {
    const enElMundo = capas[capa.numero - 1]!;
    const c = centroide(enElMundo);
    const esperado = sentidoVistoDesdeArriba(resta(enElMundo[0]!, c), resta(enElMundo[1]!, c), arriba) > 0 ? "horario" : "antihorario";
    assert.equal(capa.sentidoNumeracion, esperado, `capa ${capa.numero}`);
  }
});

test("una columna puesta con un marco espejo no se junta con su gemela de pie: su espiral gira al revés", () => {
  const columna = columnaClasica(120);
  const escena: Escena = {
    sala: SALA_INICIAL,
    nodos: [
      { id: "pie", nombre: "Columna 1", pieza: columna, colocacion: { en: "piso", xCm: -100, zCm: 0, giroGrados: 0 } },
      { id: "base", nombre: "Base", pieza: columnaClasica(60, ["005", "005", "005", "005"]), colocacion: { en: "piso", xCm: 100, zCm: 0, giroGrados: 0 } },
      { id: "encima", nombre: "Columna 2", pieza: columna, colocacion: { en: "sobre", padreId: "base", puntoCm: { x: 0, y: 70, z: 0 }, normal: { x: 0, y: 1, z: 0 }, giroGrados: 0 } },
    ],
  };
  const armada = armarEscena(escena);
  assert.ok(determinante(armada.porNodo.find((n) => n.id === "encima")!.puestas[0]!.marco) < 0, "la de encima está puesta con un marco espejo");
  assert.ok(determinante(armada.porNodo.find((n) => n.id === "pie")!.puestas[0]!.marco) > 0);
  const hoja = hojaDeEscena("espejo", escena, armada);
  // Las dos se llaman igual y llevan lo mismo: sin el espejo serían UNA estructura con 2 copias.
  const columnas = hoja.estructuras.filter((e) => e.id !== "base");
  assert.deepEqual(columnas.map((e) => [e.nombre, e.unidades]), [["Columna 1", 1], ["Columna 2", 1]]);
  const [pie, encima] = columnas as [EstructuraHoja, EstructuraHoja];
  const giro = (e: EstructuraHoja) => e.capas.find((c) => c.giroGrados)!.giroGrados!;
  assert.equal(Math.sign(giro(pie)), -Math.sign(giro(encima)), "las espirales giran al revés");
});
