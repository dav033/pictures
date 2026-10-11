/**
 * Integración offline del motor 3D de la vista guiada (REQ-007, fase 6 / W7). Cada caso (las ideas guardadas y las
 * estructuras oficiales) se arma por la fachada `motor/v1`, se cotiza con la réplica de la política de Python
 * (`planearCompra(..., "python")`: el mismo oráculo del informe de paridad; sin red ni Python vivo) y recibe tres ediciones.
 * Cuatro categorías independientes, cada una con su propio recorrido:
 *   A. armado: no lanza, arma igual dos veces, lo que no se representa se dice, y ningún caso pasa a Python sin estar en la foto;
 *   B. precio: la lista se cotiza entera o cada línea sin cobertura queda como `sin_cobertura`; el precio cae a ±10 % de la foto;
 *   C. conteos: las ideas con referencia de Python caen a ±15 % de su razón de hoy;
 *   D. ediciones: cada una hace lo que dice (colores, pesos, un paso de tamaño), o se rechaza con «No pude:» y no cambia nada.
 * La vuelta de un color no se exige exacta: se cuenta (un cambio por nombre puede devolver otro código o fundir dos colores).
 * `FOTO` es el estado medido con el motor 1.2.2. Un caso sin foto falla a propósito: hay que anotarlo antes de aceptarlo.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-motor-guiada-integracion.ts
 */
import assert from "node:assert/strict";
import { casosIdeas, casosOficiales, type CasoMotor } from "../lib/casos-motor-guiada";
import {
  aplicarEdicion, armarDesdeEspec, crosswalkIncluido, EspecClienteV1Schema, planearCompra, PREFIJO_NO_PUDE, VERSION_MOTOR,
  type BomLinea, type EdicionEspecV1, type EspecClienteV1, type ResultadoMotorV1,
} from "../../src/lib/globos3d/motor/v1";
import { presentaciones } from "../../src/lib/globos3d/motor/crosswalk-variantes";

/** Banda por caso alrededor de la razón de hoy (globos del motor / globos del plan guardado de Python). */
const BANDA_RAZON = 0.15;
/** Banda del precio por caso alrededor del precio de hoy (política `python`, snapshot del cruce incluido). */
const BANDA_PRECIO = 0.10;
/** Un paso de tamaño de la edición (+10 % o -10 %) y la holgura del redondeo a la rejilla de globos. */
const PASO_TAMANO = 0.10;
const HOLGURA_METROS = 0.01;
const COLORES_CANDIDATOS = ["dorado", "blanco", "azul", "rosa", "plateado"] as const;
const MEDIDAS = ["anchoM", "altoM", "largoM"] as const;

type Foto = { globos: number; ratio: number | null; precio: number | string | null; noRep: boolean };
/**
 * Medido el 2026-10-09 con el motor 1.2.2. `precio`: política `python`; `noRep`: el motor no arma el caso entero. Los precios
 * se volvieron a medir el 2026-10-10 con D-038: cada globo (talla y color) lleva su propia reserva, cubierta con su diseño en
 * una sola combinación si los repuestos no cuestan de más (`comprarGlobo`).
 */
