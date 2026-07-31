"use client";

import { useState } from "react";
import PrepShell from "./PrepShell";
import QuestionList from "./QuestionList";
import GamePlan from "./reference/GamePlan";
import DecisionTrees from "./reference/DecisionTrees";
import TechReference from "./reference/TechReference";
import FailureModes from "./reference/FailureModes";
import Monitoring from "./reference/Monitoring";
import Sharding from "./reference/Sharding";

const TABS = [
  { id: "questions", label: "Questions" },
  { id: "gameplan", label: "Game Plan" },
  { id: "decisions", label: "Tech Decisions" },
  { id: "tech", label: "Tech Reference" },
  { id: "failures", label: "Failure Modes" },
  { id: "monitoring", label: "Monitoring" },
  { id: "sharding", label: "Sharding" },
];

// Generic system-design prep: the DB-backed question bank + the full reference set
// (game plan, decision trees, tech reference, failure modes, monitoring, sharding).
export default function SystemDesignPrep() {
  const [tab, setTab] = useState("questions");
  return (
    <PrepShell
      title="System Design Prep"
      subtitle="Senior / Staff interview reference"
      tabs={TABS}
      active={tab}
      onChange={setTab}
    >
      {tab === "questions" && <QuestionList track="system_design" />}
      {tab === "gameplan" && <GamePlan />}
      {tab === "decisions" && <DecisionTrees />}
      {tab === "tech" && <TechReference />}
      {tab === "failures" && <FailureModes />}
      {tab === "monitoring" && <Monitoring />}
      {tab === "sharding" && <Sharding />}
    </PrepShell>
  );
}
