"use client";

import { useState } from "react";
import PrepShell from "./PrepShell";
import PrepTracker from "./PrepTracker";
import PatternsRef from "./reference/PatternsRef";
import ComplexityRef from "./reference/ComplexityRef";
import InterviewMeta from "./reference/InterviewMeta";

const TABS = [
  { id: "tracker", label: "Tracker" },
  { id: "patterns", label: "Patterns" },
  { id: "complexity", label: "Complexity" },
  { id: "interview", label: "Interview" },
];

// Generic Leetcode prep: the topic-grouped question tracker (DB-backed) + algo-pattern,
// complexity, and interview-meta reference.
export default function CodingPrep() {
  const [tab, setTab] = useState("tracker");
  return (
    <PrepShell
      title="Leetcode Prep"
      subtitle="Problems by topic · algo patterns · complexity · interview meta"
      tabs={TABS}
      active={tab}
      onChange={setTab}
    >
      {tab === "tracker" && <PrepTracker track="coding" />}
      {tab === "patterns" && <PatternsRef />}
      {tab === "complexity" && <ComplexityRef />}
      {tab === "interview" && <InterviewMeta />}
    </PrepShell>
  );
}
