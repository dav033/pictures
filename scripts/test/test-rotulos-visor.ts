/**
 * Rótulos en cursiva en el visor (`rotulo-visor.ts`, `escenografia-visor.ts`) y en la miniatura. Sin coste, sin red ni lienzo: el texto
 * se dibuja con un rasterizador de mentira (un rectángulo con un hueco). NINGÚN CAMPO HUÉRFANO (cambiar texto, color, acabado, alto o
 * altura cambia lo que se dibuja) · la geometría de cada texto es de ESTE visor (no de módulo), con tope de 12 y salida del menos usado ·
 * mientras la letra carga el rótulo es una marca · el nombre de acrílico suelto deja un tablero invisible para elegirlo.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-rotulos-visor.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { crearEscenografiaVisor } from "../../src/components/tres-d/escenografia-visor";
import { textoDeMiniatura } from "../../src/components/tres-d/miniatura-rotulo";
import type { Rasterizador } from "../../src/components/tres-d/rotulo-visor";
import { armarEscenografia, type ElementoEscenografia, type RotuloEscenografia } from "../../src/lib/globos3d/escenografia";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { conTextoPieza, elementosDeEscenografia, piezaDeMueble, type PiezaEscenografia } from "../../src/lib/globos3d/mobiliario-pieza";
import { altoEnEm, aspectoEstimado, caraDe, colocarRotulo } from "../../src/lib/globos3d/rotulos";
import { prueba, terminar, cerca, escenografia, mascara } from "./lib-test-rotulos";

// ---------------------------------------------------------------------------------------------------------- visor

/** Un rasterizador de mentira: el texto es un rectángulo con un hueco, tan ancho como letras tenga (así no hace falta un lienzo). */
const falso = (): { rasterizar: Rasterizador; llamadas: string[] } => {
  const llamadas: string[] = [];
  return {
    llamadas,
    rasterizar: (texto) => {
      llamadas.push(texto);
      const ancho = 24 * texto.length + 12;
      return mascara(ancho, 40, (x, y) => !(x >= 6 && x < ancho - 6 && y >= 14 && y < 26));
    },
  };
};
const entorno = new THREE.Texture();

/** Las letras de lo que dibujó el visor: la malla hija con la geometría de texto. */
function letrasDe(objetos: THREE.Object3D[]): THREE.Mesh[] {
  const salida: THREE.Mesh[] = [];
  for (const o of objetos) o.traverse((h) => { if (h instanceof THREE.Mesh && h.userData.rotulo === true) salida.push(h); });
  return salida;
}
const firma = (m: THREE.Mesh) => {
  const mat = m.material as THREE.MeshStandardMaterial;
  m.geometry.computeBoundingBox();
  return JSON.stringify({ ancho: Math.round(m.geometry.boundingBox!.max.x * 1e4), forma: (mat.alphaMap?.image as { width: number } | undefined)?.width ?? 0, s: m.scale.toArray().map((n) => Math.round(n * 1e6)), p: m.position.toArray().map((n) => Math.round(n * 1e6)), c: mat.color.getHexString(), m: mat.metalness, g: m.geometry.attributes.position!.count });
};
const dibujar = (rotulo: RotuloEscenografia, visor = crearEscenografiaVisor(() => entorno, { rasterizar: falso().rasterizar })) => {
  const caja: ElementoEscenografia = { forma: "caja", centro: { x: 0, y: 100, z: 0 }, tamano: { x: 200, y: 200, z: 2 }, hex: "#f7f6f2", acabado: "mate", rotulo };
  const letras = letrasDe(visor.piezas(armarEscenografia([caja])));
  assert.equal(letras.length, 1, "un rótulo es una malla de letras");
  return letras[0]!;
};

prueba("NINGÚN CAMPO HUÉRFANO: cada campo del rótulo cambia lo que dibuja el visor", () => {
  const base: RotuloEscenografia = { texto: "Ana", color: "#112233", acabado: "vinilo", altoCm: 30, yCm: 100 };
  const cambios = { texto: "Isabella", color: "#ddaa00", acabado: "acrilico_espejo", altoCm: 15, yCm: 150 } as const satisfies Record<keyof RotuloEscenografia, unknown>;
  const referencia = firma(dibujar(base));
  for (const campo of Object.keys(cambios) as (keyof RotuloEscenografia)[]) {
    assert.notEqual(firma(dibujar({ ...base, [campo]: cambios[campo] })), referencia, `cambiar «${campo}» no cambia nada de lo que se dibuja`);
  }
});

