/**
 * Ver los registros del servidor (src/lib/registro) en local, en el VPS, en Vercel y del Python.
 *
 *   npm run registros -- --ayuda
 *
 * Sin dependencias nuevas: en el VPS ejecuta scripts/ops/registros/lector.ts dentro del contenedor (lo
 * transpila con el `typescript` del proyecto y lo pasa por stdin a `docker exec -i demo-decoracion node -`).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  coincideLinea,
  diagnostico,
  leerConversacion,
  leerGeneral,
  listarConversaciones,
  type FiltrosRegistro,
  type PeticionLector,
  type ResumenConversacion,
} from "./registros/lector";

const ORIGENES = ["local", "vps", "vercel", "python-vps", "python-local"] as const;
type Origen = (typeof ORIGENES)[number];

const SSH_ALIAS = process.env.REGISTROS_SSH ?? "advin-vps";
const CONTENEDOR_WEB = "demo-decoracion";
const CONTENEDOR_PYTHON = "demo-decoracion-ai-api";
const RAICES_VPS = ["/app/data/registros", "/tmp/demo-decoracion-registros"];
const PROYECTO_VERCEL = process.env.REGISTROS_VERCEL_PROYECTO ?? "demo-decoracion";

const AYUDA = `
Registros del servidor (src/lib/registro). Uso: npm run registros -- [conversaciones] [opciones]

GENERAL (por defecto): líneas del registro general, la última hora.
  --origen local|vps|vercel|python-vps|python-local   (local)
  --nivel debug|info|warn|error      nivel mínimo
  --evento a,b                        el evento contiene alguno (p. ej. peticion.fin,auditoria.respuesta_ia)
  --solicitud <id> | --conversacion <id>   prefijo del id
  --buscar <texto>                    texto libre en la línea cruda
  --desde 10m|2h|3d|<ISO>   --hasta <...>   --ultimos N (200)
  --json                              líneas crudas (JSONL) en vez de la vista compacta
  --stdout                            (vps) leer «docker logs» del contenedor en vez de los archivos
  --incluir-salud                     (python-*) no ocultar los GET /healthz
  --raiz <dir>                        (local) otra raíz de registros

CONVERSACIONES (auditoría por conversación):
  npm run registros -- conversaciones --origen vps --desde 2h
      lista: id, inicio, vista, eventos, llamadas IA, errores, último evento (24 h por defecto)
  npm run registros -- conversaciones --origen vps --conversacion <id o prefijo único>
      línea de tiempo por turno: entrada → llamadas IA → herramientas/decisiones → python/imagen → salida
  ... --completo        además, los datos completos de cada evento
  ... --json            las líneas crudas de auditoría
  ... --descargar <dir> copia el archivo crudo a <dir>/<id>.jsonl

DIAGNÓSTICO: npm run registros -- diagnostico --origen vps   (raíces, archivos recientes)

DÓNDE ESTÁ CADA COSA
  local       data/registros/{general,conversaciones} (o REGISTRO_DIR); respaldo <tmp>/demo-decoracion-registros
  vps         ssh ${SSH_ALIAS} → docker exec ${CONTENEDOR_WEB}: /app/data/registros (volumen persistente);
              si el usuario del contenedor no puede escribir allí, el registro cae a /tmp/demo-decoracion-registros
              (efímero) y avisa «registro.dir_degradado». Arreglo de una vez (lo hace el dueño):
              ssh ${SSH_ALIAS} "docker exec -u 0 ${CONTENEDOR_WEB} sh -c 'mkdir -p /app/data/registros && chown -R nextjs /app/data/registros'"
  vercel      solo stdout (vercel logs, NODE_OPTIONS=--use-system-ca); /tmp es efímero y por instancia, así que
              allí la auditoría completa se copia a stdout (REGISTRO_AUDITORIA_STDOUT, activo por defecto) y
              puede llegar recortada; no hay listado de conversaciones.
  python-vps  docker logs --since … ${CONTENEDOR_PYTHON} (uvicorn, texto plano)
  python-local el supervisor (scripts/ops/supervisar-ai-api.py) escribe en su consola; si la rediriges a
              data/registros/python/*.log, este comando la lee.
`;

interface Opciones {
  subcomando: "general" | "conversaciones" | "diagnostico";
  origen: Origen;
  nivel?: string;
  evento?: string;
  solicitud?: string;
  conversacion?: string;
  buscar?: string;
  desde?: string;
  hasta?: string;
  ultimos?: number;
  json: boolean;
  completo: boolean;
  stdout: boolean;
  incluirSalud: boolean;
  descargar?: string;
  raiz?: string;
  ayuda: boolean;
}

function fallar(mensaje: string): never {
  process.stderr.write(`${mensaje}\n`);
  process.exit(1);
}

function leerArgumentos(argv: string[]): Opciones {
  const opciones: Opciones = { subcomando: "general", origen: "local", json: false, completo: false, stdout: false, incluirSalud: false, ayuda: false };
  const valores = new Map<string, string>();
  const banderas = new Set<string>();
  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice]!;
    if (!argumento.startsWith("--")) {
      if (argumento === "conversaciones" || argumento === "conversacion") opciones.subcomando = "conversaciones";
      else if (argumento === "general") opciones.subcomando = "general";
      else if (argumento === "diagnostico") opciones.subcomando = "diagnostico";
      else fallar(`Argumento desconocido: ${argumento} (usa --ayuda)`);
      continue;
    }
    const igual = argumento.indexOf("=");
    const nombre = argumento.slice(2, igual > 0 ? igual : undefined);
    if (["json", "completo", "stdout", "incluir-salud", "ayuda", "help"].includes(nombre)) {
      banderas.add(nombre);
      continue;
    }
    const valor = igual > 0 ? argumento.slice(igual + 1) : argv[++indice];
    if (valor === undefined) fallar(`Falta el valor de --${nombre}`);
    valores.set(nombre, valor);
  }
  const conocidas = new Set(["origen", "nivel", "evento", "solicitud", "conversacion", "buscar", "desde", "hasta", "ultimos", "descargar", "raiz"]);
  for (const nombre of valores.keys()) if (!conocidas.has(nombre)) fallar(`Opción desconocida: --${nombre} (usa --ayuda)`);
  const origen = valores.get("origen") ?? "local";
  if (!(ORIGENES as readonly string[]).includes(origen)) fallar(`--origen debe ser uno de: ${ORIGENES.join(", ")}`);
  opciones.origen = origen as Origen;
  opciones.nivel = valores.get("nivel");
  if (opciones.nivel && !["debug", "info", "warn", "error"].includes(opciones.nivel)) fallar("--nivel debe ser debug|info|warn|error");
  opciones.evento = valores.get("evento");
  opciones.solicitud = valores.get("solicitud");
  opciones.conversacion = valores.get("conversacion");
  opciones.buscar = valores.get("buscar");
  opciones.desde = valores.get("desde");
  opciones.hasta = valores.get("hasta");
  opciones.descargar = valores.get("descargar");
  opciones.raiz = valores.get("raiz");
  const ultimos = valores.get("ultimos");
  if (ultimos !== undefined) {
    opciones.ultimos = Number(ultimos);
    if (!Number.isInteger(opciones.ultimos) || opciones.ultimos <= 0) fallar("--ultimos debe ser un entero positivo");
  }
  opciones.json = banderas.has("json");
  opciones.completo = banderas.has("completo");
  opciones.stdout = banderas.has("stdout");
  opciones.incluirSalud = banderas.has("incluir-salud");
  opciones.ayuda = banderas.has("ayuda") || banderas.has("help");
  return opciones;
}

/** 10m, 2h, 3d, 45s o una fecha ISO → epoch ms. */
function momento(valor: string | undefined): number | undefined {
  if (!valor) return undefined;
  const relativo = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(valor.trim());
  if (relativo) {
    const unidades: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return Date.now() - Number(relativo[1]) * unidades[relativo[2]!]!;
  }
  const absoluto = Date.parse(valor);
  if (!Number.isFinite(absoluto)) fallar(`Fecha no válida: ${valor} (usa 10m, 2h, 3d o ISO)`);
  return absoluto;
}

