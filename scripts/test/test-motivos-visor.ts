/**
 * Las texturas de lo impreso en la utilería (`motivos-utileria.ts`) son de UN visor y están acotadas. Sin coste, sin red y sin navegador: un
 * `document` falso da lienzos cuyo contexto 2D no hace nada.
 * - un neón escrito letra por letra no deja una textura por intermedio: las que ninguna calcomanía usa se sueltan (y se liberan de la GPU)
 *   al pasar del tope;
 * - las que una calcomanía viva usa no se sueltan nunca, aunque pasen del tope;
 * - dos visores no comparten texturas, y `liberar()` suelta todas las de su visor.
 *
 * Run: npx tsx scripts/test/test-motivos-visor.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import type { SolidoEscenografia } from "../../src/lib/globos3d/escenografia";
import { MAXIMO_SIN_USO, crearMotivosVisor } from "../../src/components/tres-d/motivos-utileria";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Un contexto 2D que acepta cualquier llamada o asignación y no dibuja nada. */
function contextoFalso(): CanvasRenderingContext2D {
  const proxy: unknown = new Proxy(function () { /* destino de las llamadas */ }, {
    get: (_o, clave) => (clave === "measureText" ? () => ({ width: 100 }) : proxy),
    set: () => true,
    apply: () => proxy,
  });
  return proxy as CanvasRenderingContext2D;
}
(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => contextoFalso() }) };

const neon = (texto: string): SolidoEscenografia => ({
  forma: "caja", origen: { x: 0, y: 0, z: 0 }, ejeX: { x: 1, y: 0, z: 0 }, ejeY: { x: 0, y: 1, z: 0 }, ejeZ: { x: 0, y: 0, z: 1 },
  tamano: { x: 60, y: 20, z: 2 }, hex: "#ffffff", acabado: "mate", motivo: { dibujo: "texto", estilo: "neon", texto, hex: "#ff3399" },
} as unknown as SolidoEscenografia);

const textura = (calco: THREE.Object3D): THREE.CanvasTexture => (((calco as THREE.Mesh).material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture);
const soltar = (calco: THREE.Object3D) => { const f = (calco as THREE.Mesh).userData.alLiberar; (calco as THREE.Mesh).userData.alLiberar = undefined; f(); };
const vigilar = (t: THREE.Texture, soltadas: Set<THREE.Texture>) => t.addEventListener("dispose", () => soltadas.add(t));

prueba("un neón escrito letra por letra no deja una textura por intermedio", () => {
  const motivos = crearMotivosVisor();
  const soltadas = new Set<THREE.Texture>();
  const palabra = "Happy Birthday Valentina";
  for (let i = 1; i <= palabra.length; i++) {
    const calco = motivos.calco(neon(palabra.slice(0, i)))!;
    vigilar(textura(calco), soltadas);
    // El editor rehace la pieza en cada tecla: la malla anterior se libera.
    soltar(calco);
  }
  assert.ok(motivos.guardadas() <= MAXIMO_SIN_USO, `${motivos.guardadas()} guardadas`);
  assert.ok(soltadas.size >= palabra.length - MAXIMO_SIN_USO - 1, `${soltadas.size} soltadas`);
  motivos.liberar();
  assert.equal(motivos.guardadas(), 0);
});

prueba("la textura que una calcomanía viva usa no se suelta aunque pasen del tope", () => {
  const motivos = crearMotivosVisor();
  const soltadas = new Set<THREE.Texture>();
  const vivo = motivos.calco(neon("Vivo"))!;
  vigilar(textura(vivo), soltadas);
  for (let i = 0; i < MAXIMO_SIN_USO * 3; i++) soltar(motivos.calco(neon(`Texto ${i}`))!);
  assert.ok(!soltadas.has(textura(vivo)), "se soltó una textura en uso");
  assert.ok(motivos.guardadas() <= MAXIMO_SIN_USO + 1);
  assert.equal(textura(motivos.calco(neon("Vivo"))!), textura(vivo), "el mismo texto reutiliza su textura");
  motivos.liberar();
});

prueba("dos visores no comparten texturas y liberar() suelta las de su visor", () => {
  const a = crearMotivosVisor(), b = crearMotivosVisor();
  const ta = textura(a.calco(neon("Igual"))!), tb = textura(b.calco(neon("Igual"))!);
  assert.notEqual(ta, tb);
  const soltadas = new Set<THREE.Texture>();
  vigilar(ta, soltadas); vigilar(tb, soltadas);
  a.liberar();
  assert.ok(soltadas.has(ta) && !soltadas.has(tb));
  assert.equal(a.guardadas(), 0);
  assert.equal(b.guardadas(), 1);
  b.liberar();
});

prueba("la textura va marcada como compartida: el visor no la suelta al vaciar una pieza", () => {
  const motivos = crearMotivosVisor();
  assert.equal(textura(motivos.calco(neon("Marca"))!).userData.compartido, true);
  motivos.liberar();
});

console.log(`test-motivos-visor: ${pruebas} pruebas ok`);
