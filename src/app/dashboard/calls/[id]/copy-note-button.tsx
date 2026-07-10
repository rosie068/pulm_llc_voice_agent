"use client";

import { useState } from "react";

export function CopyNoteButton({
  text,
  onCopied,
}: {
  text: string;
  onCopied?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="rounded-md bg-coral px-3 py-1 text-sm font-medium text-brand-dark hover:bg-coral-light active:bg-coral-active"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        await onCopied?.();
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied ✓" : "Copy memo note"}
    </button>
  );
}
