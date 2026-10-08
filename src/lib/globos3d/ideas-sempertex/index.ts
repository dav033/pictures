import type { IdeaDigitalizada } from "./tipos";
import { LOTE_01 } from "./lote-01";
import { LOTE_02 } from "./lote-02";
import { LOTE_03 } from "./lote-03";
import { LOTE_04 } from "./lote-04";
import { LOTE_05 } from "./lote-05";
import { LOTE_06 } from "./lote-06";

/** Todas las ideas de sempertex.com digitalizadas (cada lote lo llena un encargo distinto, sin pisarse). */
export const IDEAS_SEMPERTEX: readonly IdeaDigitalizada[] = [...LOTE_01, ...LOTE_02, ...LOTE_03, ...LOTE_04, ...LOTE_05, ...LOTE_06];
