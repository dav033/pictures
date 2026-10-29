import { z } from "zod";
import { PersonalizedBriefSchema } from "./brief";
import type { PersonalizedBrief } from "./brief";

export const PERSONALIZED_TITLE = "__personalized_advisor_v1__";
export const PersonalizedStateSchema = z.object({
  kind: z.literal("personalized.v1"),
  brief: PersonalizedBriefSchema,
  approved: z.boolean(),
  completedTurn: z.string().nullable(),
  assistantText: z.string().nullable().default(null),
  approvedPhotoIds: z.array(z.string().uuid()).default([]),
}).strict();

export function initialPersonalizedState() {
  return PersonalizedStateSchema.parse({ kind: "personalized.v1", brief: {}, approved: false, completedTurn: null });
}

type PersonalizedState = z.infer<typeof PersonalizedStateSchema>;

export function completePersonalizedTurn(state: PersonalizedState, turnId: string, brief: PersonalizedBrief, assistantText: string): PersonalizedState {
  return { ...state, brief, approved: false, approvedPhotoIds: [], completedTurn: turnId, assistantText };
}

export function approvePersonalizedBrief(state: PersonalizedState, lastUserTurn: string | undefined, photoIds: string[]): PersonalizedState {
  if (!lastUserTurn || lastUserTurn !== state.completedTurn) throw new Error("TURN_PENDING");
  return PersonalizedStateSchema.parse({ ...state, approved: true, approvedPhotoIds: photoIds });
}
