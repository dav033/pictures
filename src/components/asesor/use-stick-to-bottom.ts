"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

const RETURN_DISTANCE = 60;

const distanceFromBottom = () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

/**
 * Keeps the end of the chat in view while it grows (typed reply, cards, chips) until the person scrolls up on purpose;
 * scrolling back to the bottom resumes following. Programmatic scrolls never count as the person leaving.
 */
export function useStickToBottom(end: RefObject<HTMLElement | null>) {
  const sticking = useRef(true);
  const frame = useRef(0);

  useEffect(() => {
    // A gesture upwards is intent: stop following at once, before the browser applies the scroll (a programmatic scroll would cancel it).
    const leave = () => { sticking.current = false; };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) leave(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") leave(); };
    const onScroll = () => { if (distanceFromBottom() < RETURN_DISTANCE) sticking.current = true; };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", leave, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", leave);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const scroll = useCallback((smooth: boolean, force: boolean) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      // The person may have scrolled away between asking and running: that wins.
      if (!force && !sticking.current) return;
      end.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    });
  }, [end]);
  /** Follow the growth, only while the person has not scrolled away. */
  const follow = useCallback(() => { if (sticking.current) scroll(false, false); }, [scroll]);
  /** Go to the end whatever happened before (the person just sent something). */
  const snap = useCallback(() => { sticking.current = true; scroll(true, true); }, [scroll]);
  return { follow, snap };
}
