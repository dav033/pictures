"use client";

import { useLayoutEffect } from "react";
import { plainChatText } from "./chat-text";
import { useRevealedText } from "./use-revealed-text";

type Props = {
  id: string;
  content: string;
  /** A reply that arrived in this session is typed out; restored history is shown whole. */
  animate: boolean;
  /** The server is still sending more text for this reply. */
  streaming?: boolean;
  onRevealing?: (id: string, revealing: boolean) => void;
  onGrow?: () => void;
};

/** The advisor's reply as plain text, typed out smoothly; screen readers get the whole text at once, not letter by letter. */
export function AssistantText({ id, content, animate, streaming = false, onRevealing, onGrow }: Props) {
  const plain = plainChatText(content);
  const { shown, done } = useRevealedText(id, plain, animate);
  const typing = !done || streaming;
  useLayoutEffect(() => {
    onRevealing?.(id, typing);
    return () => onRevealing?.(id, false);
  }, [id, typing, onRevealing]);
  useLayoutEffect(() => { if (typing) onGrow?.(); }, [shown.length, typing, onGrow]);
  return typing
    ? <p className="asesor-cursor mt-0.5 whitespace-pre-wrap text-base leading-relaxed"><span aria-hidden="true">{shown}</span><span className="sr-only">{plain}</span></p>
    : <p className="mt-0.5 whitespace-pre-wrap text-base leading-relaxed">{plain}</p>;
}
