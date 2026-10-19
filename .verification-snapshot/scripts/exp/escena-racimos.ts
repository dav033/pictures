/**
 * Escena de muestra: la columna de forma libre de graduación con racimos de uvas dorados encima y el orbe con flecos
 * (para mirarlos en el visor). Sin coste. Run: npx tsx scripts/exp/escena-racimos.ts <salida.json>
 */
import { writeFileSync } from "node:fs";
import { SALA_INICIAL, type Escena } from "@/lib/globos3d/escena";
import { aplicarHerramienta } from "@/lib/globos3d/herramientas-escena";
import { decoracionPredefinida } from "@/lib/globos3d/figuras";

let escena: Escena = { sala: { ...SALA_INICIAL }, nodos: [] };
const paso = (nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) throw new Error(`${nombre}: ${r.error}`);
  escena = r.escena;
  return r;
};
paso("agregar_pieza", { tipo: "trazo_organico", silueta: "columna_racimos", alto_cm: 220, colores: ["azul marino", "dorado"], pesos: [60, 40], donde: { en: "piso", x_cm: -120, z_cm: -150 } });
const col = escena.nodos[0]!.id;
for (const [altura, lado] of [[60, "frente"], [120, "izquierda"], [165, "frente"], [95, "derecha"]] as const) paso("poner_sobre", { decoracion_id: "racimo_uvas_dorado", padre_id: col, altura_cm: altura, lado });
// El orbe de pie (de frente), con el pie de sus flecos a 10 cm del piso.
escena = { ...escena, nodos: [...escena.nodos, { id: "orbe", nombre: "Orbe dorado con flecos", pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("orbe_flecos_dorado"), deFrente: true }, colocacion: { en: "libre", xCm: 120, yCm: 105, zCm: -150, giroGrados: 0 } }] };
writeFileSync(process.argv[2]!, JSON.stringify({ nombre: "Racimos y orbe", escena }));
console.log(escena.nodos.map((n) => `${n.id} ${n.colocacion.en}`).join(", "));
