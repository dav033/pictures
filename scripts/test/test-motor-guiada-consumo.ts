/**
 * El registro de propiedades huérfanas de la espec (`motor/consumo.ts`). Sin coste.
 * - compilación: un campo nuevo de `EspecClienteV1` sin declarar en `CONSUMO` no compila (el `@ts-expect-error` de abajo
 *   falla si dejara de pasar), y `RutaHoja` no se queda corta;
 * - ejecución: las hojas de `CONSUMO` son exactamente las hojas del esquema exportado (`espec-cliente.v1`);
 * - mutación: cada campo declarado `escena` o `bom` CAMBIA el resultado del motor cuando cambia; los `ui` y `flux`
 *   cambian al menos el hash. Un campo que el motor ignora sin decirlo se atrapa aquí.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { CONSUMO, type RutaHoja } from "../../src/lib/globos3d/motor/consumo";
import { EspecClienteV1Schema, type EspecClienteV1, type PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { jsonEstable } from "../../src/lib/globos3d/motor/hash-espec";
import { armarDesdeEspec } from "../../src/lib/globos3d/motor/v1";
import { CAMPOS_ESTRUCTURA_PLAN } from "../../src/lib/globos3d/motor/consumo-conversiones";

// Compilación. `Faltan` es lo que el esquema tiene y el registro no: debe ser vacío.
type Faltan<T> = Exclude<RutaHoja<T>, keyof typeof CONSUMO>;
const sinFaltantes: [Faltan<EspecClienteV1>] extends [never] ? true : false = true;
type ConUnCampoNuevo = EspecClienteV1 & { piezas: Array<PiezaEspec & { campoNuevo: string }> };
// @ts-expect-error un campo nuevo que nadie declaró en CONSUMO deja una hoja sin destino
const conFaltantes: [Faltan<ConUnCampoNuevo>] extends [never] ? true : false = true;
void sinFaltantes; void conFaltantes;

// Ejecución: las hojas del registro son las del esquema exportado.
function hojasDe(esquema: Record<string, unknown>, ruta = ""): string[] {
  const alternativas = (esquema.anyOf as Array<Record<string, unknown>> | undefined)?.filter((x) => x.type !== "null");
  if (alternativas?.length === 1) return hojasDe(alternativas[0]!, ruta);
  if (esquema.type === "array") return hojasDe(esquema.items as Record<string, unknown>, ruta);
  if (esquema.type === "object") return Object.entries(esquema.properties as Record<string, Record<string, unknown>>).flatMap(([clave, hijo]) => hojasDe(hijo, ruta ? `${ruta}.${clave}` : clave));
  return [ruta];
}
const hojas = hojasDe(z.toJSONSchema(EspecClienteV1Schema, { target: "draft-7" }) as Record<string, unknown>).sort();
assert.deepEqual(Object.keys(CONSUMO).sort(), hojas, "CONSUMO debe declarar exactamente las hojas de la espec");
for (const [ruta, destino] of Object.entries(CONSUMO) as Array<[string, unknown]>) {
  if (typeof destino === "object" && destino !== null) assert.ok(String((destino as { ignorado: string }).ignorado).length >= 15, `${ruta}: el motivo de ignorarlo debe estar dicho`);
}
for (const [campo, uso] of Object.entries(CAMPOS_ESTRUCTURA_PLAN)) if (typeof uso === "object") assert.ok(uso.ignorado.length >= 15, `plan.${campo}: falta el motivo`);

// Mutación.
const AZUL = [{ codigo: "040", nombre: "azul", peso: 0.6 }, { codigo: "012", nombre: "fucsia", peso: 0.4 }];
const de = (...piezas: PiezaEspec[]): EspecClienteV1 => ({ version: "espec-cliente.v1", origen: { tipo: "propuesta" }, piezas });
const p = (parcial: Partial<PiezaEspec> & Pick<PiezaEspec, "id" | "oficial">): PiezaEspec => ({ nombre: "Pieza", lugar: "centro", medidas: {}, colores: AZUL, tamanos: "organica_fina", densidad: "lujosa", ...parcial });
const huella = (e: EspecClienteV1) => { const r = armarDesdeEspec(e); return jsonEstable({ bom: r.bom, armada: r.armada, noRepresentable: r.noRepresentable }); };
const hash = (e: EspecClienteV1) => armarDesdeEspec(e).especHash;
const sobre = (e: EspecClienteV1, cambios: Partial<PiezaEspec>): EspecClienteV1 => ({ ...e, piezas: e.piezas.map((x, i) => (i === 0 ? { ...x, ...cambios } : x)) });

const ARCO = de(p({ id: "EST_01_ARCO", oficial: "arco_asimetrico", medidas: { anchoM: 3, altoM: 2.4, grosorM: 0.7 } }));
const SEMIARCO = de(p({ id: "EST_01_SEMIARCO", oficial: "semiarco", medidas: { anchoM: 1.5, altoM: 2.2, grosorM: 0.6 } }));
const COLUMNA = de(p({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", medidas: { altoM: 2 } }));
const GUIRNALDA = de(p({ id: "EST_01_GUIRNALDA", oficial: "guirnalda", lugar: "fondo", medidas: { largoM: 2.5 } }));
const ARO = de(p({ id: "EST_01_ARO", oficial: "aro_circular", forma: "organico", medidas: { anchoM: 1.8 } }));
const BOUQUET = de(p({ id: "EST_01_BOUQUET", oficial: "bouquet", lugar: "mesa", tamanos: "clasica", unidades: 6 }));
const FIGURA = de(p({ id: "EST_01_FIGURA", oficial: "figura", declarada: { motivo: "Contada del catálogo.", materiales: [{ formatoId: "R-12", codigo: "061", cantidad: 10 }] } }));
const conFlores = (flores: PiezaEspec["flores"]) => sobre(ARCO, { flores });
const FLORES = { cantidad: 3, petalos: 4, codigo: "009", centro: "970" };

type Mutacion = [EspecClienteV1, EspecClienteV1];
const MUTACIONES: Record<keyof typeof CONSUMO, Mutacion> = {
  version: [ARCO, ARCO],
  "origen.tipo": [ARCO, { ...ARCO, origen: { tipo: "idea" } }],
  "origen.ideaIds": [ARCO, { ...ARCO, origen: { tipo: "idea", ideaIds: ["deco-real-01"] } }],
  "piezas.id": [ARCO, sobre(ARCO, { id: "EST_01_OTRO" })],
  "piezas.oficial": [ARCO, sobre(ARCO, { oficial: "arco" })],
  "piezas.nombre": [ARCO, sobre(ARCO, { nombre: "Otro nombre" })],
  "piezas.lugar": [ARCO, sobre(ARCO, { lugar: "derecha" })],
  "piezas.medidas.anchoM": [ARCO, sobre(ARCO, { medidas: { anchoM: 3.6, altoM: 2.4, grosorM: 0.7 } })],
  "piezas.medidas.altoM": [ARCO, sobre(ARCO, { medidas: { anchoM: 3, altoM: 2.8, grosorM: 0.7 } })],
  "piezas.medidas.largoM": [GUIRNALDA, sobre(GUIRNALDA, { medidas: { largoM: 3.5 } })],
  "piezas.medidas.grosorM": [ARCO, sobre(ARCO, { medidas: { anchoM: 3, altoM: 2.4, grosorM: 0.5 } })],
  "piezas.colores.codigo": [ARCO, sobre(ARCO, { colores: [{ codigo: "040", nombre: "azul", peso: 0.6 }, { codigo: "015", nombre: "fucsia", peso: 0.4 }] })],
  "piezas.colores.nombre": [ARCO, sobre(ARCO, { colores: [{ codigo: "040", nombre: "celeste", peso: 0.6 }, { codigo: "012", nombre: "fucsia", peso: 0.4 }] })],
  "piezas.colores.peso": [ARCO, sobre(ARCO, { colores: [{ codigo: "040", nombre: "azul", peso: 0.9 }, { codigo: "012", nombre: "fucsia", peso: 0.1 }] })],
  "piezas.tamanos": [ARCO, sobre(ARCO, { tamanos: "solo_grandes" })],
  "piezas.densidad": [SEMIARCO, sobre(SEMIARCO, { densidad: "sencilla" })],
  "piezas.forma": [ARO, sobre(ARO, { forma: "parcial" })],
  "piezas.flores.cantidad": [conFlores(FLORES), conFlores({ ...FLORES, cantidad: 5 })],
  "piezas.flores.petalos": [conFlores(FLORES), conFlores({ ...FLORES, petalos: 6 })],
  "piezas.flores.codigo": [conFlores(FLORES), conFlores({ ...FLORES, codigo: "012" })],
  "piezas.flores.centro": [conFlores(FLORES), conFlores({ ...FLORES, centro: "005" })],
  "piezas.unidades": [BOUQUET, sobre(BOUQUET, { unidades: 9 })],
  "piezas.capas": [COLUMNA, sobre(COLUMNA, { capas: 11 })],
  "piezas.remate.formatoId": [sobre(COLUMNA, { remate: { formatoId: "R-36", codigo: "970" } }), sobre(COLUMNA, { remate: { formatoId: "R-24", codigo: "970" } })],
  "piezas.remate.codigo": [sobre(COLUMNA, { remate: { formatoId: "R-36", codigo: "970" } }), sobre(COLUMNA, { remate: { formatoId: "R-36", codigo: "080" } })],
  "piezas.declarada.materiales.formatoId": [FIGURA, sobre(FIGURA, { declarada: { motivo: "Contada del catálogo.", materiales: [{ formatoId: "R-9", codigo: "061", cantidad: 10 }] } })],
  "piezas.declarada.materiales.codigo": [FIGURA, sobre(FIGURA, { declarada: { motivo: "Contada del catálogo.", materiales: [{ formatoId: "R-12", codigo: "080", cantidad: 10 }] } })],
  "piezas.declarada.materiales.cantidad": [FIGURA, sobre(FIGURA, { declarada: { motivo: "Contada del catálogo.", materiales: [{ formatoId: "R-12", codigo: "061", cantidad: 12 }] } })],
  "piezas.declarada.motivo": [FIGURA, sobre(FIGURA, { declarada: { motivo: "Otro motivo distinto.", materiales: [{ formatoId: "R-12", codigo: "061", cantidad: 10 }] } })],
};

for (const [ruta, destino] of Object.entries(CONSUMO) as Array<[keyof typeof CONSUMO, unknown]>) {
  const [antes, despues] = MUTACIONES[ruta];
  if (ruta === "version") continue; // el literal solo lo mira el esquema: no hay con qué mutarlo
  if (destino === "escena" || destino === "bom") {
    assert.notEqual(huella(antes), huella(despues), `${ruta} dice que va a «${String(destino)}» pero cambiarlo no mueve ni la lista ni el dibujo: es una propiedad huérfana`);
  } else if (destino === "ui" || destino === "flux") {
    assert.notEqual(hash(antes), hash(despues), `${ruta}: ni el hash se entera`);
  }
}

console.log(`test-motor-guiada-consumo: ok (${hojas.length} hojas declaradas y mutadas)`);
