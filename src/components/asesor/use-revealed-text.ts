"use client";

import { useEffect, useRef, useState } from "react";
import { advanceReveal, rememberRevealed, revealedCount, revealedSlice } from "./reveal";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * `text` typed out progressively when `animate` is on (a reply that arrived in this session); everything else, and
 * everyone who asked for reduced motion, gets the full text at once. `id` ties the streaming bubble to the final message.
 */
export function useRevealedText(id: string, text: string, animate: boolean): { shown: string; done: boolean } {
  const still = !animate || prefersReducedMotion();
  const [count, setCount] = useState(() => (still ? text.length : Math.min(revealedCount(id), text.length)));
  const position = useRef(count);
  useEffect(() => {
    if (still) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      position.current = advanceReveal(position.current, text.length, now - last);
      last = now;
      const whole = Math.floor(position.current);
      rememberRevealed(id, whole);
      setCount(whole);
      if (position.current < text.length) frame = requestAnimationFrame(tick);
    };
    if (position.current < text.length) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, still, text.length]);
  const visible = still ? text.length : Math.min(count, text.length);
  return { shown: revealedSlice(text, visible), done: visible >= text.length };
}
