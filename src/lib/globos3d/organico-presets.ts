import type { Vec3 } from "./modulos";
import { armarOrganico, formaColumna, formaGuirnalda, RELLENO_TUPIDO, type Cilindro, type OpcionesOrganico, type ResultadoOrganico } from "./organico";
import { repartirFlores, type FloresRepartidas, type OpcionesFlores } from "./flores-artificiales";

/**
 * Presets del generador orgánico que reproducen fotos de referencia.
 *
 * **COLUMNA_QUINCE_AZUL** (foto de bienvenida de XV años «Valeria», 2026-10-07): columna orgánica de ~2,3 m a la
 * izquierda, gruesa abajo y fina arriba, que en la base se abre en una guirnalda baja que rodea un pedestal blanco
 * hacia la derecha. Azul cielo pastel dominante, blanco, plata cromado y cristal con confeti plateado; hortensias
 * azules, rosas blancas y gypsophila en los huecos.
 *
 * Medido sobre la foto con la columna de 2,3 m como escala (≈3,5 px/cm, y el pedestal da lo mismo: 165 px ≈ 47
 * cm): los globos de la base miden 43–50 cm (R-24 subinflado y R-18 lleno, no R-36: un R-36 a su inflado de
 * decoración, 85 cm, ensancharía la base hasta casi un metro, y la foto mide ~75–85 cm); los plateados y los del
 * cuerpo 23–28 cm (R-12), los cristales con confeti ~31 cm (R-12 lleno o R-18 a medias) y los blancos chicos ~17
 * cm (R-9). El pedestal mide ~45 cm de diámetro y ~50 cm de alto. Los plateados y los blancos van de chico a
 * mediano (ninguno es de los grandes de la base, que son azules), y el cristal con confeti, en R-12 y R-18.
 *
 * Escena: la columna nace en el origen; x a la derecha, z hacia quien mira, y hacia arriba; el pedestal queda a la
 * derecha y un poco adelante, y la guirnalda le da media vuelta por delante.
 */
export type EscenaOrganica = { pedestal: Cilindro; vista: Vec3 };

export type PresetOrganico = {
  id: string;
  nombre: string;
  descripcion: string;
  opciones: OpcionesOrganico;
  flores: OpcionesFlores;
  escena: EscenaOrganica;
  /** Cuántos globos se esperan y por qué. */
  conteoEsperado: { min: number; max: number; justificacion: string };
};

const PEDESTAL: Cilindro = { id: "pedestal", base: { x: 72, y: 0, z: 18 }, radioCm: 22.5, altoCm: 50 };

/**
 * Media vuelta por delante del pedestal, a 42 cm de su eje: nace dentro de la base de la columna (a 180°, entre la
 * columna y el pedestal), pasa por delante y acaba en su costado derecho (a 15°), donde sube un poco (el racimo que
 * trepa junto al pedestal). Unos 1,2 m de largo.
 */
function guirnaldaAlPedestal(): Vec3[] {
  const puntos: Vec3[] = [];
  const pasos = 8;
  for (let i = 0; i <= pasos; i++) {
    const f = i / pasos;
    const a = Math.PI * (1 - 0.92 * f);
    const y = 19 + (18 * Math.max(0, f - 0.7)) / 0.3;
    puntos.push({ x: PEDESTAL.base.x + Math.cos(a) * 42, y, z: PEDESTAL.base.z + Math.sin(a) * 42 });
  }
  return puntos;
}

const CHICO_A_MEDIANO = ["R-5", "R-9", "R-12", "R-18"] as const;

export const COLUMNA_QUINCE_AZUL: PresetOrganico = {
  id: "columna_quince_azul",
  nombre: "Columna orgánica azul de XV con guirnalda al pedestal",
  descripcion: "Columna orgánica de 2,3 m, gruesa abajo y fina arriba, que en la base se abre en una guirnalda de ~1,2 m alrededor de un pedestal. Azul cielo pastel, blanco, plata Reflex y cristal con confeti; hortensias, rosas y gypsophila en los huecos.",
  opciones: {
    semilla: 15,
    tramos: [
      formaColumna({ altoCm: 230, radioBaseCm: 42, radioMedioCm: 36, radioPuntaCm: 27, inclinacionCm: 8, serpenteoCm: 3 }),
      formaGuirnalda({ id: "guirnalda", nombre: "Guirnalda de base", puntos: guirnaldaAlPedestal(), radioInicioCm: 19, radioFinCm: 13 }),
    ],
    inflados: { "R-24": 48, "R-18": 34, "R-12": 25, "R-9": 17, "R-5": 12 },
    variacionInflado: 0.07,
    relleno: RELLENO_TUPIDO,
    colores: [
      { codigo: "640", peso: 52 }, // Pastel Mate Azul: el azul cielo pastel dominante
      { codigo: "005", peso: 22, formatos: CHICO_A_MEDIANO }, // Fashion Blanco
      { codigo: "981", peso: 18, formatos: CHICO_A_MEDIANO }, // Reflex Plata (cromado)
      { codigo: "390", peso: 8, confeti: true, formatos: ["R-12", "R-18"] }, // Cristal Transparente con confeti plateado
    ],
    obstaculos: [PEDESTAL],
    suelo: true,
    huecosFlores: 16,
    vista: { x: 0, y: 0, z: 1 },
  },
  flores: {
    semilla: 15,
    tallosPorRacimo: 4,
    proporcion: [
      { tipo: "hortensia", colorId: "azul", peso: 28 },
      { tipo: "hortensia", colorId: "blanca", peso: 6 },
      { tipo: "rosa", colorId: "blanca", peso: 33 },
      { tipo: "gypsophila", colorId: "blanca", peso: 33 },
    ],
  },
  escena: { pedestal: PEDESTAL, vista: { x: 0, y: 0, z: 1 } },
  conteoEsperado: {
    min: 80,
    max: 120,
    justificacion:
      "En la foto se ven de frente unos 45 globos (~35 en la columna y ~10 en la guirnalda). La columna está exenta y por detrás " +
      "lleva otro 40 % que no se ve: ~70–80 en la columna. La guirnalda va en el piso y pegada al pedestal, así que es media " +
      "guirnalda: ~12–16. Total ~85–95. El motor lo confirma con la mezcla: la estructura pide ~20 globos por metro de columna " +
      "(grandes de 48 y 34 cm abajo, R-12 a 25 cm y R-9 a 17 cm arriba; un R-12 en tresbolillo con el 12 % de aplastamiento da " +
      "19/m, lo mismo que la trenza de cuartetos de Sempertex) y el relleno de R-9 y tríos de R-5 sube la columna a ~40/m " +
      "(12 por pie: «estándar» del oficio). Con 20 semillas distintas sale entre 80 y 98; con la semilla 15, 88.",
  },
};

export type PresetArmado = { organico: ResultadoOrganico; flores: FloresRepartidas; escena: EscenaOrganica };

/** Arma un preset completo: globos, huecos y flores en esos huecos. */
export function armarPreset(preset: PresetOrganico): PresetArmado {
  const organico = armarOrganico(preset.opciones);
  const flores = repartirFlores(organico.anclas, preset.flores);
  return { organico, flores, escena: preset.escena };
}
