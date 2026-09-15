import { familiaDesdeClaseOficial } from "./familia-clase";
import type { InstanciaPrediccion, PrediccionEstructurasV1 } from "./prediccion";

/**
 * Directional comparison of recognizer runs against the folder class chosen by
 * one person while collecting (Plan A validation before gold). It is NOT an
 * accuracy metric: the folder is an unreviewed curation hint. Pure function.
 */

const area = (instancia: InstanciaPrediccion) => instancia.bbox.width * instancia.bbox.height;
const esOrganica = (clase: string) => /_organic[oa]$/.test(clase);

export type ResumenCarpeta = ReturnType<typeof compararConCarpeta>;

export function compararConCarpeta(lineas: readonly PrediccionEstructurasV1[], etiquetas: Readonly<Record<string, string>>) {
  const ok = lineas.filter((linea) => linea.resultado === "ok" && etiquetas[linea.image_sha256]);
  const porImagen = new Map<string, PrediccionEstructurasV1[]>();
  for (const linea of ok) porImagen.set(linea.image_sha256, [...(porImagen.get(linea.image_sha256) ?? []), linea]);

  type Acumulado = { imagenes: number; corridas: number; sin_estructura: number; familia_presente: number; familia_principal: number; contorno_asimetrico: number; densidad_airy: number; con_familia: number };
  const vacio = (): Acumulado => ({ imagenes: 0, corridas: 0, sin_estructura: 0, familia_presente: 0, familia_principal: 0, contorno_asimetrico: 0, densidad_airy: 0, con_familia: 0 });
  const porClase = new Map<string, Acumulado>();
  const confusion: Record<string, Record<string, number>> = {};
  const tiposDetector: Record<string, Record<string, number>> = {};
  const imagenesInestables: Array<{ image_sha256: string; clase: string; principales: string[] }> = [];

  for (const [sha, corridas] of porImagen) {
    const clase = etiquetas[sha]!;
    const familia = familiaDesdeClaseOficial(clase);
    const acumulado = porClase.get(clase) ?? vacio();
    acumulado.imagenes += 1;
    const principales: string[] = [];
    for (const corrida of corridas) {
      acumulado.corridas += 1;
      const instancias = corrida.instancias;
      if (instancias.length === 0) acumulado.sin_estructura += 1;
      const principal = [...instancias].sort((a, b) => area(b) - area(a))[0];
      const familiaPrincipal = principal ? principal.familia ?? `ambigua(${principal.candidatos.join("|")})` : "sin_estructura";
      principales.push(familiaPrincipal);
      confusion[familia] = { ...(confusion[familia] ?? {}), [familiaPrincipal]: (confusion[familia]?.[familiaPrincipal] ?? 0) + 1 };
      if (instancias.some((instancia) => instancia.familia === familia || instancia.candidatos.includes(familia))) acumulado.familia_presente += 1;
      if (principal && principal.familia === familia) acumulado.familia_principal += 1;
      // Attributes of the largest instance of the folder family, when the run found one.
      const propia = [...instancias].filter((instancia) => instancia.familia === familia).sort((a, b) => area(b) - area(a))[0];
      if (propia) {
        acumulado.con_familia += 1;
        if (propia.atributos_v1.outline === "asymmetric") acumulado.contorno_asimetrico += 1;
        if (propia.atributos_v1.density === "airy") acumulado.densidad_airy += 1;
      }
      for (const instancia of instancias) {
        tiposDetector[clase] = { ...(tiposDetector[clase] ?? {}), [instancia.atributos_v1.structure_type]: (tiposDetector[clase]?.[instancia.atributos_v1.structure_type] ?? 0) + 1 };
      }
    }
    if (new Set(principales).size > 1) imagenesInestables.push({ image_sha256: sha, clase, principales });
    porClase.set(clase, acumulado);
  }

  const tasa = (parte: number, total: number) => (total ? parte / total : null);
  const clases = [...porClase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([clase, a]) => ({
    clase,
    familia: familiaDesdeClaseOficial(clase),
    imagenes: a.imagenes,
    corridas: a.corridas,
    tasa_sin_estructura: tasa(a.sin_estructura, a.corridas),
    tasa_familia_presente: tasa(a.familia_presente, a.corridas),
    tasa_familia_principal: tasa(a.familia_principal, a.corridas),
    /** Among runs that found the folder family: its largest instance reported an asymmetric outline. */
    tasa_contorno_asimetrico: tasa(a.contorno_asimetrico, a.con_familia),
    tasa_densidad_airy: tasa(a.densidad_airy, a.con_familia),
    se_espera_organica: esOrganica(clase),
  }));
  const total = (campo: keyof Acumulado) => [...porClase.values()].reduce((suma, a) => suma + a[campo], 0);
  const organicas = clases.filter((c) => c.se_espera_organica);
  const regulares = clases.filter((c) => !c.se_espera_organica);
  const sumaPonderada = (grupo: typeof clases, campo: "contorno_asimetrico") => {
    const partes = grupo.reduce((suma, c) => suma + (porClase.get(c.clase)![campo]), 0);
    const base = grupo.reduce((suma, c) => suma + porClase.get(c.clase)!.con_familia, 0);
    return tasa(partes, base);
  };
  return {
    advertencia: "Comparación direccional contra la carpeta elegida por una persona al capturar; no es exactitud contra verdad revisada.",
    imagenes: porImagen.size,
    corridas_ok: ok.length,
    global: {
      tasa_sin_estructura: tasa(total("sin_estructura"), total("corridas")),
      tasa_familia_presente: tasa(total("familia_presente"), total("corridas")),
      tasa_familia_principal: tasa(total("familia_principal"), total("corridas")),
      /** Organic folders: share of runs whose own-family instance was reported asymmetric (higher is better). */
      organico_detectado_en_carpetas_organicas: sumaPonderada(organicas, "contorno_asimetrico"),
      /** Regular folders: share reported asymmetric anyway (lower is better). */
      asimetrico_en_carpetas_regulares: sumaPonderada(regulares, "contorno_asimetrico"),
      imagenes_con_familia_principal_inestable: imagenesInestables.length,
    },
    por_clase: clases,
    confusion_familia_carpeta_vs_principal: confusion,
    tipos_detector_por_clase: tiposDetector,
    imagenes_inestables: imagenesInestables,
  };
}
