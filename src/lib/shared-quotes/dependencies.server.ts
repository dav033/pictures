import "server-only";

import { randomUUID } from "node:crypto";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { EDICION_PYTHON_DEADLINE_MS } from "@/lib/plan/edicion-python";
import { llamarPythonCotizacionProfesional } from "@/lib/ia/nucleo/python-adapter";
import { getRagPool } from "@/lib/rag/db";
import {
  createPostgresSharedQuoteRepository,
  type SharedQuoteRepository,
} from "./repository";
import type { SharedQuoteServiceDependencies } from "./service";
import { CotizacionProfesionalResultadoSchema } from "@/lib/cotizacion/profesional";

function lazyRepository(): SharedQuoteRepository {
  return {
    async insert(record) {
      await createPostgresSharedQuoteRepository(getRagPool()).insert(record);
    },
    async findById(id) {
      return createPostgresSharedQuoteRepository(getRagPool()).findById(id);
    },
    async findStillById(id) {
      return createPostgresSharedQuoteRepository(getRagPool()).findStillById(id);
    },
    async listBySceneRevision(hash, limit) {
      return createPostgresSharedQuoteRepository(getRagPool()).listBySceneRevision(hash, limit);
    },
    async saveDecision(input) {
      return createPostgresSharedQuoteRepository(getRagPool()).saveDecision(input);
    },
  };
}

export function sharedQuoteDependencies(request?: Request): SharedQuoteServiceDependencies {
  return {
    repository: lazyRepository(),
    secret: process.env.COTIZACION_COMPARTIDA_SECRET ?? "",
    readerEnabled: process.env.COTIZACION_COMPARTIDA_READER_ENABLED === "true",
    writerEnabled: process.env.COTIZACION_COMPARTIDA_WRITER_ENABLED === "true",
    calculateQuote: async (input) => {
      const requestId = randomUUID();
      const result = await llamarPythonCotizacionProfesional({
        entrada: input,
        requestId,
        correlationId: requestId,
        deadlineMs: EDICION_PYTHON_DEADLINE_MS,
        parentSignal: request?.signal,
      });
      return CotizacionProfesionalResultadoSchema.parse(result);
    },
  };
}

export function sharedQuoteHttpDependencies(request?: Request) {
  return {
    ...sharedQuoteDependencies(request),
    authenticate: (candidate: Request) => isAuthenticatedRequest(candidate),
    sameOrigin: (candidate: Request) => isSameOriginRequest(candidate),
  };
}
