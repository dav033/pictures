import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const DIR = path.join(process.cwd(), "scripts", "migrations");

/**
 * Clave fija del advisory lock. Cualquier proceso que aplique migraciones a
 * esta base toma la misma clave, así que dos ejecuciones concurrentes se
 * serializan en vez de intentar aplicar el mismo archivo a la vez.
 */
const CLAVE_LOCK = 1836345458;

/** Hosts que se consideran locales y no exigen `--allow-remote`. */
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Renombrados históricos de archivos de migración.
 *
 * `schema_migrations` usa `filename` como clave, así que renombrar un archivo
 * ya aplicado haría que se volviera a aplicar en cualquier entorno donde ya
 * estaba. Antes de decidir qué falta, el runner reconcilia el registro: si
 * existe una fila con el nombre viejo y ninguna con el nuevo, la actualiza.
 *
 * Una entrada solo se retira cuando se pueda afirmar que ningún entorno
 * conserva el nombre viejo. Mientras haya duda, se queda.
 */
const RENOMBRADOS: Array<{ antes: string; despues: string }> = [
  // Primera colisión: existían dos archivos `016_`. El de LoRA ya estaba
  // aplicado en bases reales y conserva su número; el operacional solo se
  // había aplicado a un PostgreSQL Docker desechable, y se movió a 019.
  //
  // Segunda colisión, al mezclar `main`: allí se creó `019_happie_webhook.sql`,
  // que puede estar aplicada en una base real. El operacional se mueve otra vez,
  // ahora a 020. Se conservan las dos entradas porque cualquiera de los dos
  // nombres viejos puede estar registrado en algún entorno.
  { antes: "016_operational_idempotency.sql", despues: "020_operational_idempotency.sql" },
  { antes: "019_operational_idempotency.sql", despues: "020_operational_idempotency.sql" },
];

type Opciones = {
  dryRun: boolean;
  allowRemote: boolean;
  target: string | null;
};

function leerOpciones(argv: string[]): Opciones {
  const opciones: Opciones = { dryRun: false, allowRemote: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opciones.dryRun = true;
    else if (arg === "--allow-remote") opciones.allowRemote = true;
    else if (arg === "--target") {
      const valor = argv[i + 1];
      if (!valor) throw new Error("--target necesita un nombre de archivo.");
      opciones.target = valor;
      i++;
    } else if (arg.startsWith("--target=")) {
      opciones.target = arg.slice("--target=".length);
    } else {
      throw new Error(`Opción desconocida: ${arg}. Válidas: --dry-run, --allow-remote, --target <archivo>.`);
    }
  }
  return opciones;
}

/**
 * El contenido se normaliza a LF antes de hashear y antes de ejecutar. En
 * Windows, Git puede materializar el mismo archivo con CRLF; sin normalizar,
 * el checksum de una migración ya aplicada cambiaría solo por el sistema
 * operativo que la leyó.
 */
function leerSql(archivo: string): string {
  return readFileSync(path.join(DIR, archivo), "utf-8").replace(/\r\n/g, "\n");
}

function checksumDe(sql: string): string {
  return createHash("sha256").update(sql, "utf-8").digest("hex");
}

