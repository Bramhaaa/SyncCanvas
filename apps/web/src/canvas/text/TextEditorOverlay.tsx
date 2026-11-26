"use client";

import { useEffect, useRef, useState } from "react";

export interface TextEditorOverlayProps {
  x: number;
  y: number;
  initialText: string;
  fontSize: number;
  color: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function TextEditorOverlay({
  x,
  y,
  initialText,
  fontSize,
  color,
  onCommit,
  onCancel,
}: TextEditorOverlayProps) {
  const [value, setValue] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(fontSize * 1.4, el.scrollHeight)}px`;
  }, [value, fontSize]);

  function commit(): void {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      maxLength={2000}
      aria-label="Edit text"
      data-testid="canvas-text-editor"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          committedRef.current = true;
          onCancel();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commit();
        }
      }}
      className="pointer-events-auto absolute resize-none overflow-hidden rounded border border-blue-500 bg-white/90 px-1 py-0.5 leading-snug outline-none shadow-sm"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        fontSize: `${fontSize}px`,
        color,
        minWidth: `${Math.max(120, fontSize * 6)}px`,
      }}
      rows={1}
    />
  );
}
