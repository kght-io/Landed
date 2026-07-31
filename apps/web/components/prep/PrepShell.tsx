"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import TabBar, { type Tab } from "./TabBar";

// Standard chrome for a prep view: sticky header (back link or breadcrumb + title), tab bar, and a
// scrollable centered content column. Mirrors TodoView's flex-h-full + scroll pattern. Pass `parent`
// to render a breadcrumb ("{parent.label} > {title}") instead of the bare back chevron.
export default function PrepShell({
  title,
  subtitle,
  parent,
  tabs,
  active,
  onChange,
  children,
}: {
  title: string;
  subtitle?: string;
  parent?: { label: string; href: string };
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 px-6 pt-3.5 backdrop-blur">
        {parent ? (
          <div>
            <div className="flex items-center gap-1.5 text-[13px]">
              <Link href={parent.href} className="font-medium text-zinc-500 transition hover:text-zinc-200">{parent.label}</Link>
              <ChevronRight size={13} className="text-zinc-600" />
              <span className="font-semibold tracking-tight text-zinc-100">{title}</span>
            </div>
            {subtitle && <p className="mt-0.5 text-[13px] text-zinc-500">{subtitle}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/prep" className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200">
              <ChevronLeft size={16} />
            </Link>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h1>
              {subtitle && <p className="mt-0.5 text-[13px] text-zinc-500">{subtitle}</p>}
            </div>
          </div>
        )}
        <div className="mt-3">
          <TabBar tabs={tabs} active={active} onChange={onChange} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