/** Para `docker logs --since` (no acepta días). */
function desdeParaDocker(valor: string | undefined, porDefecto: string): string {
  if (!valor) return porDefecto;
  const dias = /^(\d+)d$/.exec(valor.trim());
  if (dias) return `${Number(dias[1]) * 24}h`;
  return valor;
}

function filtrosDe(opciones: Opciones, desdePorDefecto: string): FiltrosRegistro {
  return {
    desde: momento(opciones.desde ?? desdePorDefecto),
    hasta: momento(opciones.hasta),
    nivel: opciones.nivel,
    evento: opciones.evento,
    solicitud: opciones.solicitud,
    conversacion: opciones.subcomando === "conversaciones" ? undefined : opciones.conversacion,
    buscar: opciones.buscar,
    ultimos: opciones.ultimos,
  };
}

/* ---------- Ejecución de procesos ---------- */

interface Resultado {
  codigo: number;
  stdout: string;
  stderr: string;
}

function argumentoCmd(valor: string): string {
  return /^[\w@+=:,./-]+$/.test(valor) ? valor : `"${valor.replace(/"/g, '""')}"`;
}

function ejecutar(comando: string, argumentos: string[], entrada?: string, entorno?: NodeJS.ProcessEnv, conShell = false): Promise<Resultado> {
  return new Promise((resolver) => {
    // Con shell (los .cmd de npm en Windows) se pasa UNA cadena ya entrecomillada: Node desaconseja args + shell.
    const hijo = conShell
      ? spawn([comando, ...argumentos.map(argumentoCmd)].join(" "), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: entorno ?? process.env, shell: true })
      : spawn(comando, argumentos, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: entorno ?? process.env });
    const salida: Buffer[] = [];
    const errores: Buffer[] = [];
    hijo.stdout.on("data", (fragmento: Buffer) => salida.push(fragmento));
    hijo.stderr.on("data", (fragmento: Buffer) => errores.push(fragmento));
    hijo.on("error", (error) => resolver({ codigo: 127, stdout: "", stderr: error.message }));
    hijo.on("close", (codigo) => resolver({ codigo: codigo ?? 1, stdout: Buffer.concat(salida).toString("utf8"), stderr: Buffer.concat(errores).toString("utf8") }));
    if (entrada !== undefined) hijo.stdin.end(entrada);
    else hijo.stdin.end();
  });
}

