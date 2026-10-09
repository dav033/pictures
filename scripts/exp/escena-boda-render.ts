/**
 * La escena de prueba del experimento «render fiel» del 2026-10-09 (conversación 3d-20261009-103125-92b58a): una sala de 12 × 9 m con
 * seis mesas redondas de cuatro sillas, un centro de globos encima de cada mesa y, al fondo, un marco orgánico con un panel redondo que
 * dice «Boda Real». Se arma con las mismas herramientas de la IA (`aplicarHerramienta`), así que prueba también esa ruta. Sin red.
 */
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";

export function escenaBodaRender(): Escena {
  let e: Escena = { sala: { ...structuredClone(SALA_INICIAL), anchoCm: 1200, fondoCm: 900, altoCm: 320 }, nodos: [] };
  const paso = (herramienta: string, args: Record<string, unknown>) => {
    const r = aplicarHerramienta(e, herramienta, args);
    if (!r.ok) throw new Error(`${herramienta}: ${r.error}`);
    e = r.escena;
  };
  paso("agregar_pieza", { tipo: "marco_organico", ancho_cm: 420, alto_cm: 280, colores: ["blanco", "dorado", "rosado pastel"], donde: { en: "piso", x_cm: 0, z_cm: -400 } });
  paso("agregar_mobiliario", { id: "panel_redondo", texto: "Boda Real", color_texto: "dorado", acabado_texto: "acrilico_espejo", colores: ["blanco", "dorado"], x_cm: 0, z_cm: -405 });
  const puestos = [[-330, -60], [0, -60], [330, -60], [-330, 220], [0, 220], [330, 220]] as const;
  for (const [x, z] of puestos) {
    paso("agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: x, z_cm: z });
    const mesaId = e.nodos.at(-1)!.id;
    paso("agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor", alrededor_de: mesaId });
    paso("poner_sobre", { decoracion_id: "flor_grande", padre_id: mesaId, colores: ["rosado pastel", "dorado"] });
  }
  return e;
}
