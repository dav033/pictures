/**
 * Instantánea del motor orgánico (sin coste): el armado completo (posiciones, formatos, colores, avisos, anclas, materiales)
 * de seis piezas (entre ellas el par de columnas inclinadas rosa y plata de CASE-002 y un relleno con tope `maximo`) SIN globos fijos debe seguir idéntico al guardado en `datos/organico-instantanea.json`. Protege las
 * refactorizaciones del motor (la asignación de colores y la colocación de fijos viven en sus propios módulos) y que los
 * fijos no cambien lo que se arma sin ellos. Si un cambio del motor es a propósito: `--actualizar` y revisar el diff.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-organico-instantanea.ts [--actualizar]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { armarOrganico, olvidarEmpaquesOrganicos, type OpcionesOrganico } from "../../src/lib/globos3d/organico";
import { COLUMNA_QUINCE_AZUL } from "../../src/lib/globos3d/organico-presets";
import { opcionesArcoOrganico } from "../../src/lib/globos3d/formas-escena";
import { arcoOrganico } from "../../src/lib/globos3d/escenas-presets";
import { opcionesColumnaOrganica } from "../../src/lib/globos3d/estructuras-organicas";
import { MEZCLA_TRAZO, opcionesTrazoOrganico, puntosDeSilueta } from "../../src/lib/globos3d/trazo-organico";

const archivo = path.join(import.meta.dirname, "datos", "organico-instantanea.json");

const arco = arcoOrganico();
if (arco.tipo !== "arco_organico") throw new Error("se esperaba un arco orgánico");

const festonConColores: OpcionesOrganico = opcionesTrazoOrganico({
  puntos: puntosDeSilueta("feston", { anchoCm: 260, altoCm: 150, grosorCm: 56 }), mezcla: { ...MEZCLA_TRAZO, "R-24": 0.1 }, racimos: 0.4, semilla: 7,
  colores: [
    { codigo: "009", peso: 40, franjas: [{ desde: 0, hasta: 0.6 }] }, { codigo: "570", peso: 35 }, { codigo: "005", peso: 25 },
    { codigo: "390", peso: 20, formatos: ["R-12", "R-18", "R-24"], confeti: true }, { codigo: "009", peso: 30, porFormato: true, formatos: ["R-24"] }, { codigo: "570", peso: 30, porFormato: true, formatos: ["R-24"] },
  ],
});

const conZonas: OpcionesOrganico = opcionesTrazoOrganico({
  puntos: puntosDeSilueta("arco_asimetrico", { anchoCm: 300, altoCm: 200, grosorCm: 60 }), mezcla: MEZCLA_TRAZO, semilla: 21,
  zonas: [{ zona: "abajo", pesos: { "R-24": 0.4 } }], colores: [{ codigo: "009", peso: 50 }, { codigo: "005", peso: 50 }],
});

/** CASE-002: dos columnas orgánicas rosa y plata que nacen del piso y se inclinan 12° una hacia la otra. */
const case002: OpcionesOrganico = opcionesColumnaOrganica({
  altoCm: 240, grosorBaseCm: 70, grosorMedioCm: 62, grosorPuntaCm: 50, inclinacionGrados: 12, curvaInclinacion: 0, par: { separacionCm: 150 }, semilla: 2,
  mezcla: { base: { "R-24": 0.15, "R-18": 0.25, "R-12": 0.45, "R-9": 0.15 }, punta: { "R-18": 0.1, "R-12": 0.55, "R-9": 0.35 } },
  colores: [{ codigo: "011", peso: 55 }, { codigo: "981", peso: 45 }],
});

/** El relleno con tope (`maximo`) y racimitos de cuatro, como lo arma la mezcla leída de una foto. */
const conTope: OpcionesOrganico = opcionesTrazoOrganico({
  puntos: puntosDeSilueta("arco_pared", { anchoCm: 280, altoCm: 170, grosorCm: 52 }), mezcla: { "R-24": 0.1, "R-12": 0.6, "R-5": 0.3 }, racimos: 0.35, semilla: 13,
  relleno: [{ formatoId: "R-12", infladoCm: 22, trios: false }, { formatoId: "R-5", infladoCm: 12, trios: true, racimo: 4, maximo: 30 }],
  colores: [{ codigo: "011", peso: 50 }, { codigo: "981", peso: 50 }],
});

const CASOS: ReadonlyArray<readonly [string, OpcionesOrganico]> = [
  ["arco orgánico", opcionesArcoOrganico(arco.arco)],
  ["columna XV", COLUMNA_QUINCE_AZUL.opciones],
  ["festón con franjas, confeti y colores por formato", festonConColores],
  ["arco asimétrico con zona abajo", conZonas],
  ["CASE-002: par de columnas inclinadas rosa y plata", case002],
  ["arco con relleno de tope (maximo) y racimitos de 4", conTope],
];

const huella = (o: OpcionesOrganico) => {
  olvidarEmpaquesOrganicos();
  const r = armarOrganico(o);
  return { globos: r.globos.length, avisos: r.avisos.length, sha: createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 24) };
};

const actual = Object.fromEntries(CASOS.map(([nombre, o]) => [nombre, huella(o)]));
if (process.argv.includes("--actualizar") || !existsSync(archivo)) {
  writeFileSync(archivo, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`instantánea escrita en ${archivo}`);
} else {
  const guardada = JSON.parse(readFileSync(archivo, "utf8")) as typeof actual;
  for (const [nombre] of CASOS) assert.deepEqual(actual[nombre], guardada[nombre], `${nombre}: el armado cambió respecto de la instantánea`);
  console.log(`✓ ${CASOS.length} piezas idénticas a la instantánea`);
}