const FOTO: Record<string, Foto> = {
  "idea-deco-real-01-305": { globos: 112, ratio: 0.772, precio: 34000, noRep: false },
  "idea-deco-real-02-34722b3ec9978bfe7439a121c16a1db7": { globos: 120, ratio: 0.784, precio: 38132, noRep: false },
  "idea-deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1": { globos: 87, ratio: null, precio: null, noRep: true },
  "idea-deco-real-04-71mp5umakml-ac-uf894-1000-ql80": { globos: 115, ratio: 1.139, precio: 176591, noRep: false },
  "idea-deco-real-05-arco-organico-bf3d4c2f-12ab-4c83-a87b-97da3b53ec": { globos: 115, ratio: 1.127, precio: 145608, noRep: false },
  "idea-deco-real-06-columna-globos-alta-colorida-cinta-dorada-sobre-": { globos: 44, ratio: 1, precio: 24350, noRep: false },
  "idea-deco-real-07-eb12910e210c94b6184d025127acce95": { globos: 74, ratio: 0.851, precio: 59404, noRep: false },
  "idea-deco-real-08-images-23": { globos: 90, ratio: 1, precio: 46522, noRep: false },
  "idea-deco-real-09-images-24": { globos: 34, ratio: 0.829, precio: 58369, noRep: false },
  "idea-deco-real-10-images-25": { globos: 79, ratio: 1.082, precio: 132093, noRep: false },
  "idea-deco-real-11-images-26": { globos: 113, ratio: 0.942, precio: 93663, noRep: false },
  "idea-deco-real-12-images-27": { globos: 127, ratio: 1.165, precio: 151131, noRep: false },
  "idea-deco-real-13-images-28": { globos: 111, ratio: 1.088, precio: 115501, noRep: false },
  "idea-deco-real-14-images-29": { globos: 112, ratio: 0.772, precio: 34000, noRep: false },
  "idea-deco-real-15-images-30": { globos: 96, ratio: 1.079, precio: 110792, noRep: false },
  "idea-deco-real-16-images-31": { globos: 93, ratio: 0.979, precio: 80385, noRep: false },
  "idea-deco-real-17-img-2939-1-600x600": { globos: 115, ratio: 1.127, precio: 181975, noRep: false },
  "idea-deco-real-18-sddefault": { globos: 34, ratio: 0.919, precio: 46416, noRep: false },
  "idea-deco-real-19-semiarco-organico-combinaciones-con-reflex-26bbc": { globos: 63, ratio: 1.086, precio: 104762, noRep: false },
  "idea-deco-real-20-semiarcoilusionazul-1200x1200": { globos: 45, ratio: 1.023, precio: 50103, noRep: false },
  "idea-deco-real-22-guirnalda-san-valentin": { globos: 63, ratio: 1.068, precio: 67820, noRep: false },
  "idea-deco-real-24-guirnalda-verde-salvia-flores": { globos: 52, ratio: 1.02, precio: 17000, noRep: false },
  "idea-deco-real-25-guirnalda-dia-de-la-madre": { globos: 52, ratio: 0.813, precio: 22323, noRep: false },
  "idea-deco-real-27-aro-navideno-verde-salvia": { globos: 0, ratio: null, precio: null, noRep: true },
  "idea-deco-real-28-aro-blanco-dorado-y-nude": { globos: 105, ratio: 1.117, precio: 66834, noRep: false },
  "idea-deco-real-29-arco-link-o-loon-fucsia-tulipanes": { globos: 32, ratio: 1.067, precio: 11889, noRep: false },
  "idea-deco-real-30-columna-balon-futbol": { globos: 72, ratio: 1.2, precio: 51554, noRep: false },
  "idea-deco-real-31-arco-futbol-balones-gigantes": { globos: 105, ratio: 1.4, precio: 71558, noRep: false },
  "oficial-arco": { globos: 128, ratio: null, precio: 58035, noRep: false },
  "oficial-arco_asimetrico": { globos: 117, ratio: null, precio: 95656, noRep: false },
  "oficial-arco_no_denso": { globos: 96, ratio: null, precio: 102503, noRep: false },
  "oficial-semiarco": { globos: 53, ratio: null, precio: 75137, noRep: false },
  "oficial-semiarco_asimetrico": { globos: 57, ratio: null, precio: 96458, noRep: false },
  "oficial-columna": { globos: 36, ratio: null, precio: 20890, noRep: false },
  "oficial-columna_asimetrica": { globos: 42, ratio: null, precio: 57814, noRep: false },
  "oficial-columna_no_densa": { globos: 20, ratio: null, precio: 54508, noRep: false },
  "oficial-pared_densa": { globos: 181, ratio: null, precio: "sin_cobertura", noRep: false },
  "oficial-pared_no_densa": { globos: 0, ratio: null, precio: null, noRep: true },
  "oficial-pared_organica": { globos: 0, ratio: null, precio: null, noRep: true },
  "oficial-guirnalda": { globos: 46, ratio: null, precio: 65013, noRep: false },
  "oficial-centro_mesa": { globos: 0, ratio: null, precio: null, noRep: true },
  "oficial-bouquet": { globos: 7, ratio: null, precio: 16758, noRep: false },
  "oficial-figura": { globos: 0, ratio: null, precio: null, noRep: true },
  "oficial-aro_circular": { globos: 84, ratio: null, precio: 43748, noRep: false },
  "oficial-techo_globos": { globos: 48, ratio: null, precio: 29722, noRep: false },
  "oficial-racimo_pared": { globos: 9, ratio: null, precio: 16758, noRep: false },
};

