import Link from "next/link";
import { ChevronRight } from "lucide-react";

// Pipeline › <page> breadcrumb for nested detail pages (Discovery, Fit).
export default function Breadcrumb({ page }: { page: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-800/80 px-5 py-3 text-sm">
      <Link href="/" className="text-zinc-400 transition hover:text-zinc-100">Pipeline</Link>
      <ChevronRight size={14} className="text-zinc-600" />
      <span className="font-medium text-zinc-100">{page}</span>
    </div>
  );
}
