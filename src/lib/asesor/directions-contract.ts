import { z } from "zod";
import config from "./directions.json";

export const DirectionOfferSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  photoUrl: z.string().trim().min(1),
  provenance: z.object({ kind: z.enum(["real", "illustrative_example"]), label: z.string().nullable() }).strict(),
  themedItems: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), items: z.array(z.object({
      id: z.string().min(1), name: z.string().trim().min(1), price: z.number().finite().nonnegative(), source: z.enum(["package", "service"]),
    }).strict()) }).strict(),
    z.object({ status: z.literal("no_verified_matches") }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ]),
}).strict();

export type DirectionOffer = z.infer<typeof DirectionOfferSchema>;

export function parseDirectionOffers(value: unknown): DirectionOffer[] | null {
  const parsed = z.array(DirectionOfferSchema).length(12).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(({ id }) => id)).size !== 12) return null;
  const configured = new Map(config.directions.map(({ id, photoUrl }) => [id, photoUrl]));
  return parsed.data.every((offer) => configured.get(offer.id) === offer.photoUrl) ? parsed.data : null;
}
