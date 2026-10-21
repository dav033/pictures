import "server-only";

import { advisorSessionFromRequest } from "./auth";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";

/** Advisor sessions share Whisper with existing Pictures sessions without bypassing either route guard. */
export function isAuthenticatedVoiceRequest(request: Request): boolean {
  return isAuthenticatedRequest(request) || advisorSessionFromRequest(request) !== null;
}

export function isSameOriginVoiceRequest(request: Request): boolean {
  return isSameOriginRequest(request);
}