function argumentoShell(valor: string): string {
  return /^[\w@%+=:,./-]+$/.test(valor) ? valor : `"${valor.replace(/(["\\$`])/g, "\\$1")}"`;
}

async function ssh(comandoRemoto: string, entrada?: string): Promise<Resultado> {
  return ejecutar("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", SSH_ALIAS, comandoRemoto], entrada);
}

/** Corre el lector dentro del contenedor web del VPS y devuelve sus líneas JSONL. */
async function lectorRemoto(peticion: PeticionLector): Promise<string[]> {
  const fuente = readFileSync(path.join(__dirname, "registros", "lector.ts"), "utf8");
  const ts = (await import("typescript")).default;
  const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const script = `${js}\nmain(process.argv[process.argv.length - 1]);\n`;
  const carga = Buffer.from(JSON.stringify(peticion), "utf8").toString("base64");
  const resultado = await ssh(`docker exec -i ${CONTENEDOR_WEB} node - ${carga}`, script);
  if (resultado.codigo !== 0) fallar(`El lector remoto falló (código ${resultado.codigo}):\n${resultado.stderr.trim()}`);
  if (resultado.stderr.trim()) process.stderr.write(resultado.stderr);
  return resultado.stdout.split("\n").filter((linea) => linea.trim());
}

function raicesLocales(opciones: Opciones): string[] {
  const principal = opciones.raiz ? path.resolve(opciones.raiz) : process.env.REGISTRO_DIR ? path.resolve(process.env.REGISTRO_DIR) : path.join(process.cwd(), "data", "registros");
  return [principal, path.join(tmpdir(), "demo-decoracion-registros")];
}

/* ---------- Formato legible ---------- */