const cruce = crosswalkIncluido();
const casos: CasoMotor[] = [...casosIdeas(), ...casosOficiales()];
const ideas = casosIdeas();
const ideaDe = (ideaId: string): EspecClienteV1 | null => ideas.find((k) => k.id === `idea-${ideaId}`)?.espec ?? null;
const unidades = (lineas: readonly BomLinea[]) => lineas.reduce((s, l) => s + l.cantidad, 0);
const huella = (r: ResultadoMotorV1) => JSON.stringify({ hash: r.especHash, total: r.bom.total, noRep: r.noRepresentable });

function fotoDe(caso: CasoMotor): Foto {
  const foto = FOTO[caso.id];
  assert.ok(foto, `${caso.id}: no está en la foto de hoy; anótalo a propósito antes de aceptarlo`);
  return foto;
}

/** Cotiza con la política de Python: cada línea cubierta, o `sin_cobertura` con su motivo. */
function cotizar(bom: readonly BomLinea[]): { precio: number | null; sinCobertura: string[] } {
  const plan = planearCompra(bom, cruce, "python");
  if (!plan.ok) return { precio: null, sinCobertura: plan.faltantes.map((f) => `${f.formatoId} ${f.codigo}: ${f.motivo}`) };
  return { precio: Math.round(plan.compras.reduce((s, c) => s + c.paquetes * c.variante.precio, 0)), sinCobertura: [] };
}

/** Las tres ediciones de un caso: color, tamaño y proporción (o un segundo color si la pieza trae uno solo). */
function ediciones(espec: EspecClienteV1): Array<{ nombre: string; edicion: EdicionEspecV1; inversa: EdicionEspecV1 | null }> {
  const pieza = espec.piezas.find((p) => p.colores.length >= 2) ?? espec.piezas[0]!;
  const de = pieza.colores[0]!.nombre;
  const a = COLORES_CANDIDATOS.find((c) => !espec.piezas.some((p) => p.colores.some((k) => k.nombre === c))) ?? "dorado";
  const tamano = espec.piezas.find((p) => p.medidas.anchoM !== undefined || p.medidas.largoM !== undefined) ?? espec.piezas[0]!;
  const proporcion: EdicionEspecV1 = pieza.colores.length >= 2
    ? { op: "proporcion_color", pieza: pieza.id, pesos: pieza.colores.map((_, i) => (i === 0 ? 2 : 1)) }
    : { op: "mas_menos_color", color: de, direccion: 1, piezas: [pieza.id] };
  return [
    { nombre: "reemplazar_color", edicion: { op: "reemplazar_color", de, a }, inversa: { op: "reemplazar_color", de: a, a: de } },
    { nombre: "tamano_pieza", edicion: { op: "tamano_pieza", pieza: tamano.id, direccion: 1 }, inversa: { op: "tamano_pieza", pieza: tamano.id, direccion: -1 } },
    { nombre: proporcion.op, edicion: proporcion, inversa: null },
  ];
}

function categoria(nombre: string, prueba: () => void): void {
  try { prueba(); console.log(`[PASS] ${nombre}`); } catch (error) { console.error(`[FAIL] ${nombre}`); throw error; }
}