prueba("el visor dibuja las letras con su tamaño, su altura, su grosor (vinilo fino, acrílico de 6 mm) y su color", () => {
  const vinilo = dibujar({ texto: "Ana", color: "#112233", acabado: "vinilo", altoCm: 30, yCm: 100 });
  cerca(vinilo.scale.y, 0.3, 1e-6, "alto del texto (m)");
  cerca(vinilo.scale.x, 0.3 * ((24 * 3 + 12) / 40), 1e-6, "ancho del texto (m): alto por la proporción de su tinta");
  cerca(vinilo.position.y, 0, 1e-6, "centrado a 100 cm del borde de abajo de un tablero de 200 cm");
  cerca(vinilo.position.z, 0.01 + 0.0003, 1e-6, "pegado a la cara de delante");
  assert.equal((vinilo.material as THREE.MeshStandardMaterial).color.getHexString(), "112233");
  assert.equal(vinilo.geometry.attributes.position!.count, 4, "un vinilo es una placa de dos triángulos con la forma de las letras por transparencia");
  assert.ok((vinilo.material as THREE.MeshStandardMaterial).alphaMap, "la forma va en la textura");
  assert.equal((vinilo.material as THREE.MeshStandardMaterial).polygonOffset, true);
  assert.equal(vinilo.castShadow, false);
  const espejo = dibujar({ texto: "Ana", color: "#d6b25a", acabado: "acrilico_espejo", altoCm: 30, yCm: 100 });
  cerca(espejo.scale.z, 0.006, 1e-9, "grosor del acrílico (m)");
  const m = espejo.material as THREE.MeshStandardMaterial;
  assert.equal(m.metalness, 1);
  assert.equal(m.envMap, entorno, "el espejo refleja el entorno de ESTE visor");
  assert.equal(espejo.castShadow, true);
  const mate = dibujar({ texto: "Ana", color: "#d6b25a", acabado: "acrilico_mate", altoCm: 30, yCm: 100 });
  assert.ok((mate.material as THREE.MeshStandardMaterial).metalness < 0.2);
  // Un texto muy largo se achica para caber en el tablero (200 cm).
  const largo = dibujar({ texto: "Una frase larga", color: "#000000", acabado: "vinilo", altoCm: 60, yCm: 100 });
  const aspecto = (24 * 15 + 12) / 40;
  assert.ok(largo.scale.y * 100 * aspecto <= 200 * 0.92 + 0.01, "no se sale del tablero");
});

prueba("la geometría de cada texto es de ESTE visor: se hace una vez, no se comparte entre visores y se libera con el visor", () => {
  const a = falso(), b = falso();
  const visorA = crearEscenografiaVisor(() => entorno, { rasterizar: a.rasterizar }), visorB = crearEscenografiaVisor(() => entorno, { rasterizar: b.rasterizar });
  const caja = (x: number, rotulo: RotuloEscenografia): ElementoEscenografia => ({ forma: "caja", centro: { x, y: 100, z: 0 }, tamano: { x: 100, y: 200, z: 2 }, hex: "#fff", acabado: "mate", rotulo });
  const r1: RotuloEscenografia = { texto: "Ana", color: "#000000", acabado: "acrilico_mate", altoCm: 20, yCm: 50 };
  const piezas = visorA.piezas(armarEscenografia([caja(0, r1), caja(200, { ...r1, color: "#ff0000", altoCm: 40 }), caja(400, { ...r1, acabado: "acrilico_espejo" })]));
  const letras = letrasDe(piezas);
  assert.equal(letras.length, 3);
  assert.deepEqual(a.llamadas, ["Ana"], "tres rótulos con el mismo texto, un solo dibujo del texto");
  assert.ok(letras.every((l) => l.geometry === letras[0]!.geometry), "la misma geometría (acrílico mate y espejo)");
  assert.equal(letras[0]!.geometry.userData.compartido, true, "marcada compartida: vaciar una pieza no la libera");
  visorA.piezas(armarEscenografia([caja(0, r1)]));
  assert.deepEqual(a.llamadas, ["Ana"], "ni al volver a armar la pieza");
  const deB = letrasDe(visorB.piezas(armarEscenografia([caja(0, r1)])));
  assert.deepEqual(b.llamadas, ["Ana"], "otro visor hace su propia geometría (nada de módulo)");
  assert.notEqual(deB[0]!.geometry, letras[0]!.geometry);
  let liberadas = 0;
  letras[0]!.geometry.addEventListener("dispose", () => { liberadas++; });
  deB[0]!.geometry.addEventListener("dispose", () => { liberadas += 100; });
  visorA.liberar();
  assert.equal(liberadas, 1, "liberar el visor A suelta lo suyo y no lo de B");
  visorB.liberar();
  assert.equal(liberadas, 101);
  // Sin lienzo (el navegador falta), el rótulo no se dibuja pero el resto de la pieza sí.
  const sinLienzo = crearEscenografiaVisor(() => entorno, { rasterizar: () => null }).piezas(armarEscenografia([caja(0, r1)]));
  assert.equal(sinLienzo.length, 1);
  assert.equal(letrasDe(sinLienzo).length, 0);
});

