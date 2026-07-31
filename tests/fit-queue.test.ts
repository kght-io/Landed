import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, db, postings, companies } from "./helpers";
import { enqueueFit } from "@landed/backend/jobs/store";

beforeEach(() => reset());

const JD = "We are hiring a Product Engineer to own our web app end to end. ".repeat(3);

const postingFor = (company: string) => {
  const co = db.select().from(companies).all().find((c) => c.name === company);
  assert.ok(co, `company ${company} exists`);
  return db.select().from(postings).where(eq(postings.companyId, co!.id)).all();
};

// Pasting a JD must persist the JD onto the posting row immediately — not leave it only in the
// fit job's params. Otherwise a JD-pasted posting is blank in the UI until the agent finishes scoring.
test("enqueueFit persists the pasted JD onto the posting at paste time", () => {
  enqueueFit({ company: "Linear", role: "Product Engineer", jd: JD, url: "https://linear.app/careers/pe" });
  const rows = postingFor("Linear");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "fit_queue");
  assert.equal(rows[0].jd, JD, "JD is stored on the posting row");
});

// Re-queuing the same posting (same URL) with an updated JD refreshes the stored JD rather than
// creating a duplicate row.
test("enqueueFit updates the stored JD when re-queuing an existing posting", () => {
  enqueueFit({ company: "Linear", role: "Product Engineer", jd: JD, url: "https://linear.app/careers/pe" });
  const updated = JD + " Updated with new requirements.";
  enqueueFit({ company: "Linear", role: "Product Engineer", jd: updated, url: "https://linear.app/careers/pe" });
  const rows = postingFor("Linear");
  assert.equal(rows.length, 1, "no duplicate posting");
  assert.equal(rows[0].jd, updated);
});