categoria("A. armado: no lanza, determinista, lo no representable se dice y no crece la lista de Python", () => {
  const ids = new Set(casos.map((c) => c.id));
  for (const id of Object.keys(FOTO)) assert.ok(ids.has(id), `la foto anota ${id}, que ya no existe`);
  let noRepresentables = 0;
  for (const c of casos) {
    const r1 = armarDesdeEspec(c.espec);
    assert.equal(huella(r1), huella(armarDesdeEspec(c.espec)), `${c.id}: armar dos veces da otro resultado`);
    assert.equal(r1.motor.version, VERSION_MOTOR);
    const noRep = r1.noRepresentable.length > 0;
    assert.equal(noRep, fotoDe(c).noRep, `${c.id}: cambió si el motor lo arma entero`);
    if (noRep) {
      noRepresentables += 1;
      assert.ok(r1.noRepresentable.every((n) => n.motivo.length > 10), `${c.id}: un no representable sin motivo`);
    } else assert.ok(unidades(r1.bom.total) > 0, `${c.id}: arma sin globos y sin motivo`);
  }
  const hoy = Object.values(FOTO).filter((f) => f.noRep).length;
  assert.ok(noRepresentables <= hoy, `${noRepresentables} casos caen a Python; hoy son ${hoy}`);
  console.log(`      caen a Python: ${noRepresentables} de ${casos.length} (hoy ${hoy}; lista en FOTO con noRep)`);
});

categoria("B. precio: lista cotizada entera o sin_cobertura declarado, y precio a ±10 % de la foto", () => {
  for (const c of casos) {
    const r = armarDesdeEspec(c.espec);
    if (r.noRepresentable.length > 0) continue;
    const cot = cotizar(r.bom.total);
    const sinCruce = r.bom.total.filter((l) => !presentaciones(cruce, l.formatoId, l.codigo).ok).length;
    assert.equal(sinCruce, cot.sinCobertura.length, `${c.id}: ${sinCruce} líneas sin cruce, la cotización reporta ${cot.sinCobertura.length}`);
    const foto = fotoDe(c);
    if (typeof foto.precio === "string") {
      assert.equal(cot.precio, null, `${c.id}: hoy es sin_cobertura y ahora cotiza`);
      assert.ok(cot.sinCobertura.every((m) => m.length > 10), `${c.id}: sin cobertura sin motivo`);
    } else {
      assert.notEqual(cot.precio, null, `${c.id}: hoy cotiza y ahora no`);
      const desvio = Math.abs(cot.precio! - foto.precio!) / foto.precio!;
      assert.ok(desvio <= BANDA_PRECIO, `${c.id}: precio ${cot.precio} contra ${foto.precio} (${Math.round(desvio * 100)} %), fuera de ±${BANDA_PRECIO * 100} %`);
    }
  }
});

categoria("C. conteos: ideas con referencia de Python a ±15 % de su razón de hoy", () => {
  for (const c of casos) {
    if (c.globosPython === undefined) continue;
    const r = armarDesdeEspec(c.espec);
    if (r.noRepresentable.length > 0) continue;
    const foto = fotoDe(c);
    assert.ok(foto.ratio !== null, `${c.id}: la foto no tiene razón`);
    const ratio = unidades(r.bom.total) / c.globosPython;
    const desvio = Math.abs(ratio - foto.ratio!) / foto.ratio!;
    assert.ok(desvio <= BANDA_RAZON, `${c.id}: razón ${ratio.toFixed(3)} contra ${foto.ratio} (${Math.round(desvio * 100)} %), fuera de ±${BANDA_RAZON * 100} %`);
  }
});