/** Lo que hace el visor al vaciar una pieza: avisar a cada malla que se libera (`userData.alLiberar`). */
const liberarMallas = (objetos: THREE.Object3D[]) => {
  for (const o of objetos) o.traverse((h) => { const f: unknown = h.userData.alLiberar; if (typeof f === "function") { h.userData.alLiberar = undefined; f(); } });
};
const cajaConTexto = (texto: string, x = 0): ElementoEscenografia => ({ forma: "caja", centro: { x, y: 100, z: 0 }, tamano: { x: 100, y: 200, z: 2 }, hex: "#fff", acabado: "mate", rotulo: { texto, color: "#000000", acabado: "acrilico_mate", altoCm: 20, yCm: 50 } });

prueba("un vinilo no saca el contorno de su texto: una placa compartida y una textura por texto, que sale con él", () => {
  const f = falso();
  const visor = crearEscenografiaVisor(() => entorno, { rasterizar: f.rasterizar });
  const vinilo = (texto: string, x: number, color = "#000000"): ElementoEscenografia => ({ forma: "caja", centro: { x, y: 100, z: 0 }, tamano: { x: 100, y: 200, z: 2 }, hex: "#fff", acabado: "mate", rotulo: { texto, color, acabado: "vinilo", altoCm: 20, yCm: 50 } });
  const objetos = visor.piezas(armarEscenografia([vinilo("Ana", 0), vinilo("Ana", 200, "#ff0000"), vinilo("Eva", 400)]));
  const l = letrasDe(objetos);
  assert.equal(l.length, 3);
  assert.ok(l.every((m) => m.geometry === l[0]!.geometry), "una sola placa para todos los vinilos del visor");
  const mapa = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).alphaMap!;
  assert.equal(mapa(l[0]!), mapa(l[1]!), "la misma forma para el mismo texto en otro color");
  assert.notEqual(mapa(l[0]!), mapa(l[2]!));
  assert.notEqual(l[0]!.material, l[1]!.material, "pero cada color su material");
  const datos = (mapa(l[0]!).image as { data: Uint8Array; width: number; height: number });
  const tinta = Array.from({ length: datos.width * datos.height }, (_, i) => datos.data[i * 2 + 1]!);
  assert.ok(tinta.some((v) => v === 255) && tinta.some((v) => v === 0), "la textura trae tinta (255) y hueco (0)");
  assert.ok(Math.abs(datos.width / datos.height - (24 * 3 + 12) / 40) < 0.1, "con la proporción del texto");
  let sueltas = 0;
  mapa(l[0]!).addEventListener("dispose", () => { sueltas++; });
  visor.liberar();
  assert.equal(sueltas, 1, "la textura es del visor y se libera con él");
});

prueba("MAYOR 3: una escena con 20 textos distintos en uso no se rehace una y otra vez ni suelta lo que sus mallas usan", () => {
  const f = falso();
  const visor = crearEscenografiaVisor(() => entorno, { rasterizar: f.rasterizar });
  const numeros = Array.from({ length: 20 }, (_, i) => `Mesa ${i + 1}`);
  const elementos = numeros.map((t, i) => cajaConTexto(t, i * 120));
  const primera = visor.piezas(armarEscenografia(elementos));
  const geometrias = letrasDe(primera).map((m) => m.geometry);
  let sueltas = 0;
  for (const g of geometrias) g.addEventListener("dispose", () => { sueltas++; });
  assert.equal(f.llamadas.length, 20);
  // Se rehace la escena entera (cambió la sala, llegó la letra): los 20 textos siguen guardados, sin dibujarlos de nuevo.
  for (let ronda = 0; ronda < 3; ronda++) {
    liberarMallas(primera.splice(0));
    primera.push(...visor.piezas(armarEscenografia(elementos)));
  }
  assert.equal(f.llamadas.length, 20, "tres rehechos de 20 textos, ninguno se vuelve a dibujar");
  assert.equal(sueltas, 0, "ni se suelta una geometría que una malla viva usa");
});

