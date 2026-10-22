import { z } from "zod";
import config from "./directions.json";
import { decoracionesSempertex } from "@/lib/biblioteca-sempertex/biblioteca";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import type { HappiaCatalogueResult } from "./catalogue";
import { parseDirectionOffers, type DirectionOffer } from "./directions-contract";

const configSchema = z.object({
  version: z.literal(1),
  directions: z.array(z.object({
    id: z.string().min(1), title: z.string().trim().min(1), description: z.string().trim().min(1),
    photoUrl: z.string().trim().min(1), themeTerms: z.array(z.string().trim().min(1)).min(1),
  }).strict()).length(12),
}).strict();

export type DirectionItem = { id: string; name: string; price: number; source: "package" | "service" };

export function getDirectionProvenance(decoration: DecoracionSempertex): DirectionOffer["provenance"] {
  return decoration.origen === "ejemplo"
    ? { kind: "illustrative_example", label: decoration.aviso }
    : { kind: "real", label: decoration.fotoRepresentativa === false ? "La foto es una referencia visual y no representa esta decoración." : null };
}

export function validateDirectionConfig(value: unknown) {
  const parsedConfig = configSchema.parse(value);
  if (new Set(parsedConfig.directions.map(({ id }) => id)).size !== 12) {
    throw new Error("Advisor directions must reference twelve distinct decorations.");
  }
  return parsedConfig.directions.map((direction) => {
    const decoration = decoracionesSempertex.find((entry) => entry.id === direction.id);
    if (!decoration) throw new Error(`Advisor direction references missing decoration: ${direction.id}`);
    if (!decoration.fotos.some((photo) => photo.url === direction.photoUrl)) {
      throw new Error(`Advisor direction photo is not present in the decoration: ${direction.id}`);
    }
    return { ...direction, provenance: getDirectionProvenance(decoration) };
  });
}

const resolved = validateDirectionConfig(config);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function verifiedItems(direction: (typeof resolved)[number], catalogue: HappiaCatalogueResult): DirectionOffer["themedItems"] {
  if (catalogue.status === "unavailable") return { status: "unavailable" };
  const terms = direction.themeTerms.map(normalize);
  const matches = (value: string) => terms.some((term) => normalize(value).includes(term));
  const items: DirectionItem[] = [];
  for (const pack of catalogue.data.packages) {
    if (!pack.is_active) continue;
    const packageMatches = matches(pack.name);
    if (!packageMatches && !pack.package_items.some((item) => item.is_active && matches([item.category_name ?? "", item.description ?? ""].join(" ")))) continue;
    for (const item of pack.package_items) {
      if (!item.is_active || (!packageMatches && !matches([item.category_name ?? "", item.description ?? ""].join(" ")))) continue;
      const name = [item.category_name, item.description].filter(Boolean).join(" · ") || pack.name;
      items.push({ id: item.id, name: `${pack.name}: ${name}`, price: item.total, source: "package" });
      if (items.length === 4) break;
    }
    if (items.length === 4) break;
  }
  for (const service of catalogue.data.services) {
    if (items.length === 4) break;
    if (!matches([service.name ?? "", service.description ?? "", service.category_name].join(" "))) continue;
    items.push({ id: service.id, name: service.name ?? service.category_name, price: service.total, source: "service" });
  }
  return items.length ? { status: "available", items } : { status: "no_verified_matches" };
}

export function getDirectionOffers(catalogue: HappiaCatalogueResult): DirectionOffer[] {
  return resolved.map((direction) => ({
    id: direction.id,
    title: direction.title,
    description: direction.description,
    photoUrl: direction.photoUrl,
    provenance: direction.provenance,
    themedItems: verifiedItems(direction, catalogue),
  }));
}

export function isOfferedDirection(id: unknown): id is string {
  return typeof id === "string" && resolved.some((direction) => direction.id === id);
}

export function parseStoredDirectionOffers(value: unknown): DirectionOffer[] | null {
  const parsed = parseDirectionOffers(value);
  if (!parsed) return null;
  const valid = parsed.every((offer) => {
    const configured = resolved.find(({ id }) => id === offer.id);
    return configured !== undefined
      && configured.photoUrl === offer.photoUrl
      && configured.provenance.kind === offer.provenance.kind
      && configured.provenance.label === offer.provenance.label;
  });
  return valid ? parsed : null;
}

export const ADVISOR_DIRECTION_IDS = resolved.map(({ id }) => id);
