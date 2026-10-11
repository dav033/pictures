/**
 * Mide cuánto bloquea Node cada llamada de herramienta de la IA de escena del taller 3D (P-054). Sin red ni llamadas pagadas.
 * Cada caso corre las herramientas de verdad (`aplicarHerramienta`) y dice cuánto tardó cada una (reloj y CPU del proceso, que
 * varía menos con la carga del equipo) y cuántos empaques de verdad armó (`EMPAQUES`); el objetivo es que ninguna pase de ~15 s en
 * el equipo del taller (15,7 GB de RAM, ocupado).
 *
 * Casos: arco (arco orgánico de 500 × 320 con «más R-24» tres veces), arco120 (lo mismo con el cuerpo a 120 cm), chicos (el arco de 120 cm con
 * «más R-5», «menos R-9» y «más tupida»), columna (columna orgánica de 320 × 160 solo con R-5), marco (agregar_pieza de un marco orgánico
 * grande, en una sala de 320 cm), semiarco (semiarco de 300 × 300 a 160 cm con R-18 y R-5: poca estructura y mucho relleno), todos.
 *
 * Uso: npx tsx --conditions=react-server scripts/ops/medir-tiempo-escena-ia.ts [arco|arco120|chicos|columna|marco|semiarco|todos]
 */
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { EMPAQUES } from "../../src/lib/globos3d/organico-empaques";
import { esPiezaOrganica } from "../../src/lib/globos3d/organico-ajustes";
import { cuerpoDePieza } from "../../src/lib/globos3d/presupuesto-ajustes";
import { PRESUPUESTO_CUERPO_CM3, volumenDeCuerpoCm3 } from "../../src/lib/globos3d/presupuesto-cuerpo";

const SALA_VACIA: Escena = { sala: SALA_INICIAL, nodos: [] };
const CASOS = ["arco", "arco120", "chicos", "columna", "marco", "semiarco"] as const;
type Caso = (typeof CASOS)[number];

type Paso = { herramienta: string; argumentos: Record<string, unknown> };

function correr(titulo: string, pasos: readonly Paso[], sala = SALA_INICIAL) {
  console.log(`\n${titulo}`);
  let escena: Escena = { ...SALA_VACIA, sala };
  for (const { herramienta, argumentos } of pasos) {
    const inicio = performance.now();
    const cpu = process.cpuUsage();
    const empaques = { ...EMPAQUES };
    const hecho = aplicarHerramienta(escena, herramienta, argumentos);
    const segundos = (performance.now() - inicio) / 1000;
    const usada = process.cpuUsage(cpu);
    const cpuSegundos = (usada.user + usada.system) / 1e6;
    const texto = (hecho.ok ? hecho.resumen : `ERROR ${hecho.error}`).replace(/\s+/g, " ").slice(0, 110);
    const armados = `${EMPAQUES.hechos - empaques.hechos} empaques ${((EMPAQUES.ms - empaques.ms) / 1000).toFixed(1)} s`;
    console.log(`  ${segundos.toFixed(1).padStart(6)} s (cpu ${cpuSegundos.toFixed(1)} s, ${armados})  ${herramienta} ${hecho.ok ? "ok" : "ERROR"}  ${texto}`);
    if (hecho.ok) {
      escena = hecho.escena;
      const pieza = escena.nodos[0]?.pieza;
      if (pieza && esPiezaOrganica(pieza)) {
        const cuerpo = cuerpoDePieza(pieza);
        console.log(`           cuerpo: ${(volumenDeCuerpoCm3(cuerpo.largoCm, cuerpo.grosorCm) / 1e6).toFixed(2)} M cm³ de ${PRESUPUESTO_CUERPO_CM3 / 1e6} M, ${cuerpo.globos} globos de estructura`);
      }
    }
  }
}

const masR24: Paso = { herramienta: "ajustar_tamanos", argumentos: { id: "arco-organico", cambios: [{ formato: "R-24", accion: "mas" }] } };

const PASOS: Record<Caso, () => void> = {
  semiarco: () => correr("agregar_pieza de un semiarco de 300 × 300 a 160 cm con R-18 y R-5", [
    { herramienta: "agregar_pieza", argumentos: { tipo: "semiarco_organico", ancho_cm: 300, alto_cm: 300, grosor_cm: 160, tamanos: ["R-18", "R-5"] } },
  ], { ...SALA_INICIAL, altoCm: 600, anchoCm: 1200 }),
  arco: () => correr("Arco orgánico 500 × 320, «más R-24» tres veces", [
    { herramienta: "agregar_pieza", argumentos: { tipo: "arco_organico", ancho_cm: 500, alto_cm: 320 } },
    masR24, masR24, masR24,
  ]),
  arco120: () => correr("Arco orgánico 500 × 320 a 120 cm de cuerpo, «más R-24» tres veces", [
    { herramienta: "agregar_pieza", argumentos: { tipo: "arco_organico", ancho_cm: 500, alto_cm: 320, grosor_cm: 120 } },
    masR24, masR24, masR24,
  ]),
  chicos: () => correr("Arco orgánico 500 × 320 a 120 cm: «más R-5», «menos R-9» y «más tupida»", [
    { herramienta: "agregar_pieza", argumentos: { tipo: "arco_organico", ancho_cm: 500, alto_cm: 320, grosor_cm: 120 } },
    { herramienta: "ajustar_tamanos", argumentos: { id: "arco-organico", cambios: [{ formato: "R-5", accion: "mas" }] } },
    { herramienta: "ajustar_tamanos", argumentos: { id: "arco-organico", cambios: [{ formato: "R-9", accion: "menos" }] } },
    { herramienta: "ajustar_tamanos", argumentos: { id: "arco-organico", densidad: "mas" } },
  ]),
  columna: () => correr("Columna orgánica 320 × 160 solo con R-5", [
    { herramienta: "agregar_pieza", argumentos: { tipo: "columna_organica", alto_cm: 320, grosor_cm: 160, tamanos: ["R-5"] } },
  ]),
  marco: () => correr("agregar_pieza de un marco orgánico grande (500 × 320 a 100 cm)", [
    { herramienta: "agregar_pieza", argumentos: { tipo: "marco_organico", ancho_cm: 500, alto_cm: 320, grosor_cm: 100 } },
  ]),
};

const pedido = process.argv[2] ?? "todos";
const elegidos = pedido === "todos" ? CASOS : CASOS.filter((c) => c === pedido);
if (!elegidos.length) { console.error(`Caso desconocido «${pedido}»: usa ${CASOS.join(", ")} o todos.`); process.exit(1); }
for (const caso of elegidos) PASOS[caso]();
