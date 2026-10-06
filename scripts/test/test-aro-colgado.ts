/**
 * Auditoría de propiedades huérfanas (2026-10-06, CASE-007): el análisis lee bien un aro colgado de la pared
 * (`hoop` con `grounded` false, 6 de 6 corridas), pero `grounded` no llegaba a nada: el aro iba a `arco_central`,
 * la guía lo ponía de pie con su poste y la franja de piso subía hasta la mitad del lienzo.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-aro-colgado.ts
 */
import assert from "node:assert/strict";
import { parseDetectedStructure, referenceStructureSemantics, reubicarAros } from "@/lib/ia/referencia/reference-structure";
import { aroColgadoEnLaFoto, instanciasDeEscena } from "@/lib/ia/kagutsuchi/guia-escena";
import { datosDePiezas } from "@/lib/ia/kagutsuchi/preparar-guia-escena";

const CAJA = { x: 0.55, y: 0.05, width: 0.4, height: 0.45 };
const semantica = (grounded: boolean) => referenceStructureSemantics([
  { elementId: "E1", bbox: CAJA, structure: parseDetectedStructure({ structure_type: "hoop", horizontal_position: "right", relative_height: "tall", curves_toward: "none", outline: "symmetric", density: "medium", grounded })! },
], "moderate").get("E1")!;

// 1. La detección: colgado va a la pared; de pie, como siempre, al centro.
assert.equal(semantica(false).placement, "fondo_pared");
assert.equal(semantica(true).placement, "arco_central");
assert.equal(semantica(false).structure_type, "arco");

// 2. `reubicarAros`: con el fondo de la foto ocupado (un backdrop) el aro vuelve al centro; libre, se queda.
type Blueprint = Parameters<typeof reubicarAros>[0];
const elemento = (id: string, category: string, visual?: object) => ({ element_id: id, source_image_id: "REF_01", category, approved: true, ...(visual ? { visual_semantics: visual } : {}) });
const aro = elemento("E1", "balloon_structure", { ...semantica(false) });
const libre = { elements: [aro] } as unknown as Blueprint;
assert.equal(reubicarAros(libre), libre, "sin otro fondo no cambia nada");
const ocupado = reubicarAros({ elements: [aro, elemento("E2", "backdrop")] } as unknown as Blueprint);
assert.equal(ocupado.elements[0]!.visual_semantics!.placement, "arco_central", "el plan admite una sola pieza en fondo_pared");

// 3. La guía: el aro colgado se apoya en la pared por la foto, no por la ubicación del plan.
type Estructuras = Parameters<typeof instanciasDeEscena>[0];
type Foto = NonNullable<Parameters<typeof instanciasDeEscena>[1]>;
const foto = { source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }], elements: [{ ...aro, reference_bbox: CAJA }] } as unknown as Foto;
assert.ok(aroColgadoEnLaFoto(foto.elements[0]!));
const plan = (ubicacion: string, referencia?: string) => [{ estructura_id: "EST_02_ARO", tipo: "arco", estructura_oficial: "aro_circular", ubicacion, repeticiones: 1, materiales: [], medidas: {}, ...(referencia ? { referencia_element_id: referencia } : {}) }] as unknown as Estructuras;
assert.equal(instanciasDeEscena(plan("fondo_pared", "E1"), foto)[0]!.apoyo, "pared");
// Un aro de pie contra la pared del fondo, sin elemento colgado en la foto, sigue de pie.
assert.equal(instanciasDeEscena(plan("fondo_pared"), undefined)[0]!.apoyo, "piso");

// 4. Python recibe `colgada` solo para ese aro.
type PlanResuelto = Parameters<typeof datosDePiezas>[0];
// La resolución publica cada estructura con su tipo (`PlanResuelto.estructuras[]`).
const resuelto = (estructuras: Estructuras) => ({ plan: { estructuras }, estructuras: (estructuras as unknown as Array<{ estructura_id: string; tipo: string }>).map((e) => ({ estructura_id: e.estructura_id, tipo: e.tipo, mezcla_real: [], lineas: [] })) }) as unknown as PlanResuelto;
const conFoto = plan("fondo_pared", "E1");
assert.equal(datosDePiezas(resuelto(conFoto), instanciasDeEscena(conFoto, foto), { ancho: 1024, alto: 683 })[0]!.colgada, true);
const sinFoto = plan("fondo_pared");
assert.equal(datosDePiezas(resuelto(sinFoto), instanciasDeEscena(sinFoto, undefined), { ancho: 1024, alto: 683 })[0]!.colgada, undefined);

console.log("test-aro-colgado: OK");