categoria("D. ediciones: cada una hace lo que dice, o se rechaza con «No pude:»; un paso de tamaño no se duplica", () => {
  let agrandadosEnTope = 0;
  let coloresQueNoVuelven = 0;
  let coloresFundidos = 0;
  let derivaMaxima = 0;
  for (const c of casos) {
    for (const { nombre, edicion, inversa } of ediciones(c.espec)) {
      const res = aplicarEdicion(c.espec, edicion, { idea: ideaDe });
      if (res.noAplicado) {
        assert.ok(res.noAplicado.startsWith(PREFIJO_NO_PUDE), `${c.id} ${nombre}: rechazo sin «No pude:»`);
        assert.deepEqual(res.espec, c.espec, `${c.id} ${nombre}: un rechazo cambió la espec`);
        continue;
      }
      assert.ok(EspecClienteV1Schema.safeParse(res.espec).success, `${c.id} ${nombre}: la espec editada no valida`);
      const armada = armarDesdeEspec(res.espec);
      assert.equal(huella(armada), huella(armarDesdeEspec(res.espec)), `${c.id} ${nombre}: la edición no arma igual dos veces`);
      const viaje = EspecClienteV1Schema.parse(JSON.parse(JSON.stringify(res.espec)));
      assert.equal(armarDesdeEspec(viaje).especHash, armada.especHash, `${c.id} ${nombre}: la espec no sobrevive al viaje por JSON`);

      if (nombre === "reemplazar_color") {
        const de = (edicion as { de: string }).de;
        for (const p of res.espec.piezas) assert.ok(!p.colores.some((k) => k.nombre === de), `${c.id}: queda «${de}» tras reemplazarlo`);
      }

      if (nombre === "proporcion_color") {
        const { pieza: id, pesos } = edicion as { pieza: string; pesos: number[] };
        const editada = res.espec.piezas.find((p) => p.id === id)!;
        const original = c.espec.piezas.find((p) => p.id === id)!;
        const suma = pesos.reduce((s, x) => s + x, 0);
        editada.colores.forEach((k, i) => {
          assert.equal(k.codigo, original.colores[i]!.codigo, `${c.id}: la proporción cambió el orden de los colores`);
          assert.ok(Math.abs(k.peso - pesos[i]! / suma) <= 0.001, /* el motor redondea los pesos a tres cifras */ `${c.id}: el color ${i} pesa ${k.peso}, debía ${pesos[i]! / suma}`);
        });
      }

      if (nombre === "tamano_pieza") {
        const id = (edicion as { pieza: string }).pieza;
        const antes = c.espec.piezas.find((p) => p.id === id)!;
        const despues = res.espec.piezas.find((p) => p.id === id)!;
        for (const m of MEDIDAS) {
          const a0 = antes.medidas[m];
          const a1 = despues.medidas[m];
          if (a0 === undefined) continue;
          assert.ok(a1 !== undefined && a1 >= a0 - 1e-9 && a1 <= a0 * (1 + PASO_TAMANO) + HOLGURA_METROS, `${c.id}: agrandar ${m} ${a0} dio ${a1}: más de un paso`);
          if (a1 < a0 * (1 + PASO_TAMANO) - HOLGURA_METROS) agrandadosEnTope += 1;
        }
        if (inversa) {
          const back = aplicarEdicion(res.espec, inversa, { idea: ideaDe });
          assert.ok(!back.noAplicado, `${c.id}: la inversa de tamaño se rechaza`);
          const vuelta = back.espec.piezas.find((p) => p.id === id)!;
          for (const m of MEDIDAS) {
            const a0 = antes.medidas[m];
            const b0 = vuelta.medidas[m];
            if (a0 === undefined) continue;
            assert.ok(b0 !== undefined && Math.abs(b0 - a0) <= a0 * PASO_TAMANO + HOLGURA_METROS, `${c.id}: ${m} ${a0} vuelve como ${b0}: deriva de más de un paso`);
            derivaMaxima = Math.max(derivaMaxima, Math.abs(b0 - a0) / a0);
          }
        }
      }

      if (nombre === "reemplazar_color" && inversa) {
        const vuelta = aplicarEdicion(res.espec, inversa, { idea: ideaDe }).espec;
        for (const p of vuelta.piezas) {
          const original = c.espec.piezas.find((k) => k.id === p.id)!;
          assert.ok(p.colores.length <= original.colores.length, `${c.id}: la vuelta de color añade colores`);
          if (p.colores.length < original.colores.length) coloresFundidos += 1;
          if (p.colores.map((k) => k.codigo).join() !== original.colores.map((k) => k.codigo).join()) coloresQueNoVuelven += 1;
        }
      }
    }
  }
  console.log(`      informe: agrandados que tocan el tope ${agrandadosEnTope}; deriva máxima de la vuelta de tamaño ${(derivaMaxima * 100).toFixed(1)} %; vueltas de color con código distinto ${coloresQueNoVuelven} y con fusión ${coloresFundidos} (por pieza)`);
});

console.log(`test-motor-guiada-integracion: ok (${casos.length} casos, motor ${VERSION_MOTOR})`);
