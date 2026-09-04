import type { LoraSpecialization } from "./schema";

export type LoraCompatibilityArtifact = {
  artifactId: string;
  specialization: LoraSpecialization;
  providerUrl: string;
  trigger: string;
  baseModel: string;
  tokenizerRevision: string;
  resolution: number;
  scale: number;
};

export class LoraCompatibilityError extends Error {
  readonly code = "LORA_INCOMPATIBLE";

  constructor(readonly errors: string[]) {
    super(errors.join("; "));
    this.name = "LoraCompatibilityError";
  }
}

export function assertLoraCompatibility(artifacts: LoraCompatibilityArtifact[]): void {
  if (!artifacts.length) throw new LoraCompatibilityError(["No hay LoRAs seleccionados"]);
  if (artifacts.length > 2) throw new LoraCompatibilityError(["Solo se permiten LoRA producto y LoRA estructura"]);

  const specializations = new Set(artifacts.map((artifact) => artifact.specialization));
  if (specializations.size !== artifacts.length) {
    throw new LoraCompatibilityError(["No se puede seleccionar más de un artifact de la misma especialización"]);
  }

  const baseModels = new Set(artifacts.map((artifact) => artifact.baseModel));
  const tokenizerRevisions = new Set(artifacts.map((artifact) => artifact.tokenizerRevision));
  const resolutions = new Set(artifacts.map((artifact) => artifact.resolution));
  const errors: string[] = [];
  if (baseModels.size !== 1) errors.push("Los LoRA usan bases incompatibles");
  if (tokenizerRevisions.size !== 1) errors.push("Los LoRA usan tokenizers incompatibles");
  if (resolutions.size !== 1) errors.push("Los LoRA usan resoluciones incompatibles");
  if (artifacts.some((artifact) => !/^https:\/\//i.test(artifact.providerUrl))) errors.push("Algún artifact no tiene URL segura del proveedor");
  if (artifacts.some((artifact) => !artifact.trigger.trim())) errors.push("Algún artifact no tiene trigger");
  if (artifacts.some((artifact) => artifact.scale < 0 || artifact.scale > 1.5)) errors.push("Alguna escala está fuera de 0 a 1.5");
  if (errors.length) throw new LoraCompatibilityError(errors);
}

