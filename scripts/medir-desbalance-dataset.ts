/**
 * La medición que hace falta ANTES de decidir un reentrenamiento.
 *
 * El informe de rechazo de v007 es específico: color 6/6, acabado 0/6, diámetro
 * 0/6. La hipótesis del plan es que los dos fallos son propiedades del dataset y
 * no de los hiperparámetros, y que confirmarlo o descartarlo cuesta contar, no
 * entrenar:
 *
 *  - ACABADO. Si casi ninguna imagen es mate, el modelo nunca vio el contraste
 *    mate/cromado y no hay hiperparámetro que lo arregle.
 *  - DIÁMETRO. "5 y 24 pulgadas se ven iguales" es lo esperable cuando el
 *    diámetro solo aparece como texto y no hay contraste de tamaño DENTRO de una
 *    misma imagen que le dé escala.
 *
 * Reentrenar sin este número es gastar US$40 a ciegas. Re-captionar es barato y
 * re-recolectar es caro, y cuál toca depende de qué diga esto.
 *
 *   npx tsx --conditions=react-server scripts/medir-desbalance-dataset.ts
 *   npx tsx --conditions=react-server scripts/medir-desbalance-dataset.ts --anotaciones <dir>
 *
 * Sin red, sin proveedor, sin coste.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DIRECTORIO_POR_DEFECTO = path.join("data", "staging", "lora-v007", "anotaciones");

/** Acabados que el vocabulario distingue, deducidos del segmento del concept id. */
const ACABADOS = ["fashion", "pastel_matte", "reflex", "crystal", "metallic", "neon", "chrome", "pearl", "satin"] as const;

/** Acabados que se leen como mate en una foto. El resto reflejan. */
const MATES = new Set(["fashion", "pastel_matte"]);

function diametroDeCodigo(codigo: string): number | null {
  const encontrado = /^R-(\d+)$/i.exec(codigo.trim());
  return encontrado ? Number(encontrado[1]) : null;
}

function acabadoDeConcepto(conceptId: string): string {
  const partes = conceptId.split(".");
  return ACABADOS.find((acabado) => partes.includes(acabado)) ?? "desconocido";
}

type Anotacion = {
  anotacion?: { usable?: boolean; structures?: Array<{ visible_sizes?: Array<{ concept_id?: string; size_code?: string }>; visible_concept_ids?: string[]; size_relation?: string }> };
};

async function main(): Promise<void> {
  const indice = process.argv.indexOf("--anotaciones");
  const directorio = indice >= 0 ? process.argv[indice + 1] ?? DIRECTORIO_POR_DEFECTO : DIRECTORIO_POR_DEFECTO;
  const archivos = (await readdir(directorio)).filter((nombre) => nombre.endsWith(".json"));
  if (archivos.length === 0) {
    console.error(`sin anotaciones en ${directorio}`);
    process.exit(1);
  }

  const porAcabado = new Map<string, number>();
  let imagenesUsables = 0;
  let imagenesConMate = 0;
  let imagenesSoloMate = 0;
  let imagenesConContrasteAcabado = 0;
  const diametrosPorImagen: number[][] = [];
  const relaciones = new Map<string, number>();

  for (const archivo of archivos) {
    const datos = JSON.parse(await readFile(path.join(directorio, archivo), "utf-8")) as Anotacion;
    const anotacion = datos.anotacion;
    if (!anotacion?.usable) continue;
    imagenesUsables += 1;

    const acabados = new Set<string>();
    const diametros: number[] = [];
    for (const estructura of anotacion.structures ?? []) {
      relaciones.set(estructura.size_relation ?? "sin_relacion", (relaciones.get(estructura.size_relation ?? "sin_relacion") ?? 0) + 1);
      for (const conceptId of estructura.visible_concept_ids ?? []) {
        const acabado = acabadoDeConcepto(conceptId);
        acabados.add(acabado);
        porAcabado.set(acabado, (porAcabado.get(acabado) ?? 0) + 1);
      }
      for (const talla of estructura.visible_sizes ?? []) {
        const diametro = diametroDeCodigo(talla.size_code ?? "");
        if (diametro !== null) diametros.push(diametro);
      }
    }
    const mates = [...acabados].filter((acabado) => MATES.has(acabado));
    const brillantes = [...acabados].filter((acabado) => acabado !== "desconocido" && !MATES.has(acabado));
    if (mates.length) imagenesConMate += 1;
    if (mates.length && brillantes.length === 0) imagenesSoloMate += 1;
    if (mates.length && brillantes.length) imagenesConContrasteAcabado += 1;
    if (diametros.length) diametrosPorImagen.push(diametros);
  }

  const pct = (parte: number, total: number) => `${((parte / total) * 100).toFixed(0)} %`;

  console.log(`imágenes usables: ${imagenesUsables} de ${archivos.length}\n`);

  console.log("ACABADO — ¿vio el modelo el contraste mate/brillante?");
  console.log(`  imágenes con algún mate:        ${imagenesConMate} (${pct(imagenesConMate, imagenesUsables)})`);
  console.log(`  imágenes SOLO mate:             ${imagenesSoloMate} (${pct(imagenesSoloMate, imagenesUsables)})`);
  console.log(`  imágenes con los dos a la vez:  ${imagenesConContrasteAcabado} (${pct(imagenesConContrasteAcabado, imagenesUsables)})`);
  console.log("  reparto por acabado (apariciones por estructura):");
  for (const [acabado, veces] of [...porAcabado.entries()].sort((uno, otro) => otro[1] - uno[1])) {
    console.log(`    ${acabado.padEnd(14)} ${String(veces).padStart(5)}`);
  }

  // Un solo diámetro en toda la imagen no le enseña escala a nada: el modelo no
  // tiene con qué comparar, y es exactamente el fallo 0/6 que reportó v007.
  const conContraste = diametrosPorImagen.filter((lista) => new Set(lista).size > 1);
  const rangos = diametrosPorImagen.map((lista) => Math.max(...lista) / Math.min(...lista));
  const rangoAmplio = rangos.filter((razon) => razon >= 2).length;
  console.log("\nDIÁMETRO — ¿hay contraste de tamaño DENTRO de una imagen?");
  console.log(`  imágenes con tallas anotadas:   ${diametrosPorImagen.length}`);
  console.log(`  con más de un diámetro:         ${conContraste.length} (${pct(conContraste.length, diametrosPorImagen.length)})`);
  console.log(`  con razón máx/mín ≥ 2:          ${rangoAmplio} (${pct(rangoAmplio, diametrosPorImagen.length)})`);
  console.log("  reparto de `size_relation` por estructura:");
  for (const [relacion, veces] of [...relaciones.entries()].sort((uno, otro) => otro[1] - uno[1])) {
    console.log(`    ${relacion.padEnd(16)} ${String(veces).padStart(5)}`);
  }

  console.log("\nLECTURA. El acabado es reentrenable con re-caption solo si el contraste");
  console.log("mate/brillante YA está en las imágenes; si no lo está, hace falta recolectar.");
  console.log("El diámetro es re-captionable si el contraste de tamaño ya está en la imagen");
  console.log("y solo falta nombrarlo como RELACIÓN; si tampoco está, hace falta muestrear.");
}

void main();
