"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

const SCROLL_AMOUNT_RATIO = 0.75;
const SCROLL_EDGE_THRESHOLD = 8;

const scrollButtonClass =
  "pointer-events-auto flex size-8 items-center justify-center rounded-full border border-gray-500 bg-gray-700/95 text-gray-100 shadow-lg backdrop-blur-sm opacity-60 transition-opacity hover:border-gray-400 hover:bg-gray-600 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:pointer-events-none disabled:opacity-0";

interface ChatScrollArrowsProps {
  contentVersion?: number;
}

export const ChatScrollArrows = ({
  contentVersion = 0,
}: ChatScrollArrowsProps) => {
  const { scrollRef, isAtBottom } = useStickToBottomContext();
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const hasOverflow = el.scrollHeight > el.clientHeight + SCROLL_EDGE_THRESHOLD;

    setCanScrollUp(hasOverflow && el.scrollTop > SCROLL_EDGE_THRESHOLD);
    setCanScrollDown(
      hasOverflow &&
        el.scrollTop + el.clientHeight <
          el.scrollHeight - SCROLL_EDGE_THRESHOLD,
    );
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    updateScrollState();

    el.addEventListener("scroll", updateScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);

    const contentEl = el.firstElementChild;
    if (contentEl) {
      resizeObserver.observe(contentEl);
    }

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [scrollRef, updateScrollState, contentVersion]);

  useEffect(() => {
    updateScrollState();
  }, [isAtBottom, updateScrollState]);

  const scroll = (direction: "up" | "down") => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const amount = el.clientHeight * SCROLL_AMOUNT_RATIO;

    el.scrollBy({
      top: direction === "up" ? -amount : amount,
      behavior: "smooth",
    });
  };

  if (!canScrollUp && !canScrollDown) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-y-0 right-1 z-10 flex flex-col justify-between py-8 sm:right-2">
      <button
        type="button"
        aria-label="Scroll up"
        className={scrollButtonClass}
        disabled={!canScrollUp}
        onClick={() => scroll("up")}
      >
        <ChevronUp className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Scroll down"
        className={scrollButtonClass}
        disabled={!canScrollDown}
        onClick={() => scroll("down")}
      >
        <ChevronDown className="size-5" />
      </button>
    </div>
  );
};
