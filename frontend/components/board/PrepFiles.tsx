"use client";

// The files sitting in a company's interview-prep folder, as things you can open. Two screens show
// them — a stage lists the ones its rounds claimed, the prep-materials row lists the whole folder —
// so the endpoint's shape lives here once rather than being hand-built at each call site.

import { FileText } from "lucide-react";
import { fmtBytes } from "@landed/shared/format/bytes";
import { attachmentUrl, revealPrepFolder as revealPrepFolderLocal } from "@/lib/local-capability";

// One downloaded attachment, linked to the route that serves it out of interview-prep/<slug>/.
export function AttachmentChip({ postingId, name, bytes }: { postingId: string; name: string; bytes?: number }) {
  return (
    <a
      href={attachmentUrl(postingId, name)}
      target="_blank"
      rel="noreferrer"
      title={bytes == null ? name : `${name} · ${fmtBytes(bytes)}`}
      className="inline-flex max-w-[190px] items-center gap-1 rounded-md bg-zinc-800/70 px-1.5 py-0.5 text-[12px] text-zinc-300 transition hover:bg-zinc-700"
    >
      <FileText size={11} className="shrink-0 text-zinc-500" />
      <span className="truncate">{name}</span>
    </a>
  );
}

// Reveal the company's interview-prep folder in the OS file browser. Local-only convenience (the
// server runs on this machine); best-effort, so a failure is silent rather than a broken button.
export function revealPrepFolder(postingId: string) {
  void revealPrepFolderLocal(postingId);
}
