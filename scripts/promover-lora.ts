import fs from "node:fs";
import path from "node:path";
import { flag } from "./exp-fal-lib";

/**
 * Promueve un LoRA evaluado a producción, con el criterio de aceptación metido
 * en el código para que no se pueda saltear.
 *
 * El v2 llegó a producción sin haber pasado ningún criterio; de hecho no habría
 * pasado este. La regla dura: **un checkpoint que solo funciona a lora_scale 0,3
 * está fallado**, por lindas que se vean sus imágenes. Por eso `--aprobadas` se
 * refiere SIEMPRE a la tanda de escala 0,8.
 *
 *   npx tsx scripts/promover-lora.ts --etiqueta v004-1000 --aprobadas 5
 *   ... --revertir            vuelve a la URL anterior
 */

const ENV = path.join(process.cwd(), ".env.local");
const BACKUP = path.join(process.cwd(), "data/lora-backup");
const MINIMO = 5; // de 6, a escala 0,8

function leerLinea(clave: string): string | undefined {
  return fs.readFileSync(ENV, "utf8").match(new RegExp(`^${clave}=(.*)$`, "m"))?.[1]?.trim();
}

/** Reescribe una clave de .env.local dejando copia de seguridad del archivo. */
function escribirLinea(clave: string, valor: string): void {
  const antes = fs.readFileSync(ENV, "utf8");
  fs.writeFileSync(`${ENV}.bak`, antes);
  const linea = `${clave}=${valor}`;
  const despues = new RegExp(`^${clave}=.*$`, "m").test(antes)
    ? antes.replace(new RegExp(`^${clave}=.*$`, "m"), linea)
    : `${antes.replace(/\s*$/, "")}\n${linea}\n`;
  fs.writeFileSync(ENV, despues);
}

function main(): void {
  const etiqueta = flag("etiqueta", "");
  if (!etiqueta) { console.error("Falta --etiqueta <v004-1000>"); process.exit(1); }

  const rutaProc = path.join(BACKUP, `PROCEDENCIA-${etiqueta}.json`);
  if (!fs.existsSync(rutaProc)) {
    console.error(`No hay procedencia para ${etiqueta}. Correr antes scripts/recibir-lora.ts.`);
    process.exit(1);
  }
  const proc = JSON.parse(fs.readFileSync(rutaProc, "utf8")) as Record<string, any>;

  if (process.argv.includes("--revertir")) {
    const previa = proc.url_anterior as string | undefined;
    if (!previa) { console.error("No hay URL anterior registrada para revertir."); process.exit(1); }
    escribirLinea("SEMPERTEX_LORA_URL", previa);
    console.log(`Revertido a ${previa}`);
    console.log("Acordate de volver loraScale() a su valor anterior en src/lib/ia/sempertex-lora.ts.");
    return;
  }

  const aprobadas = Number(flag("aprobadas", "-1"));
  if (!Number.isInteger(aprobadas) || aprobadas < 0 || aprobadas > 6) {
    console.error("Falta --aprobadas N: cuántas de las 6 imágenes a ESCALA 0,8 cumplen los tres criterios.");
    console.error("  1. arco 3D que cierra  2. dos columnas separadas  3. mesa y escena en cuadro");
    process.exit(1);
  }

  console.log(`${etiqueta}: ${aprobadas}/6 a escala 0,8  (base 6/6 · v2 1/6 · mínimo ${MINIMO}/6)`);

  if (aprobadas < MINIMO) {
    console.log(`\nNO SE PROMUEVE. ${aprobadas}/6 está por debajo del mínimo de ${MINIMO}/6.`);
    console.log("Producción sigue con el v2 a lora_scale 0,3, que es control de daños y funciona.");
    console.log("\nSegún lo que hayas visto, la próxima corrida es:");
    console.log("  · compone mal              -> steps=500   (US$3,20)");
    console.log("  · compone bien, sin estilo -> steps=1500  (US$9,60)");
    console.log("  · ninguna dirección sirve  -> learning_rate=0.0001, un eje por vez");
    console.log("  · sigue sin bilateralidad  -> no es entrenamiento: faltan fotos con arco + dos columnas");
    proc.evaluacion = { escala_08: `${aprobadas}/6`, veredicto: "RECHAZADO", fecha: new Date().toISOString().slice(0, 10) };
    fs.writeFileSync(rutaProc, JSON.stringify(proc, null, 2));
    process.exit(2);
  }

  const anterior = leerLinea("SEMPERTEX_LORA_URL");
  proc.url_anterior = anterior;
  proc.evaluacion = { escala_08: `${aprobadas}/6`, veredicto: "APROBADO", fecha: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(rutaProc, JSON.stringify(proc, null, 2));

  escribirLinea("SEMPERTEX_LORA_URL", proc.url_fal as string);
  console.log(`\nAPROBADO. .env.local actualizado (copia en .env.local.bak)`);
  console.log(`  antes : ${anterior ?? "(sin definir)"}`);
  console.log(`  ahora : ${proc.url_fal}`);
  console.log(`\nFALTA A MANO — subir la escala en src/lib/ia/sempertex-lora.ts, funcion loraScale():`);
  console.log(`  el default está en 0.3 (control de daños del v2). Con ${aprobadas}/6 a 0,8, subilo a 0.8`);
  console.log(`  y actualizá el comentario de arriba con la tasa nueva.`);
  console.log(`\nDespués:`);
  console.log(`  npx tsc --noEmit && npm run ia:test-lora-compiler && npm run ia:test-plan-lora-e2e && npm run ia:test`);
  console.log(`\nSi algo sale mal:  npx tsx scripts/promover-lora.ts --etiqueta ${etiqueta} --revertir`);
}

main();
