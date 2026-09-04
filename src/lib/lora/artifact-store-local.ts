import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeArtifactKey, type ArtifactPutResult, type LoraArtifactStore } from "./artifact-store";

function defaultRoot(): string {
  return process.env.LORA_ARTIFACT_ROOT?.trim() || path.join(process.cwd(), "data", "lora-artifacts");
}

function resolveWithinRoot(root: string, key: string): string {
  const normalizedKey = normalizeArtifactKey(key);
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, normalizedKey);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error("Clave de artefacto fuera del almacén");
  }
  return target;
}

export function createLocalLoraArtifactStore(root = defaultRoot()): LoraArtifactStore {
  return {
    async put(key: string, contents: Uint8Array): Promise<ArtifactPutResult> {
      const target = resolveWithinRoot(root, key);
      const bytes = Buffer.from(contents);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;

      await mkdir(path.dirname(target), { recursive: true });
      try {
        await writeFile(temporary, bytes, { flag: "wx" });
        try {
          await rename(temporary, target);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "EPERM"))) {
            throw error;
          }
          const existing = await readFile(target);
          if (createHash("sha256").update(existing).digest("hex") !== sha256) {
            throw new Error(`El artefacto ${normalizeArtifactKey(key)} ya existe con otro contenido`);
          }
          await rm(temporary, { force: true });
        }
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }

      return { key: normalizeArtifactKey(key), sha256, bytes: bytes.byteLength };
    },

    async read(key: string): Promise<Buffer> {
      return readFile(resolveWithinRoot(root, key));
    },

    async exists(key: string): Promise<boolean> {
      try {
        await stat(resolveWithinRoot(root, key));
        return true;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }
    },

    async remove(key: string): Promise<void> {
      await rm(resolveWithinRoot(root, key), { force: true });
    },
  };
}
