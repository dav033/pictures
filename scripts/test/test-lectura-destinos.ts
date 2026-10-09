/**
 * Sin propiedades huérfanas en la lectura de una foto (`LecturaFotoSchema`). Sin coste ni red.
 * - todo campo hoja del esquema tiene su destino en `lectura-destinos.ts` (quién lo consume, o por qué se ignora) y nada
 *   sobra en el libro: si se agrega un campo a la lectura sin decir quién lo usa, esto falla (y `tsc` también);
 * - los campos que agrega la medición con los globos detectados (anclas con su diámetro, colores por escalón, mezcla y color
 *   dominante por tramo, formatos y diámetros por escalón, el montón de piso, las notas del lector) CAMBIAN de verdad lo que
 *   se compila: modificar cada uno da otra escena u otras notas.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-lectura-destinos.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { ESQUEMA_LECTURA_FOTO, LecturaFotoSchema, type LecturaFoto, type PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { DESTINOS } from "./lectura-destinos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

type Nodo = { type?: string; items?: Nodo; properties?: Record<string, Nodo & { const?: string }>; oneOf?: Nodo[]; anyOf?: Nodo[] };

/** Las rutas de las hojas de un JSON Schema, con el mismo formato que el libro de destinos. */
function hojas(n: Nodo, ruta: string): string[] {
  const variantes = n.oneOf ?? n.anyOf;
  if (variantes) {
    const reales = variantes.filter((v) => v.type !== "null");
    if (reales.length === 1) return hojas(reales[0]!, ruta);
    return reales.flatMap((v) => { const tipo = v.properties?.tipo?.const; return hojas(v, tipo ? `${ruta}<${tipo}>` : ruta); });
  }
  if (n.type === "array" && n.items) return hojas(n.items, `${ruta}[]`);
  if (n.type === "object" && n.properties) return Object.entries(n.properties).flatMap(([k, v]) => hojas(v, ruta ? `${ruta}.${k}` : k));
  return [ruta];
}

console.log("El libro de destinos");
prueba("todo campo hoja del esquema tiene su destino, y el libro no tiene campos que ya no existen", () => {
  const delEsquema = new Set(hojas(ESQUEMA_LECTURA_FOTO as Nodo, ""));
  const delLibro = new Set(Object.keys(DESTINOS));
  const sinDestino = [...delEsquema].filter((r) => !delLibro.has(r));
  const sobran = [...delLibro].filter((r) => !delEsquema.has(r));
  assert.deepEqual(sinDestino, [], `campos de la lectura sin destino declarado: ${sinDestino.join(", ")}`);
  assert.deepEqual(sobran, [], `destinos de campos que no existen: ${sobran.join(", ")}`);
  assert.ok(delEsquema.size > 150, `${delEsquema.size} hojas`);
});

prueba("lo ignorado dice por qué, y todo lo demás tiene al menos un consumidor", () => {
  for (const [ruta, destino] of Object.entries(DESTINOS)) {
    if ("ignorado" in destino) assert.ok(destino.ignorado.length >= 25, `${ruta}: la razón de ignorarlo es muy corta`);
    else assert.ok(destino.length >= 1 && destino.every((c) => ["compilar", "medir", "prompt", "nota"].includes(c)), ruta);
  }
});

console.log("Lo que mide la detección se consume");
const DORADO = { nombre: "dorado", hex: "#D4AF37", peso: 60, acabado: "cromado" as const };
const BLANCO = { nombre: "blanco", hex: "#F5F5F5", peso: 40, acabado: "mate" as const };
const MEZCLA = { gigantes: 8, grandes: 22, medianos: 50, chicos: 20, diametroGigante: 0.27, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.045, formatoGigante: "R-36" as const, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };

const BASE: LecturaFoto = {
  resumen: "arco de prueba", aspecto: 1, escala: { altoImagenCm: 300, referencia: "prueba" }, pisoY: 0.85, sala: { pared: "#f0f0f0", piso: "#dddddd" },
  piezas: [
    {
      tipo: "guirnalda_organica", tamanos: {}, racimos: 0.4, colores: [DORADO, BLANCO], mezcla: MEZCLA,
      puntos: [
        { x: 0.2, y: 0.62, grosor: 0.2, mezcla: { grandes: 10, medianos: 70, chicos: 20 } }, { x: 0.35, y: 0.38, grosor: 0.22 }, { x: 0.5, y: 0.3, grosor: 0.22, dominante: "dorado" },
        { x: 0.65, y: 0.38, grosor: 0.22 }, { x: 0.8, y: 0.62, grosor: 0.2, mezcla: { gigantes: 20, grandes: 20, medianos: 50, chicos: 10 } },
      ],
      coloresPorEscalon: [{ escalon: "gigantes", pesos: [100, 0] }],
      anclas: [{ x: 0.3, y: 0.45, escalon: "gigantes", color: "blanco", diametro: 0.27 }, { x: 0.7, y: 0.45, escalon: "grandes", color: "dorado", diametro: 0.13 }],
      nota: "un tramo se ve tapado",
    },
    { tipo: "racimo_piso", x: 0.5, yPie: 0.95, yArriba: 0.8, ancho: 0.22, tamanos: {}, racimos: 0.5, colores: [DORADO, BLANCO], mezcla: { grandes: 30, medianos: 40, chicos: 30, diametroGrande: 0.1, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" }, coloresPorEscalon: [{ escalon: "chicos", pesos: [100, 0] }] },
  ],
};

const guirnalda = (l: LecturaFoto) => l.piezas[0] as Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
const monton = (l: LecturaFoto) => l.piezas[1] as Extract<PiezaLeida, { tipo: "racimo_piso" }>;
const huella = (l: LecturaFoto) => { const c = compilarLectura(LecturaFotoSchema.parse(l)); return JSON.stringify({ escena: c.escena, notas: c.notas, omitidas: c.omitidas }); };
const referencia = huella(BASE);

const CAMBIOS: Array<[string, (l: LecturaFoto) => void]> = [
  ["anclas[].diametro", (l) => { guirnalda(l).anclas![0]!.diametro = 0.2; }],
  ["anclas[].x", (l) => { guirnalda(l).anclas![1]!.x = 0.78; }],
  ["anclas[].y", (l) => { guirnalda(l).anclas![1]!.y = 0.36; }],
  ["anclas[].escalon", (l) => { guirnalda(l).anclas![1]!.escalon = "gigantes"; }],
  ["anclas[].color", (l) => { guirnalda(l).anclas![1]!.color = "blanco"; }],
  ["coloresPorEscalon de la guirnalda", (l) => { guirnalda(l).coloresPorEscalon = [{ escalon: "gigantes", pesos: [0, 100] }]; }],
  ["puntos[].mezcla", (l) => { guirnalda(l).puntos[0]!.mezcla = { gigantes: 40, grandes: 30, medianos: 30, chicos: 0 }; }],
  ["puntos[].dominante", (l) => { guirnalda(l).puntos[2]!.dominante = "blanco"; }],
  ["mezcla.diametroGigante (sin formato nombrado)", (l) => { const m = guirnalda(l).mezcla!; delete m.formatoGigante; delete m.formatoGrande; m.diametroGigante = 0.2; m.diametroGrande = 0.1; }],
  ["mezcla.formatoGigante", (l) => { guirnalda(l).mezcla!.formatoGigante = "R-24"; }],
  ["mezcla.gigantes", (l) => { guirnalda(l).mezcla!.gigantes = 30; guirnalda(l).mezcla!.medianos = 28; }],
  ["nota", (l) => { guirnalda(l).nota = "otra cosa que no se pudo leer"; }],
  ["racimo_piso.coloresPorEscalon", (l) => { monton(l).coloresPorEscalon = [{ escalon: "chicos", pesos: [0, 100] }]; }],
  ["racimo_piso.mezcla", (l) => { monton(l).mezcla!.chicos = 10; monton(l).mezcla!.medianos = 60; }],
];

prueba("la lectura de partida compila con lo que trae (y el montón en el piso)", () => {
  const c = compilarLectura(LecturaFotoSchema.parse(BASE));
  assert.deepEqual(c.omitidas, []);
  assert.equal(c.escena.nodos.length, 2);
  assert.ok(c.notas.some((n) => /un tramo se ve tapado/.test(n)));
});

for (const [campo, cambia] of CAMBIOS) {
  prueba(`cambiar «${campo}» cambia lo que se compila`, () => {
    const l = structuredClone(BASE);
    cambia(l);
    assert.notEqual(huella(l), referencia);
  });
}

console.log(`test-lectura-destinos: ${pruebas} pruebas ok`);
