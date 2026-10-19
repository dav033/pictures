'use client';

import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

type MotionPreferenceQuery = {
  matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
};

export function subscribeToMotionPreference(
  mediaQuery: MotionPreferenceQuery,
  onChange: () => void,
): () => void {
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getMotionPreference(): MotionPreferenceQuery | null {
  if (typeof window === 'undefined') return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mediaQuery = getMotionPreference();
  if (!mediaQuery) return () => {};
  return subscribeToMotionPreference(mediaQuery, onChange);
}

function getSnapshot(): boolean {
  return getMotionPreference()?.matches ?? false;
}

export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
