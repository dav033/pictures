"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

type CountUpProps = {
  value: number;
  duration?: number;
  locale?: string;
  format?: Intl.NumberFormatOptions;
  className?: string;
};

/** Animates a number and always settles on the exact formatted value. */
export function CountUp({ value, duration = 700, locale = "es-CO", format, className }: CountUpProps) {
  const prefersReducedMotion = useReducedMotionPreference();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(0);
  const formatter = new Intl.NumberFormat(locale, format);

  useEffect(() => {
    if (prefersReducedMotion || duration <= 0 || !Number.isFinite(value)) {
      shownRef.current = value;
      setShown(value);
      return;
    }

    const from = shownRef.current;
    if (from === value) return;
    let frame = 0;
    let startedAt: number | null = null;
    const animate = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = progress === 1 ? value : from + (value - from) * eased;
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [duration, prefersReducedMotion, value]);

  return <span className={className} aria-label={formatter.format(value)} aria-live="off">{formatter.format(shown)}</span>;
}
