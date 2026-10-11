/**
 * Corpus de frases del dueño y los decoradores, a través de las herramientas de la escena con un modelo SIMULADO (sin red, sin coste,
 * sin IA): cada frase tiene el guion de llamadas que un modelo razonable haría (con sus argumentos), y la prueba comprueba la escena
 * que queda. Pasa por lo mismo que `/api/escena-ia`: esquema de la herramienta, `aplicarHerramientaIA`, avisos, verificación y la
 * honestidad de la respuesta final. Ver scripts/test/frases-dueno/motor.ts.
 *
 *   npx tsx --conditions=react-server scripts/test/test-frases-dueno.ts [texto de la frase]
 *
 * Una frase que falla no esconde a las demás: se juntan y la prueba cae al final con la lista. Los defectos grandes conocidos van en
 * `fallaEsperada` de su caso, con el motivo: la prueba exige que sigan fallando (si pasan, hay que quitar la marca).
 */
import { probarCaso, type Area, type Caso } from "./frases-dueno/motor";
import { CASOS_SALON } from "./frases-dueno/casos-salon";
import { CASOS_ORGANICO } from "./frases-dueno/casos-organico";
import { CASOS_TAMANOS } from "./frases-dueno/casos-tamanos";
import { CASOS_COLORES } from "./frases-dueno/casos-colores";
import { CASOS_FOIL_LETRAS } from "./frases-dueno/casos-foil-letras";
import { CASOS_BIBLIOTECA } from "./frases-dueno/casos-biblioteca";
import { CASOS_MOVER } from "./frases-dueno/casos-mover";
import { CASOS_HONESTIDAD } from "./frases-dueno/casos-honestidad";

const CASOS: Caso[] = [...CASOS_SALON, ...CASOS_ORGANICO, ...CASOS_TAMANOS, ...CASOS_COLORES, ...CASOS_FOIL_LETRAS, ...CASOS_BIBLIOTECA, ...CASOS_MOVER, ...CASOS_HONESTIDAD];

const repetidas = CASOS.map((c) => c.frase).filter((f, i, todas) => todas.indexOf(f) !== i);
if (repetidas.length) throw new Error(`frases repetidas en el corpus: ${repetidas.join(" | ")}`);

const AREAS: readonly Area[] = ["salon", "organico", "tamanos", "colores", "foil-letras", "biblioteca", "mover", "honestidad"];

type Informe = { caso: Caso; error: string | null; ms: number };

async function correr(caso: Caso): Promise<Informe> {
  const inicio = Date.now();
  try {
    await probarCaso(caso);
    return { caso, error: null, ms: Date.now() - inicio };
  } catch (error) {
    return { caso, error: error instanceof Error ? error.message : String(error), ms: Date.now() - inicio };
  }
}

async function main(): Promise<void> {
  const filtro = process.argv[2]?.toLowerCase();
  const casos = CASOS.filter((c) => !filtro || c.frase.toLowerCase().includes(filtro));
  if (!casos.length) throw new Error(`ninguna frase contiene «${filtro}»`);
  const inicio = Date.now();
  const informes: Informe[] = [];
  for (const caso of casos) {
    const informe = await correr(caso);
    informes.push(informe);
    const estado = informe.error === null ? (caso.fallaEsperada ? "PASA (se esperaba que fallara)" : "OK") : caso.fallaEsperada ? "falla esperada" : "FALLA";
    console.log(`${estado.padEnd(14)} [${caso.area}] «${caso.frase}» ${informe.ms} ms`);
  }

  const fallas = informes.filter((i) => i.error !== null && !i.caso.fallaEsperada);
  const pasanSinDeber = informes.filter((i) => i.error === null && i.caso.fallaEsperada);
  const esperadas = informes.filter((i) => i.error !== null && i.caso.fallaEsperada);
  const otroMotivo = esperadas.filter((i) => i.caso.fallaCon && !i.caso.fallaCon.test(i.error!));

  console.log("\nPor área:");
  for (const area of AREAS) {
    const de = informes.filter((i) => i.caso.area === area);
    if (de.length) console.log(`  ${area.padEnd(11)} ${String(de.length).padStart(2)} frases, ${de.filter((i) => i.error === null).length} pasan`);
  }
  if (esperadas.length) {
    console.log("\nFallas esperadas (defectos conocidos, la frase NO funciona hoy):");
    for (const i of esperadas) console.log(`  «${i.caso.frase}»: ${i.caso.fallaEsperada}\n      hoy: ${i.error!.split("\n")[0]}`);
  }
  console.log(`\ntest-frases-dueno: ${informes.length} frases en ${((Date.now() - inicio) / 1000).toFixed(1)} s · ${fallas.length} fallan · ${esperadas.length} fallas esperadas`);

  const problemas: string[] = [
    ...fallas.map((i) => `«${i.caso.frase}» [${i.caso.area}]: ${i.error}`),
    ...otroMotivo.map((i) => `«${i.caso.frase}» falla, pero no por lo esperado (${i.caso.fallaCon}): ${i.error}`),
    ...pasanSinDeber.map((i) => `«${i.caso.frase}» ya funciona: quítale la marca fallaEsperada (${i.caso.fallaEsperada})`),
  ];
  if (problemas.length) {
    console.error(`\n${problemas.length} problema(s):\n${problemas.map((p) => `- ${p}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