function parsear(linea: string): Record<string, unknown> | undefined {
  try {
    const valor: unknown = JSON.parse(linea);
    return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function corto(valor: string, maximo: number): string {
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio;
}

function hora(ts: string): string {
  const fecha = new Date(ts);
  if (Number.isNaN(fecha.getTime())) return ts;
  const dos = (numero: number) => String(numero).padStart(2, "0");
  return `${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}.${String(fecha.getMilliseconds()).padStart(3, "0")}`;
}

function compacto(valor: unknown, maximo = 90): string {
  if (valor === undefined) return "";
  if (typeof valor === "string") return `«${corto(valor, maximo)}»`;
  if (typeof valor === "number" || typeof valor === "boolean" || valor === null) return String(valor);
  let json = "";
  try {
    json = JSON.stringify(valor);
  } catch {
    json = String(valor);
  }
  return corto(json, maximo);
}

function paresDatos(datos: unknown, maximo = 320): string {
  if (!esObjeto(datos)) return datos === undefined ? "" : compacto(datos, maximo);
  const partes: string[] = [];
  for (const [clave, valor] of Object.entries(datos)) {
    const fragmento = typeof valor === "string" ? (/\s/.test(valor) || valor.length > 60 ? `${clave}=${compacto(valor, 60)}` : `${clave}=${valor}`) : `${clave}=${compacto(valor, 60)}`;
    partes.push(fragmento);
    if (partes.join(" ").length > maximo) break;
  }
  return corto(partes.join(" "), maximo);
}

function formatoGeneral(linea: string): string {
  const objeto = parsear(linea);
  if (!objeto) return linea;
  if (objeto.tipo && !objeto.evento) return formatoAuditoriaSuelta(objeto);
  // Líneas JSON que no son del registro (p. ej. «banderas_efectivas» del arranque): tal cual, compactas.
  if (!objeto.ts || !objeto.nivel) return compacto(objeto, 600);
  const correlacion = [
    objeto.solicitud ? `sol=${texto(objeto.solicitud).slice(0, 8)}` : "",
    objeto.conversacion ? `conv=${texto(objeto.conversacion)}` : "",
    objeto.vista ? `vista=${texto(objeto.vista)}` : "",
  ].filter(Boolean).join(" ");
  const error = esObjeto(objeto.error) ? ` ✖ ${nombreError(objeto.error)}${corto(texto(objeto.error.mensaje), 200)}` : "";
  return [
    hora(texto(objeto.ts)),
    texto(objeto.nivel).toUpperCase().padEnd(5),
    texto(objeto.evento),
    correlacion ? `[${correlacion}]` : "",
    texto(objeto.ruta),
    typeof objeto.ms === "number" ? `${objeto.ms}ms` : "",
    paresDatos(objeto.datos),
  ].filter(Boolean).join(" ") + error;
}

function formatoAuditoriaSuelta(objeto: Record<string, unknown>): string {
  return `${hora(texto(objeto.ts))} AUDIT ${texto(objeto.tipo)} [conv=${texto(objeto.conversacion)} sol=${texto(objeto.solicitud).slice(0, 8)}] ${resumenEvento(texto(objeto.tipo), objeto.datos)}`;
}

function nombreError(error: Record<string, unknown>): string {
  const nombre = texto(error.nombre);
  return nombre ? `${nombre}: ` : "";
}

function nombresLlamadas(valor: unknown): string {
  if (!Array.isArray(valor)) return "";
  return valor.map((llamada) => (esObjeto(llamada) ? texto(llamada.nombre) : "?")).join(", ");
}

/** Una línea legible por tipo de evento de auditoría. */
function resumenEvento(tipo: string, datos: unknown): string {
  if (!esObjeto(datos)) return compacto(datos);
  const error = esObjeto(datos.error) ? ` ✖ ${nombreError(datos.error)}${corto(texto(datos.error.mensaje), 160)}` : "";
  switch (tipo) {
    case "entrada_usuario": {
      const adjuntos = Array.isArray(datos.adjuntos) ? ` adjuntos=${datos.adjuntos.length}` : "";
      const estado = esObjeto(datos.estadoCliente) ? ` estado=[${Object.keys(datos.estadoCliente).join(",")}]` : "";
      return `${texto(datos.metodo)} ${datos.texto !== undefined ? compacto(datos.texto, 140) : ""}${adjuntos}${estado}`;
    }
    case "llamada_ia": {
      const mensajes = Array.isArray(datos.mensajes) ? datos.mensajes : [];
      const nuevos = mensajes.filter((mensaje) => esObjeto(mensaje) && mensaje.ref === undefined).length;
      const herramientas = esObjeto(datos.herramientas) && Array.isArray(datos.herramientas.nombres) ? ` · ${datos.herramientas.nombres.length} herramientas` : "";
      const sistema = esObjeto(datos.sistema) ? ` · sistema ${texto(datos.sistema.sha256).slice(0, 8)}${datos.sistema.texto !== undefined ? " (completo aquí)" : ""} ${String(datos.sistema.caracteres ?? "")} car.` : "";
      return `[${texto(datos.llamada)}] ${texto(datos.proveedor)}/${texto(datos.modelo) || "?"} ${texto(datos.proposito)} · ${mensajes.length} mensajes (${nuevos} nuevos)${herramientas}${sistema}`;
    }
    case "respuesta_ia": {
      const tokens = esObjeto(datos.tokens) ? ` · in ${String(datos.tokens.entrada ?? "?")}/out ${String(datos.tokens.salida ?? "?")}` : "";
      const llamadas = nombresLlamadas(datos.llamadasHerramientas);
      return `[${texto(datos.llamada)}] ${String(datos.ms ?? "?")}ms${datos.motivoFin ? ` · ${texto(datos.motivoFin)}` : ""}${tokens}${llamadas ? ` · llama: ${llamadas}` : ""}${datos.interrumpida ? " · INTERRUMPIDA" : ""}${datos.texto ? ` · ${compacto(datos.texto, 160)}` : ""}${error}`;
    }
    case "herramienta":
      return `${texto(datos.nombre)} ${datos.ok === false ? "NO-OK" : "ok"} ${String(datos.ms ?? "?")}ms args=${compacto(datos.argumentos, 100)} → ${compacto(datos.resultado, 140)}${error}`;
    case "decision":
      return `${texto(datos.quien)}: ${texto(datos.que)} → ${compacto(datos.resultado, 160)}${datos.motivo ? ` (${texto(datos.motivo)})` : ""}`;
    case "python":
      return `${texto(datos.metodo)} ${texto(datos.ruta)} → ${String(datos.estado ?? "✖")} ${String(datos.ms ?? "?")}ms${datos.msCuerpo !== undefined ? ` (cuerpo ${String(datos.msCuerpo)}ms)` : ""} ${compacto(datos.cuerpoRecibido, 120)}${error}`;
    case "http":
      return `${texto(datos.proveedor)} ${texto(datos.metodo)} ${corto(texto(datos.url), 80)} → ${String(datos.estado ?? "✖")} ${String(datos.ms ?? "?")}ms${error}`;
    case "imagen": {
      const referencias = Array.isArray(datos.referencias) ? ` · ${datos.referencias.length} referencias` : "";
      const resultado = esObjeto(datos.resultado) ? ` → ${texto(datos.resultado.url) || texto(datos.resultado.imagen).slice(0, 12)}` : "";
      return `${texto(datos.proveedor)} ${texto(datos.endpoint)} ${String(datos.ms ?? "?")}ms${referencias} · prompt ${compacto(datos.prompt, 120)}${resultado}${error}`;
    }
    case "salida": {
      const eventos = esObjeto(datos.eventos) ? ` · eventos ${Object.entries(datos.eventos).map(([clave, valor]) => `${clave}=${String(valor)}`).join(" ")}` : "";
      const cuerpo = datos.texto !== undefined ? ` · ${compacto(datos.texto, 160)}` : datos.cuerpo !== undefined ? ` · ${compacto(datos.cuerpo, 160)}` : "";
      return `${String(datos.estado ?? "?")} ${texto(datos.tipoContenido).split(";")[0]} ${String(datos.ms ?? "?")}ms${eventos}${cuerpo}${datos.cancelada ? " · CANCELADA" : ""}`;
    }
    case "accion_cliente":
      return `${texto(datos.evento)} ${compacto(datos.datos, 160)}`;
    case "error":
      return `${texto(datos.origen)}${esObjeto(datos.error) ? ` ✖ ${nombreError(datos.error)}${corto(texto(datos.error.mensaje), 200)}` : ` ${compacto(datos.error, 200)}`}`;
    default:
      return compacto(datos, 200);
  }
}

function imprimirLineaDeTiempo(id: string, lineas: string[], completo: boolean): void {
  const objetos = lineas.map(parsear).filter((objeto): objeto is Record<string, unknown> => Boolean(objeto));
  const llamadas = objetos.filter((objeto) => objeto.tipo === "llamada_ia").length;
  const errores = objetos.filter((objeto) => objeto.tipo === "error" || (esObjeto(objeto.datos) && esObjeto(objeto.datos.error))).length;
  const vista = texto(objetos.find((objeto) => objeto.vista)?.vista);
  console.log(`Conversación ${id}${vista ? ` · vista ${vista}` : ""} · ${objetos.length} eventos · ${llamadas} llamadas IA · ${errores} errores`);
  let solicitudActual = "";
  let inicioTurno = 0;
  for (const objeto of objetos) {
    const solicitud = texto(objeto.solicitud);
    const ts = Date.parse(texto(objeto.ts));
    if (solicitud !== solicitudActual) {
      solicitudActual = solicitud;
      inicioTurno = ts;
      console.log(`\n── solicitud ${solicitud.slice(0, 13)} · ${texto(objeto.ruta) || "?"} · ${hora(texto(objeto.ts))} ${"─".repeat(30)}`);
    }
    const relativo = Number.isFinite(ts) && Number.isFinite(inicioTurno) ? `+${((ts - inicioTurno) / 1000).toFixed(3)}s` : "";
    const tipo = texto(objeto.tipo);
    console.log(`  ${relativo.padStart(9)}  ${tipo.padEnd(15)} ${resumenEvento(tipo, objeto.datos)}`);
    if (completo) console.log(JSON.stringify(objeto.datos, null, 2).split("\n").map((fila) => `             ${fila}`).join("\n"));
  }
}

function imprimirListado(resumenes: ResumenConversacion[]): void {
  if (!resumenes.length) {
    console.log("Sin conversaciones en esa ventana.");
    return;
  }
  const filas = resumenes.map((resumen) => [
    resumen.id,
    hora(resumen.inicio),
    resumen.vista ?? "-",
    String(resumen.eventos),
    String(resumen.llamadasIa),
    String(resumen.errores),
    `${resumen.ultimoTipo} @ ${hora(resumen.fin)}`,
    `${Math.round(resumen.bytes / 1024)} kB`,
  ]);
  const cabecera = ["id", "inicio", "vista", "eventos", "llamadas IA", "errores", "último evento", "tamaño"];
  const anchos = cabecera.map((titulo, columna) => Math.max(titulo.length, ...filas.map((fila) => fila[columna]!.length)));
  const pintar = (fila: string[]) => fila.map((celda, columna) => celda.padEnd(anchos[columna]!)).join("  ");
  console.log(pintar(cabecera));
  for (const fila of filas) console.log(pintar(fila));
}

/* ---------- Orígenes ---------- */

async function lineasGeneral(opciones: Opciones): Promise<string[]> {
  const filtros = filtrosDe(opciones, "1h");
  if (opciones.origen === "local") return leerGeneral(raicesLocales(opciones), filtros);
  if (opciones.stdout) {
    const resultado = await ssh(`docker logs --since ${argumentoShell(desdeParaDocker(opciones.desde, "1h"))} ${CONTENEDOR_WEB}`);
    if (resultado.codigo !== 0) fallar(resultado.stderr.trim() || "docker logs falló");
    const todas = `${resultado.stdout}\n${resultado.stderr}`.split("\n").filter((linea) => linea.trim().startsWith("{"));
    return todas.filter((linea) => coincideLinea(linea, filtros)).slice(-(opciones.ultimos ?? 200));
  }
  return lectorRemoto({ operacion: "general", raices: RAICES_VPS, filtros });
}

async function verGeneral(opciones: Opciones): Promise<void> {
  const lineas = await lineasGeneral(opciones);
  if (!lineas.length) {
    console.error("Sin líneas con esos filtros (prueba --desde 6h, --nivel debug o `diagnostico`).");
    return;
  }
  for (const linea of lineas) console.log(opciones.json ? linea : formatoGeneral(linea));
}

async function verConversaciones(opciones: Opciones): Promise<void> {
  const remoto = opciones.origen === "vps";
  if (!remoto && opciones.origen !== "local") fallar("La auditoría por conversación solo existe en archivos: usa --origen local o vps (en Vercel: --origen vercel --conversacion <id> busca en stdout).");
  const raices = remoto ? RAICES_VPS : raicesLocales(opciones);
  if (opciones.conversacion) {
    let id: string | undefined;
    let lineas: string[];
    let candidatos: string[] = [];
    if (remoto) {
      const salida = await lectorRemoto({ operacion: "conversacion", raices, id: opciones.conversacion });
      const cabecera = parsear(salida[0] ?? "") ?? {};
      id = texto(cabecera.id) || undefined;
      candidatos = Array.isArray(cabecera.candidatos) ? cabecera.candidatos.map(String) : [];
      lineas = salida.slice(1);
    } else {
      const resultado = await leerConversacion(raices, opciones.conversacion);
      id = resultado.id;
      lineas = resultado.lineas;
      candidatos = resultado.candidatos;
    }
    if (!id) {
      fallar(candidatos.length ? `Varias conversaciones empiezan así:\n  ${candidatos.join("\n  ")}` : `No hay ninguna conversación ${opciones.conversacion} en ${opciones.origen}.`);
    }
    if (opciones.descargar) {
      mkdirSync(opciones.descargar, { recursive: true });
      const destino = path.join(opciones.descargar, `${id}.jsonl`);
      writeFileSync(destino, `${lineas.join("\n")}\n`, "utf8");
      console.log(`Guardado ${destino} (${lineas.length} líneas)`);
      return;
    }
    if (opciones.json) {
      for (const linea of lineas) console.log(linea);
      return;
    }
    imprimirLineaDeTiempo(id, lineas, opciones.completo);
    return;
  }
  const filtros = { ...filtrosDe(opciones, "24h"), conversacion: undefined };
  const resumenes = remoto
    ? (await lectorRemoto({ operacion: "conversaciones", raices, filtros })).map((linea) => parsear(linea) as unknown as ResumenConversacion)
    : await listarConversaciones(raices, filtros);
  if (opciones.json) {
    for (const resumen of resumenes) console.log(JSON.stringify(resumen));
    return;
  }
  imprimirListado(resumenes);
}

async function verPython(opciones: Opciones): Promise<void> {
  const filtrar = (lineas: string[]): string[] => lineas
    .filter((linea) => linea.trim())
    .filter((linea) => opciones.incluirSalud || !/GET \/healthz/.test(linea))
    .filter((linea) => !opciones.buscar || linea.toLowerCase().includes(opciones.buscar.toLowerCase()))
    .filter((linea) => !opciones.solicitud || linea.includes(opciones.solicitud))
    .filter((linea) => !opciones.nivel || new RegExp(`\\b(${opciones.nivel === "error" ? "ERROR|CRITICAL" : opciones.nivel === "warn" ? "WARNING|ERROR|CRITICAL" : "INFO|WARNING|ERROR|CRITICAL|DEBUG"})\\b`).test(linea))
    .slice(-(opciones.ultimos ?? 200));
  if (opciones.origen === "python-vps") {
    const resultado = await ssh(`docker logs --timestamps --since ${argumentoShell(desdeParaDocker(opciones.desde, "1h"))} ${CONTENEDOR_PYTHON}`);
    if (resultado.codigo !== 0) fallar(resultado.stderr.trim() || "docker logs falló");
    // docker logs manda el stderr del contenedor a su stderr: se mezclan y se ordenan por la marca de tiempo.
    const lineas = `${resultado.stdout}\n${resultado.stderr}`.split("\n").sort();
    for (const linea of filtrar(lineas)) console.log(linea);
    return;
  }
  const carpeta = path.join(raicesLocales(opciones)[0]!, "python");
  const archivos = existsSync(carpeta) ? readdirSync(carpeta).filter((nombre) => /\.(log|jsonl|txt)$/.test(nombre)).sort() : [];
  if (!archivos.length) {
    console.log([
      "El Python local no escribe a archivo: sus registros salen en la consola del supervisor.",
      "Para que este comando los lea, arráncalo redirigiendo la salida, p. ej.:",
      "  python scripts/ops/supervisar-ai-api.py > data/registros/python/ai-api.log 2>&1",
      "Mientras tanto: curl http://127.0.0.1:8000/healthz",
    ].join("\n"));
    return;
  }
  const lineas = archivos.flatMap((nombre) => readFileSync(path.join(carpeta, nombre), "utf8").split(/\r?\n/));
  for (const linea of filtrar(lineas)) console.log(linea);
}

function mensajeVercel(objeto: Record<string, unknown>): string {
  for (const clave of ["message", "text", "msg", "log"]) if (typeof objeto[clave] === "string") return objeto[clave] as string;
  if (esObjeto(objeto.payload) && typeof objeto.payload.text === "string") return objeto.payload.text;
  return "";
}

async function verVercel(opciones: Opciones): Promise<void> {
  const desde = opciones.desde ?? "1h";
  const argumentos = ["logs", "--project", PROYECTO_VERCEL, "--since", desde, "--limit", String(Math.max(opciones.ultimos ?? 200, 100)), "--json", "--non-interactive"];
  if (opciones.hasta) argumentos.push("--until", opciones.hasta);
  if (opciones.nivel === "error") argumentos.push("--level", "error");
  else if (opciones.nivel === "warn") argumentos.push("--level", "warning");
  if (opciones.buscar) argumentos.push("--query", opciones.buscar);
  const entorno = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ") };
  const windows = process.platform === "win32";
  const resultado = await ejecutar("vercel", argumentos, undefined, entorno, windows);
  if (resultado.codigo !== 0) fallar(`vercel logs falló (${resultado.codigo}): ${resultado.stderr.trim()}`);
  const filtros = filtrosDe({ ...opciones, buscar: undefined }, desde);
  let impresas = 0;
  for (const cruda of resultado.stdout.split("\n").filter((linea) => linea.trim())) {
    const objeto = parsear(cruda);
    if (!objeto) continue;
    const mensaje = mensajeVercel(objeto);
    const nuestras = mensaje.split("\n").filter((linea) => linea.trim().startsWith("{\"ts\""));
    if (nuestras.length) {
      for (const linea of nuestras) {
        if (!coincideLinea(linea, filtros)) continue;
        console.log(opciones.json ? linea : formatoGeneral(linea));
        impresas += 1;
      }
    } else if (!opciones.evento && !opciones.solicitud && !opciones.conversacion) {
      console.log(opciones.json ? cruda : `${texto(objeto.timestamp) || texto(objeto.date) || ""} ${texto(objeto.level)} ${texto(objeto.requestPath) || texto(objeto.path)} ${corto(mensaje, 300)}`.trim());
      impresas += 1;
    }
  }
  if (!impresas) console.error("Sin líneas en Vercel con esos filtros (los registros de Vercel solo viven en stdout y con retención corta).");
}

async function verDiagnostico(opciones: Opciones): Promise<void> {
  if (opciones.origen === "vps") {
    const lineas = await lectorRemoto({ operacion: "diagnostico", raices: RAICES_VPS });
    const permisos = await ssh(`docker exec ${CONTENEDOR_WEB} sh -c 'id; ls -ld /app/data /app/data/registros 2>&1; touch /app/data/registros/.prueba 2>&1 && rm /app/data/registros/.prueba && echo ESCRIBIBLE || echo NO-ESCRIBIBLE'`);
    for (const linea of lineas) console.log(JSON.stringify(parsear(linea), null, 2));
    console.log(permisos.stdout.trim());
    return;
  }
  console.log(JSON.stringify(diagnostico(raicesLocales(opciones)), null, 2));
}

async function principal(): Promise<void> {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.ayuda) {
    console.log(AYUDA);
    return;
  }
  if (opciones.subcomando === "diagnostico") return verDiagnostico(opciones);
  if (opciones.origen === "python-vps" || opciones.origen === "python-local") return verPython(opciones);
  if (opciones.origen === "vercel") return verVercel(opciones);
  if (opciones.subcomando === "conversaciones") return verConversaciones(opciones);
  return verGeneral(opciones);
}

principal().catch((error: unknown) => fallar(error instanceof Error ? error.stack ?? error.message : String(error)));
