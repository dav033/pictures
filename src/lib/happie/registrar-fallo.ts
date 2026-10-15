import { HappiaApiError } from "@sempertex/happie-package-ia";

/**
 * Operational trace of a failed recommendation: which kind of failure and the upstream HTTP status, nothing else.
 * Never the provider's message or body (it can carry catalogue or credential details), so a 502 stays diagnosable
 * without leaking: an expired key (401), a contract break (ZodError) and a timeout look different in the log.
 */
export function registrarFalloHappie(operacion: string, error: unknown, correlationId?: string | null): void {
  console.error("happie-fallo", {
    operacion,
    correlationId: correlationId ?? undefined,
    nombre: error instanceof Error ? error.name : typeof error,
    upstreamStatus: error instanceof HappiaApiError ? error.status : undefined,
  });
}
