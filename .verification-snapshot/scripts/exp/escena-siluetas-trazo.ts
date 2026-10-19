/**
 * Escena de muestra con las siluetas del trazo orgánico, una al lado de otra en la pared del fondo (para mirarlas en
 * el visor). Escribe el JSON de la escena guardada del taller en la ruta que se le pase. Sin coste.
 * Run: npx tsx scripts/exp/escena-siluetas-trazo.ts <salida.json>
 */
import { writeFileSync } from "node:fs";
import { SALA_INICIAL, type Escena } from "@/lib/globos3d/escena";
import { DESDE_EL_PISO, MEZCLA_TRAZO, SILUETAS_TRAZO, puntosDeSilueta } from "@/lib/globos3d/trazo-organico";
import { piezaDeGenerador } from "@/lib/globos3d/generadores-organicos";
import { floresPedidas } from "@/lib/globos3d/herramientas-escena-trazo";

const colores = [{ codigo: "009", peso: 40 }, { codigo: "570", peso: 35 }, { codigo: "005", peso: 25 }];
const escena: Escena = { sala: { ...SALA_INICIAL, anchoCm: 1300, fondoCm: 700, altoCm: 340 }, nodos: [] };
SILUETAS_TRAZO.forEach((s, i) => {
  const follaje = [["monstera"], ["palma"], ["helecho"], ["eucalipto", "rosa"], ["hoja_seca dorada", "rosa marfil"], [], [], []][i]!;
  const flores = follaje.length ? floresPedidas(follaje) : null;
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: { puntos: puntosDeSilueta(s.id, { anchoCm: 260, altoCm: 180, grosorCm: 62 }), mezcla: MEZCLA_TRAZO, colores, racimos: 0.4, semilla: 11 + i } }, flores, 8);
  const x = -480 + (i % 4) * 320, fila = Math.floor(i / 4);
  escena.nodos.push({ id: `trazo_${s.id}`, nombre: s.nombre, pieza, colocacion: DESDE_EL_PISO.has(s.id) ? { en: "piso", xCm: x, zCm: -350 + 60 + fila * 260, giroGrados: 0 } : { en: "pared", pared: "fondo", aLoLargoCm: x, alturaCm: 120 } });
});
writeFileSync(process.argv[2]!, JSON.stringify({ nombre: "Siluetas del trazo", escena }));
console.log("escrita");
