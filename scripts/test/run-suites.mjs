// Corre scripts de npm sin parar en la primera falla: reporta todas las suites y sale con error al final si alguna falló.
// Uso: node scripts/test/run-suites.mjs <script> [<script>...]
// Un script que es una cadena «npm run X && ...» se expande en sus partes, así una falla no oculta las demás.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
process.env.PATH = `${path.resolve("node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`;

const fallidas = [];
let ejecutados = 0;

function correr(etiqueta, comando) {
  ejecutados += 1;
  console.log(`\n=== ${etiqueta}`);
  const resultado = spawnSync(comando, { shell: true, stdio: "inherit" });
  if (resultado.status !== 0) fallidas.push(`${etiqueta} (código ${resultado.status ?? resultado.signal})`);
}

function suite(nombre) {
  const comando = scripts[nombre];
  if (comando === undefined) {
    fallidas.push(`${nombre} (no existe en package.json)`);
    return;
  }
  for (const parte of comando.split(" && ").map((texto) => texto.trim())) {
    const enlace = /^npm run ([\w:-]+)$/.exec(parte);
    if (enlace) suite(enlace[1]);
    else correr(`${nombre}: ${parte}`, parte);
  }
}

for (const nombre of process.argv.slice(2)) suite(nombre);

console.log(`\n${ejecutados} comandos ejecutados.`);
if (fallidas.length > 0) {
  console.error(`Fallaron ${fallidas.length}:\n- ${fallidas.join("\n- ")}`);
  process.exit(1);
}