function archivosDeMigracion(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Dos archivos con el mismo prefijo numérico dejan el orden de aplicación a
 * merced del desempate alfabético del nombre. Hoy funcionaba por accidente;
 * a partir de aquí es un error.
 */
function validarNumeracion(archivos: string[]): void {
  const porNumero = new Map<string, string[]>();
  for (const archivo of archivos) {
    const numero = /^(\d+)_/.exec(archivo)?.[1];
    if (!numero) throw new Error(`Migración sin prefijo numérico: ${archivo}`);
    porNumero.set(numero, [...(porNumero.get(numero) ?? []), archivo]);
  }
  const colisiones = [...porNumero.entries()].filter(([, lista]) => lista.length > 1);
  if (colisiones.length > 0) {
    const detalle = colisiones.map(([numero, lista]) => `  ${numero}: ${lista.join(", ")}`).join("\n");
    throw new Error(
      "Colisión de número de migración. Renumera uno de los archivos y añade su\n" +
        `entrada a RENOMBRADOS en este script para que no se vuelva a aplicar:\n${detalle}`,
    );
  }
}

/**
 * Aviso, no error: las migraciones existentes no tienen nota de reversión, y
 * escribir una por cada una exige entender qué hace y qué deja atrás. No se
 * inventa. Los archivos nuevos deberían llevarla desde el principio.
 */
function avisarReversionesFaltantes(archivos: string[]): void {
  const sinNota = archivos.filter((archivo) => !/^\s*--\s*rollback:/im.test(leerSql(archivo)));
  if (sinNota.length === 0) return;
  console.warn(`[AVISO] ${sinNota.length} migración(es) sin nota "-- rollback:".`);
  console.warn('        Documenta cómo revertir cada una, aunque sea "no reversible, requiere restore".');
}

function describirDestino(dsn: string): { etiqueta: string; host: string; esLocal: boolean } {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida. No se intenta adivinar el destino.");
  }
  const host = url.hostname;
  const puerto = url.port || "5432";
  const base = url.pathname.replace(/^\//, "") || "(sin nombre)";
  const usuario = url.username || "(sin usuario)";
  return {
    // La contraseña nunca se imprime ni se registra.
    etiqueta: `${usuario}@${host}:${puerto}/${base}`,
    host,
    esLocal: HOSTS_LOCALES.has(host),
  };
}

async function reconciliarRenombrados(cliente: Client): Promise<void> {
  for (const { antes, despues } of RENOMBRADOS) {
    const { rowCount } = await cliente.query(
      `UPDATE schema_migrations SET filename = $2
        WHERE filename = $1
          AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $2)`,
      [antes, despues],
    );
    if (rowCount && rowCount > 0) {
      console.log(`[RECONCILIADO] ${antes} -> ${despues} (ya estaba aplicada, no se re-aplica)`);
    }
  }
}

type FilaAplicada = { filename: string; checksum: string | null };

/**
 * Un checksum distinto significa que una migración ya aplicada cambió de
 * contenido. No se re-aplica ni se ignora: se detiene la ejecución, porque el
 * entorno y el repositorio ya divergieron y solo una persona puede decidir
 * cómo cerrarlo.
 *
 * Las filas con checksum `NULL` son de antes de que esta columna existiera. Se
 * adoptan una vez con el checksum actual, avisando de que no se verificaron.
 */
async function verificarChecksums(cliente: Client, aplicadas: FilaAplicada[], presentes: Set<string>): Promise<void> {
  const divergentes: string[] = [];
  const adoptadas: string[] = [];

  for (const fila of aplicadas) {
    if (!presentes.has(fila.filename)) continue;
    const actual = checksumDe(leerSql(fila.filename));
    if (fila.checksum === null) {
      await cliente.query("UPDATE schema_migrations SET checksum = $2 WHERE filename = $1", [fila.filename, actual]);
      adoptadas.push(fila.filename);
    } else if (fila.checksum !== actual) {
      divergentes.push(`  ${fila.filename}\n    registrado: ${fila.checksum}\n    actual:     ${actual}`);
    }
  }

  if (adoptadas.length > 0) {
    console.warn(`[AVISO] ${adoptadas.length} migración(es) sin checksum registrado: adoptadas sin verificar.`);
    for (const nombre of adoptadas) console.warn(`        ${nombre}`);
  }

  if (divergentes.length > 0) {
    throw new Error(
      "El contenido de una migración ya aplicada cambió. Este entorno y el\n" +
        `repositorio divergieron; no se aplica nada más.\n${divergentes.join("\n")}`,
    );
  }

  const huerfanas = aplicadas.map((f) => f.filename).filter((nombre) => !presentes.has(nombre));
  if (huerfanas.length > 0) {
    console.warn(`[AVISO] ${huerfanas.length} migración(es) aplicada(s) que ya no existen en el repo:`);
    for (const nombre of huerfanas) console.warn(`        ${nombre}`);
  }
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));

  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error("DATABASE_URL no está configurada.");

  const destino = describirDestino(dsn);
  console.log(`Destino: ${destino.etiqueta}`);
  console.log(`Modo:    ${opciones.dryRun ? "dry-run (no escribe)" : "aplicar"}`);

  if (!destino.esLocal && !opciones.allowRemote && !opciones.dryRun) {
    throw new Error(
      `El destino "${destino.host}" no es local y no se pasó --allow-remote.\n` +
        "Confirma que esa es la base correcta y vuelve a ejecutar con --allow-remote,\n" +
        "o usa --dry-run para ver qué se aplicaría sin escribir nada.",
    );
  }

  const archivos = archivosDeMigracion();
  validarNumeracion(archivos);
  avisarReversionesFaltantes(archivos);

  if (opciones.target && !archivos.includes(opciones.target)) {
    throw new Error(`--target ${opciones.target} no existe en ${DIR}`);
  }

  // Un solo cliente para toda la ejecución: el advisory lock es de sesión y
  // las transacciones necesitan la misma conexión de principio a fin. Con un
  // Pool, BEGIN y COMMIT pueden salir por conexiones distintas.
  const cliente = new Client({ connectionString: dsn });
  await cliente.connect();

  let lockTomado = false;
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_LOCK]);
    lockTomado = true;

    if (opciones.dryRun) {
      // Dry-run no escribe NADA, ni la tabla de registro. Si `schema_migrations`
      // todavía no existe, todo está pendiente y así se reporta.
      const { rows } = await cliente.query<{ existe: string | null }>(
        "SELECT to_regclass('schema_migrations')::text AS existe",
      );
      const yaAplicadas = new Set<string>();
      if (rows[0]?.existe) {
        const { rows: filas } = await cliente.query<{ filename: string }>(
          "SELECT filename FROM schema_migrations ORDER BY filename",
        );
        for (const fila of filas) yaAplicadas.add(fila.filename);
      } else {
        console.log("[DRY-RUN] schema_migrations no existe todavía: la base está sin migrar.");
      }
      for (const { antes, despues } of RENOMBRADOS) {
        if (yaAplicadas.has(antes) && !yaAplicadas.has(despues)) {
          console.log(`[RECONCILIARÍA] ${antes} -> ${despues}`);
          yaAplicadas.delete(antes);
          yaAplicadas.add(despues);
        }
      }
      const pendientes = archivos.filter((a) => !yaAplicadas.has(a));
      const hasta = opciones.target ? pendientes.slice(0, pendientes.indexOf(opciones.target) + 1) : pendientes;
      if (hasta.length === 0) {
        console.log(`[DRY-RUN] Nada pendiente. ${yaAplicadas.size} migración(es) ya aplicada(s).`);
      } else {
        console.log(`[DRY-RUN] ${hasta.length} migración(es) se aplicarían, en este orden:`);
        for (const archivo of hasta) console.log(`  ${archivo}  ${checksumDe(leerSql(archivo)).slice(0, 12)}`);
      }
      return;
    }

    await cliente.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename    TEXT PRIMARY KEY,
         applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await cliente.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
    await reconciliarRenombrados(cliente);

    const { rows: aplicadas } = await cliente.query<FilaAplicada>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    await verificarChecksums(cliente, aplicadas, new Set(archivos));

    const yaAplicadas = new Set(aplicadas.map((f) => f.filename));

    let nuevas = 0;
    for (const archivo of archivos) {
      if (yaAplicadas.has(archivo)) continue;
      const sql = leerSql(archivo);
      console.log(`Aplicando ${archivo}...`);
      await cliente.query("BEGIN");
      try {
        await cliente.query(sql);
        await cliente.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
          archivo,
          checksumDe(sql),
        ]);
        await cliente.query("COMMIT");
      } catch (error) {
        await cliente.query("ROLLBACK");
        throw error;
      }
      nuevas++;
      if (opciones.target === archivo) {
        console.log(`[TARGET] Se detiene en ${archivo} como se pidió.`);
        break;
      }
    }
    console.log(`[PASS] ${nuevas} migración(es) nueva(s) aplicada(s), ${yaAplicadas.size} ya estaban.`);
  } finally {
    if (lockTomado) {
      try {
        await cliente.query("SELECT pg_advisory_unlock($1)", [CLAVE_LOCK]);
      } catch {
        // La sesión se cierra abajo y el lock se libera con ella; no se oculta
        // el error original de la migración por un fallo al desbloquear.
      }
    }
    await cliente.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] migración falló:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
