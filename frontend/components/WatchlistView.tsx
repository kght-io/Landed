"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApplications } from "@/hooks/useApplications";
import { buildTargetCounts } from "@landed/shared/pipeline/stages";
import { usePersistentState } from "@/hooks/usePersistentState";
import TabBar from "@/components/prep/TabBar";
import TargetsTable from "@/components/board/TargetsTable";
import ScanResults, { type Scanned } from "@/components/board/ScanResults";

// The Watchlist page: two tabs — the company config ("Watchlist", default) and the scan results
// awaiting triage ("Scan results"). The scan data is owned here so the tab can badge the count, and
// so triaging a row (add-to-fit / discard) refreshes both the list and the badge. Scanned postings
// flow into the pipeline's Fit step once you add them here.
export default function WatchlistView() {
  const { postings } = useApplications();
  const counts = useMemo(() => buildTargetCounts(postings), [postings]);
  const [tab, setTab] = usePersistentState<string>("landed.watchlist.tab", "watchlist");

  const [scanRows, setScanRows] = useState<Scanned[] | null>(null);
  const loadScan = useCallback(() => {
    fetch("/api/scanned?state=review,matched")
      .then((r) => r.json())
      .then((d) => setScanRows((d.postings ?? []).map((p: Scanned) => ({
        id: p.id, company: p.company, title: p.title, location: p.location, scannedAt: p.scannedAt, postedAt: p.postedAt ?? null,
      }))))
      .catch(() => setScanRows([]));
  }, []);
  useEffect(() => {
    loadScan();
    const onFocus = () => loadScan();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadScan]);

  const scanCount = scanRows?.length ?? 0;
  const tabs = [
    { id: "watchlist", label: "Watchlist" },
    { id: "scan", label: scanCount > 0 ? `Scan results (${scanCount})` : "Scan results" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      <div className="min-h-0 flex-1">
        {tab === "watchlist"
          ? <TargetsTable counts={counts} />
          : <ScanResults rows={scanRows} reload={loadScan} />}
      </div>
    </div>
  );
}
