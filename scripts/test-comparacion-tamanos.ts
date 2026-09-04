// Test de regresión de las reglas de comparación de tamaños.
//
// Los casos POSITIVOS usan fixtures CONGELADOS: el texto exacto que tenía cada caption cuando se
// detectó el error, no lo que hay hoy en disco. Es a propósito -- una primera versión de este
// test leía los archivos vivos y empezó a "fallar" en cuanto se corrigieron los captions, que es
// justo cuando debería seguir pasando. Un test que se rompe porque arreglaste el bug no protege
// de nada.
//
// Los casos NEGATIVOS sí leen disco: ahí lo que se quiere verificar es que los datos ACTUALES
// siguen limpios, así que si alguien edita uno e introduce un error, el test debe fallar.
//
// Uso: npx tsx scripts/test-comparacion-tamanos.ts

import { readFile } from "node:fs/promises";
import { analizarComparacion, type HallazgoComparacion } from "./lib/comparacion-tamanos";

const RUTA_ORDENES = "C:/Users/davidt/Downloads/ordenes-decoracion";

type Regla = HallazgoComparacion["regla"];

type Caso = {
  orden: string;
  texto: string;
  esperado: Regla[];
  nota: string;
};

// Texto tal como estaba al momento del chequeo visual v001 (reports/resultados-...-v001.md).
const CASOS: Caso[] = [
  {
    orden: "13309",
    texto:
      "large glossy gold chrome round balloons cluster densely near the top and anchor the column, while smaller and medium pearl white satin balloons fill the gaps as the garland cascades down the side of the backdrop",
    esperado: ["inversion_color"],
    nota: "dorado (máx R-9) llamado grande vs perla (máx R-12) llamado chico",
  },
  {
    orden: "12967",
    texto:
      "large round chocolate-toned latex balloons of varying sizes anchor the garland while a thin gold tubito link chain of small balloons weaves between and cascades below them",
    esperado: ["variacion_sin_respaldo"],
    nota: "afirma 'varying sizes' con un solo diámetro redondo (R-5)",
  },
  {
    orden: "950000181",
    texto:
      "The 9-inch balloons are roughly 1.8 times the diameter of the 5-inch balloons, creating larger anchors among the smaller cluster balloons.",
    esperado: ["ratio_calculado"],
    nota: "ratio 9÷5 aplicado como plantilla; la foto muestra anclajes a ~3,5-4x. Lo agarra la regla de ratio, no las de desglose (es del blog)",
  },
  {
    orden: "8411",
    texto:
      "Large chrome silver balloons cluster at the base of the garland while small silver, pink, and lilac balloons fill the upper garland and accent areas.",
    esperado: [],
    nota: "TECHO CONOCIDO: error posicional. La plata llega a R-12 y los rosados a R-9, así que el orden por color es consistente con el pedido -- no hay señal sin mirar la foto",
  },
  {
    orden: "20070",
    texto:
      "large round balloons anchor the top of each cluster while medium and small round balloons fill the spaces between them, with a few clear transparent balloons accenting the right-side cluster",
    esperado: [],
    nota: "TECHO CONOCIDO: disposición vertical inventada, sin señal en el pedido",
  },
];

// Captions cuya afirmación de tamaño se verificó CORRECTA mirando la foto. Ninguna regla debe
// disparar sobre el contenido actual de estos archivos.
//   - 8248 contrasta látex R-12 contra globos foil NO comprados: contraste legítimo aun con un
//     solo diámetro redondo en el pedido.
//   - 950000058 y 950000136 son del blog, con variación real y visible y desglose incompleto:
//     verifican el gate por `cliente`.
const CONTROLES = ["11216", "10199", "13741", "8248", "8509", "950000058", "950000136"];

async function lineasDe(orden: string) {
  const desglose = JSON.parse(await readFile(`${RUTA_ORDENES}/${orden}/desglose.json`, "utf-8"));
  return { lineas: desglose.lineas, esReal: Boolean(desglose.cliente) };
}

function mismasReglas(obtenido: Regla[], esperado: Regla[]): boolean {
  const a = [...new Set(obtenido)].sort();
  const b = [...new Set(esperado)].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function main() {
  let ok = 0;
  let fallos = 0;

  console.log("=== casos congelados (texto tal como estaba al detectarse) ===");
  for (const caso of CASOS) {
    const { lineas, esReal } = await lineasDe(caso.orden);
    const hallazgos = analizarComparacion(caso.texto, lineas, { desgloseEnumeraTodo: esReal });
    const reglas = hallazgos.map((h) => h.regla);
    const bien = mismasReglas(reglas, caso.esperado);
    if (bien) ok += 1;
    else fallos += 1;
    const esp = caso.esperado.length ? caso.esperado.join("+") : "(ninguna)";
    const obt = reglas.length ? reglas.join("+") : "(ninguna)";
    console.log(`${bien ? "  OK " : "  XX "} #${caso.orden}  esperado=${esp}  obtenido=${obt}`);
    console.log(`        ${caso.nota}`);
  }

  console.log("\n=== controles negativos (contenido actual en disco) ===");
  for (const orden of CONTROLES) {
    const { lineas, esReal } = await lineasDe(orden);
    const caption = JSON.parse(await readFile(`${RUTA_ORDENES}/${orden}/caption-1.json`, "utf-8"));
    const texto = `${caption.caption ?? ""} ${caption.proporcion_relativa_descripcion ?? ""}`;
    const hallazgos = analizarComparacion(texto, lineas, { desgloseEnumeraTodo: esReal });
    const bien = hallazgos.length === 0;
    if (bien) ok += 1;
    else fallos += 1;
    console.log(`${bien ? "  OK " : "  XX "} #${orden} ${bien ? "sin falsos positivos" : "FALSO POSITIVO:"}`);
    for (const h of hallazgos) console.log(`        -> [${h.regla}] ${h.detalle}`);
  }

  const detectables = CASOS.filter((c) => c.esperado.length > 0).length;
  console.log(`\n${ok} ok / ${fallos} fallos`);
  console.log(`Cobertura: ${detectables} de ${CASOS.length} errores confirmados quedan al alcance de una regla sin visión.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
