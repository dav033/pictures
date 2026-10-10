/**
 * Respuestas grabadas del modo `--seco`: la lectura de la foto y tres cajas de globos (detección). No describen ninguna
 * foto del dueño; solo tienen que pasar los esquemas reales (validación, compilación, medida) para que el camino corra
 * de principio a fin.
 */
export const LECTURA_SECO = {
  resumen: "Lectura de prueba del modo seco: una columna clásica blanca sobre piso claro.",
  aspecto: 0.75,
  escala: { altoImagenCm: 250, referencia: "puerta de 200 cm" },
  pisoY: 0.9,
  sala: { pared: "#f5f0e8", piso: "#c8b89a" },
  piezas: [
    { tipo: "columna_clasica", x: 0.5, yBase: 0.9, yArriba: 0.3, colores: [{ nombre: "blanco", hex: "#ffffff", peso: 100, acabado: "mate" }] },
  ],
} as const;

/** Tres globos en coordenadas de 0 a 1000 (y0, x0, y1, x1), como los devuelve el detector. */
export const CAJAS_DETECCION_SECO = [
  { box_2d: [300, 300, 500, 420], color: "blanco" },
  { box_2d: [350, 500, 550, 640], color: "blanco" },
  { box_2d: [100, 600, 250, 700], color: "blanco" },
] as const;
