import type { PeticionImagen, ProviderCapabilities } from "./tipos";

export type AspectTransform = {
  requested: PeticionImagen["aspecto"];
  provider: PeticionImagen["aspecto"];
  strategy: "exact" | "pad";
  contentRect: { x: number; y: number; width: number; height: number };
};

const ratio: Record<PeticionImagen["aspecto"], number> = { "3:2": 3 / 2, "1:1": 1, "2:3": 2 / 3, "16:9": 16 / 9 };

export function resolveAspectTransform(requested: PeticionImagen["aspecto"], capabilities: ProviderCapabilities): AspectTransform {
  if (capabilities.exactAspectRatios.includes(requested)) return { requested, provider: requested, strategy: "exact", contentRect: { x: 0, y: 0, width: 1, height: 1 } };
  const provider = [...capabilities.exactAspectRatios].sort((a, b) => Math.abs(Math.log(ratio[a] / ratio[requested])) - Math.abs(Math.log(ratio[b] / ratio[requested])))[0] ?? "3:2";
  const requestedRatio = ratio[requested];
  const providerRatio = ratio[provider];
  const contentRect = requestedRatio > providerRatio
    ? { x: 0, y: (1 - providerRatio / requestedRatio) / 2, width: 1, height: providerRatio / requestedRatio }
    : { x: (1 - requestedRatio / providerRatio) / 2, y: 0, width: requestedRatio / providerRatio, height: 1 };
  return { requested, provider, strategy: "pad", contentRect };
}

