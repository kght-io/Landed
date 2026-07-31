"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import McpDocs from "@/components/mcp/McpDocs";
import type { McpToolDoc } from "@/lib/mcp-tools";

type Catalog = { server: { name: string; version: string }; tools: McpToolDoc[] };

// The MCP tool reference, rendered inside the Agents page's MCP tab. Fetches the catalog client-side
// (the /mcp page loads the same data server-side) and reuses the McpDocs presentation.
export default function McpDocsPanel() {
  const [data, setData] = useState<Catalog | null>(null);

  useEffect(() => {
    fetch("/api/mcp").then((r) => r.json()).then(setData).catch(() => setData({ server: { name: "", version: "" }, tools: [] }));
  }, []);

  if (!data) {
    return <div className="flex items-center gap-2 py-8 text-[13px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> loading tools…</div>;
  }

  return (
    <div>
      <p className="mb-4 text-[13px] text-zinc-500">
        The {data.tools.length} capabilities the agents call over MCP to run your pipeline — live from{" "}
        <code className="font-mono text-zinc-400">apps/mcp/jobhunt-server.mjs</code>.
      </p>
      <McpDocs tools={data.tools} />
    </div>
  );
}
