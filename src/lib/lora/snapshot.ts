import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { leerComposicionLocal, type Composicion } from "./composicion";
import { readLoraDatasetV005View, type LoraDatasetGalleryData } from "./dataset-v005-view";
import { directorioImagenesSnapshot, prepararImagenesSnapshot } from "./snapshot-imagenes";

/**
 * Empaqueta el estado local (estadísticas del LoRA + metadata del dataset
 * gallery) en un único JSON para poder llevarlo a un servidor que no tiene
 * acceso a las fuentes originales (ver PLAN de esta sesión: snapshot,
 * no lectura viva, y sin imágenes/pesos — solo estadísticas).
 */

export type LoraSnapshot = {
  generatedAt: string;
  composicion: Composicion | null;
  datasetGallery: LoraDatasetGalleryData | null;
};

export type PublishResult = {
  publishedAt: string;
  host: string;
  container: string;
  containerPath: string;
  ok: boolean;
  imagenes?: { enviadas: number; sinOrigen: number; mb: number };
  error?: string;
};

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshot");
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, "lora-estado.json");
const PUBLISH_STATE_PATH = path.join(SNAPSHOT_DIR, "estado-publicacion.json");
const SCP_TIMEOUT_MS = 15_000;
const TRANSFERENCIA_TIMEOUT_MS = 300_000;
const DEFAULT_CONTAINER_PATH = "/app/data/snapshot/lora-estado.json";
const TAR_LOCAL = path.join(SNAPSHOT_DIR, "imagenes.tar");

export function buildSnapshot(): LoraSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    composicion: leerComposicionLocal(),
    datasetGallery: readLoraDatasetV005View(),
  };
}

function writeJsonAtomic(target: string, data: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporary, target);
}

export function writeLocalSnapshot(snapshot: LoraSnapshot): void {
  writeJsonAtomic(SNAPSHOT_PATH, snapshot);
}

export function readLocalSnapshot(): LoraSnapshot | null {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as LoraSnapshot;
  } catch {
    return null;
  }
}

export function readLastPublishState(): PublishResult | null {
  try {
    return JSON.parse(fs.readFileSync(PUBLISH_STATE_PATH, "utf8")) as PublishResult;
  } catch {
    return null;
  }
}

function runCommand(command: string, args: string[], timeout: number = SCP_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve();
    });
  });
}

/**
 * Empaqueta las fotos de la galería y las mete en el volumen del contenedor.
 *
 * Van en un tar porque son ~276 archivos: mandarlos uno a uno por scp sería
 * un round trip por foto. `docker cp` no extrae, así que el tar se copia
 * adentro y se desempaca con `docker exec`.
 */
async function publicarImagenes(
  host: string,
  container: string,
  snapshot: LoraSnapshot,
): Promise<PublishResult["imagenes"]> {
  const resumen = await prepararImagenesSnapshot(snapshot);
  const destinoContenedor = path.posix.join(path.posix.dirname(DEFAULT_CONTAINER_PATH), "imagenes");
  const tarRemoto = `~/.demo-decoracion-imagenes-${process.pid}.tar`;
  const tarEnContenedor = `/tmp/imagenes-${process.pid}.tar`;

  await runCommand("tar", ["-cf", TAR_LOCAL, "-C", directorioImagenesSnapshot(), "."], TRANSFERENCIA_TIMEOUT_MS);
  try {
    await runCommand("scp", [TAR_LOCAL, `${host}:${tarRemoto}`], TRANSFERENCIA_TIMEOUT_MS);
    await runCommand("ssh", [host, "docker", "exec", container, "mkdir", "-p", destinoContenedor]);
    await runCommand("ssh", [host, "docker", "cp", tarRemoto, `${container}:${tarEnContenedor}`], TRANSFERENCIA_TIMEOUT_MS);
    await runCommand("ssh", [host, "docker", "exec", container, "tar", "-xf", tarEnContenedor, "-C", destinoContenedor], TRANSFERENCIA_TIMEOUT_MS);
  } finally {
    // `docker cp` deposita el tar como root y el contenedor corre como nextjs,
    // así que borrarlo necesita -u root. Nada de esto puede tumbar una
    // publicación que ya dejó las fotos en su lugar.
    await runCommand("ssh", [host, "docker", "exec", "-u", "root", container, "rm", "-f", tarEnContenedor]).catch(() => undefined);
    await runCommand("ssh", [host, "rm", "-f", tarRemoto]).catch(() => undefined);
    fs.rmSync(TAR_LOCAL, { force: true });
  }

  return {
    enviadas: resumen.preparadas + resumen.omitidas,
    sinOrigen: resumen.sinOrigen.length,
    mb: Number((resumen.bytes / 1024 / 1024).toFixed(1)),
  };
}

/**
 * Sube el snapshot local al servidor. El contenedor corre con un volumen
 * Docker nombrado (`-v demo-decoracion-data:/app/data`), así que el usuario
 * SSH no tiene permiso directo sobre el filesystem del volumen en el host
 * (es del uid del proceso dentro del contenedor) — hay que entrar por
 * `docker cp`, no por un scp directo a una ruta del host. Por eso primero se
 * sube a un temporal en el home del usuario SSH y de ahí se copia adentro.
 */
export async function publishSnapshotToServer(): Promise<PublishResult> {
  const snapshot = buildSnapshot();
  writeLocalSnapshot(snapshot);

  const host = process.env.LORA_SNAPSHOT_SSH_HOST?.trim();
  const container = process.env.LORA_SNAPSHOT_DOCKER_CONTAINER?.trim();
  const containerPath = process.env.LORA_SNAPSHOT_CONTAINER_PATH?.trim() || DEFAULT_CONTAINER_PATH;
  const publishedAt = new Date().toISOString();

  if (!host || !container) {
    const result: PublishResult = {
      publishedAt,
      host: host ?? "",
      container: container ?? "",
      containerPath,
      ok: false,
      error: "Destino no configurado: falta LORA_SNAPSHOT_SSH_HOST o LORA_SNAPSHOT_DOCKER_CONTAINER en .env.local",
    };
    writeJsonAtomic(PUBLISH_STATE_PATH, result);
    return result;
  }

  const remoteTmpPath = `~/.demo-decoracion-snapshot-tmp-${process.pid}.json`;
  const containerDir = path.posix.dirname(containerPath);

  try {
    await runCommand("scp", [SNAPSHOT_PATH, `${host}:${remoteTmpPath}`]);
    await runCommand("ssh", [host, "docker", "exec", container, "mkdir", "-p", containerDir]);
    await runCommand("ssh", [host, "docker", "cp", remoteTmpPath, `${container}:${containerPath}`]);
    await runCommand("ssh", [host, "rm", "-f", remoteTmpPath]);
    const imagenes = await publicarImagenes(host, container, snapshot);
    const result: PublishResult = { publishedAt, host, container, containerPath, ok: true, imagenes };
    writeJsonAtomic(PUBLISH_STATE_PATH, result);
    return result;
  } catch (error) {
    await runCommand("ssh", [host, "rm", "-f", remoteTmpPath]).catch(() => undefined);
    const result: PublishResult = {
      publishedAt,
      host,
      container,
      containerPath,
      ok: false,
      error: error instanceof Error ? error.message : "Error desconocido al publicar",
    };
    writeJsonAtomic(PUBLISH_STATE_PATH, result);
    return result;
  }
}
