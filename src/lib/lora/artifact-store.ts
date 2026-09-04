import "server-only";

export type ArtifactPutResult = {
  key: string;
  sha256: string;
  bytes: number;
};

export interface LoraArtifactStore {
  put(key: string, contents: Uint8Array): Promise<ArtifactPutResult>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

/** Rechaza claves absolutas y segmentos que puedan escapar del almacén. */
export function normalizeArtifactKey(key: string): string {
  const normalized = key.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("Clave de artefacto inválida");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Clave de artefacto inválida");
  }

  return segments.join("/");
}