prueba("los textos sin uso salen del caché pasando de 12, el más viejo primero; los que una malla usa, nunca", () => {
  const f = falso();
  const visor = crearEscenografiaVisor(() => entorno, { rasterizar: f.rasterizar });
  const sueltas: string[] = [];
  const hechos = Array.from({ length: 16 }, (_, i) => {
    const objetos = visor.piezas(armarEscenografia([cajaConTexto(`nombre ${i}`)]));
    letrasDe(objetos)[0]!.geometry.addEventListener("dispose", () => { sueltas.push(`nombre ${i}`); });
    return objetos;
  });
  assert.deepEqual(sueltas, [], "16 textos en uso: ninguno sale");
  // Se vacían las piezas (escribir un nombre letra por letra las rehace y deja los intermedios sin uso): sin texto nuevo no se poda.
  for (const objetos of hechos) liberarMallas(objetos);
  assert.deepEqual(sueltas, [], "soltar mallas no suelta textos: rehacer una escena las pide de nuevo");
  visor.piezas(armarEscenografia([cajaConTexto("nombre nuevo")]));
  assert.deepEqual(sueltas, ["nombre 0", "nombre 1", "nombre 2", "nombre 3", "nombre 4"], "con un texto nuevo, pasando de 12 sin uso, salen los más viejos");
  // Lo usado hace poco no sale por viejo: «nombre 5» se vuelve a usar y no se redibuja.
  const antes = f.llamadas.length;
  const otra = visor.piezas(armarEscenografia([cajaConTexto("nombre 5")]));
  assert.equal(f.llamadas.length, antes, "«nombre 5» seguía guardado");
  assert.equal(letrasDe(otra).length, 1);
  visor.liberar();
  assert.ok(sueltas.length >= 5);
});

prueba("mientras la letra carga el rótulo es una marca (no letras)", () => {
  const cargando = crearEscenografiaVisor(() => entorno, { rasterizar: () => "pendiente" });
  const objetos = cargando.piezas(armarEscenografia([cajaConTexto("Ana")]));
  const marca = objetos[0]!.children[0] as THREE.Mesh | undefined;
  assert.ok(marca instanceof THREE.Mesh && !(marca.geometry instanceof THREE.ExtrudeGeometry), "una marca (no letras) del tamaño del texto");
  assert.equal(letrasDe(objetos).length, 0);
});

prueba("el nombre de acrílico suelto: el tablero no se ve pero se puede elegir; las letras sí", () => {
  const pieza = escenografia(piezaDeMueble(muebleDe("rotulo_acrilico")!));
  const visor = crearEscenografiaVisor(() => entorno, { rasterizar: falso().rasterizar });
  const objetos = visor.piezas(armarEscenografia(elementosDeEscenografia(pieza)));
  assert.equal(objetos.length, 1);
  const tablero = objetos[0] as THREE.Mesh;
  assert.equal((tablero.material as THREE.Material).visible, false, "el tablero no se dibuja");
  assert.equal(tablero.castShadow, false);
  tablero.geometry.computeBoundingBox();
  cerca(tablero.geometry.boundingBox!.max.x * 2, 1.2, 1e-6, "pero mide lo que mide la pieza (para elegirla y mover su caja)");
  assert.equal(letrasDe(objetos).length, 1);
  const sinRotulo = armarEscenografia([{ forma: "caja", centro: { x: 0, y: 5, z: 0 }, tamano: { x: 10, y: 10, z: 1 }, hex: "#fff", acabado: "mate", oculto: true }]);
  assert.equal(visor.piezas(sinRotulo).length, 0, "un amarre oculto sin rótulo sigue sin dibujarse");
});


prueba("la miniatura dibuja el rótulo con el mismo tamaño y lugar que el visor (colocarRotulo), también el nombre de acrílico", () => {
  const solido = (p: PiezaEscenografia) => armarEscenografia(elementosDeEscenografia(p)).find((x) => x.rotulo)!;
  const acrilico = solido(escenografia(piezaDeMueble(muebleDe("rotulo_acrilico")!)));
  const uno = (x: number) => x, escala = 0.4;
  const t = textoDeMiniatura(acrilico, uno, (y) => 60 - y, escala)!;
  assert.deepEqual(t.lineas, ["Isabella"]);
  const c = colocarRotulo(caraDe(acrilico)!, acrilico.rotulo!, aspectoEstimado("Isabella"));
  cerca(t.tam, (c.altoCm * escala) / altoEnEm("Isabella"), 1e-9, "tamaño de letra = lo que cabe / lo que mide de alto la letra");
  cerca(t.y, 60 - (acrilico.origen.y + c.yCm), 1e-9, "a la altura que le da el visor");
  assert.equal(t.color, acrilico.rotulo!.color);
  const marco = escenografia(conTextoPieza(escenografia(piezaDeMueble(muebleDe("marco_tela")!)), { texto: "David\ny\nDayan" }));
  assert.equal(textoDeMiniatura(solido(marco), uno, uno, 1)!.lineas.length, 3);
  assert.equal(textoDeMiniatura(armarEscenografia([{ forma: "cilindro", base: { x: 0, y: 0, z: 0 }, radioCm: 5, altoCm: 10, hex: "#fff", acabado: "mate" }])[0]!, uno, uno, 1), undefined);
});

terminar("test-rotulos-visor");
