"use client";

import { useEffect, useRef, type HTMLAttributes, type Key, type ReactNode } from "react";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

type AnimatedListProps<T> = {
  items: readonly T[];
  getKey: (item: T) => Key;
  getItemAttributes?: (item: T) => HTMLAttributes<HTMLLIElement> & { [attribute: `data-${string}`]: string | number | undefined };
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  footer?: ReactNode;
};

/** A semantic list whose newly mounted entries enter with a short stagger. */
export function AnimatedList<T>({ items, getKey, getItemAttributes, renderItem, className, footer }: AnimatedListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const prefersReducedMotion = useReducedMotionPreference();
  const itemKeys = JSON.stringify(items.map(getKey));

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const entries = list.querySelectorAll<HTMLLIElement>(":scope > li[data-animated-list-item]:not([data-animated-list-entered])");
    entries.forEach((entry, index) => {
      entry.dataset.animatedListEntered = "true";
      if (prefersReducedMotion) return;
      const animation = entry.animate(
        [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 280, delay: Math.min(index, 8) * 35, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
      animation.onfinish = () => animation.cancel();
    });
  }, [itemKeys, prefersReducedMotion]);

  return (
    <ul ref={listRef} className={className}>
      {items.map((item, index) => (
        <li key={getKey(item)} {...getItemAttributes?.(item)} data-animated-list-item="">
          {renderItem(item, index)}
        </li>
      ))}
      {footer}
    </ul>
  );
}
