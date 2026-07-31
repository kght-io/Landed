import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, jobs } from "./helpers";
import { getPosting } from "@landed/core/db/queries";
import { enqueueInterviewBrief, enqueueInterviewEmails } from "@landed/core/jobs/store";
import { jobDef } from "@landed/core/jobs/registry";
import { nextTranscriptName } from "@landed/core/prep/transcripts";

beforeEach(() => reset());

const ingest = (records: Record<string, unknown>[]) => jobDef("interview-brief")!.ingest(records);

test("ingestInterviewBrief appends v1 and projects onto the posting (latest fields)", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });

  const res = ingest([{
    id,
    role: { text: "Senior Backend Engineer", source: "recruiter" },
    tc: { text: "≈ $290k (200k base · 15% bonus · equity)", source: "recruiter" },
    team: { text: "Rewards platform", source: "jd" },
    expectations: { text: "distributed-systems depth", source: "recruiter" },
    nextStep: { text: "System design round with the platform lead — next Tue", source: "recruiter" },
    gaps: [{ area: "Distributed rate limiting", why: "flagged weak in screen", severity: "high", source: "recruiter" }],
    summary: "Rewards platform; loop is 4 rounds.",
    materials: ["context.md", "2 transcripts"],
  }]);
  assert.equal(res.updated, 1);

  const p = getPosting(id)!;
  assert.equal(p.interviewBriefs?.length, 1);
  const b = p.interviewBriefs![0];
  assert.equal(b.version, 1);
  assert.equal(b.role?.text, "Senior Backend Engineer");
  assert.equal(b.role?.source, "recruiter");
  assert.match(b.tc!.text, /290k/);
  assert.equal(b.team?.source, "jd");
  assert.match(b.expectations!.text, /distributed/);
  assert.match(b.nextStep!.text, /System design/);
  assert.equal(b.gaps?.length, 1);
  assert.equal(b.gaps![0].severity, "high");
  assert.equal(b.gaps![0].source, "recruiter");
  assert.deepEqual(b.materials, ["context.md", "2 transcripts"]);
});

test("brief coercion: bare-string fact, sources→materials alias, unknown source dropped", () => {
  const id = seedApp({ company: "Globex", status: "interview" });
  ingest([{
    id,
    role: "Staff Engineer",                              // bare string → { text }
    tc: { text: "unknown", source: "guess" },            // unknown source → dropped
    gaps: [{ area: "Caching", source: "online" }, { area: "TLS", source: "made-up" }],
    sources: ["JD"],                                     // `sources` accepted as the material list
  }]);
  const b = getPosting(id)!.interviewBriefs![0];
  assert.deepEqual(b.role, { text: "Staff Engineer" }); // no source key
  assert.equal(b.tc?.text, "unknown");
  assert.equal(b.tc?.source, undefined);
  assert.equal(b.gaps![0].source, "online");
  assert.equal(b.gaps![1].source, undefined);           // unknown clamped away
  assert.deepEqual(b.materials, ["JD"]);
});

test("a second generation appends v2 and keeps v1", () => {
  const id = seedApp({ company: "Acme", status: "interview" });
  ingest([{ id, summary: "first pass" }]);
  ingest([{ id, summary: "sharper after the onsite", gaps: [{ area: "Sharding" }] }]);

  const p = getPosting(id)!;
  assert.equal(p.interviewBriefs?.length, 2);
  assert.deepEqual(p.interviewBriefs!.map((b) => b.version), [1, 2]);
  assert.equal(p.interviewBriefs![0].summary, "first pass");
  assert.equal(p.interviewBriefs![1].gaps![0].area, "Sharding");
});

test("gaps coercion drops entries without an area and clamps bad severity", () => {
  const id = seedApp({ company: "Globex", status: "interview" });
  ingest([{ id, gaps: [
    { area: "Testing rigor", severity: "bogus" }, // severity dropped, kept
    { why: "no area" },                            // dropped entirely
    { text: "Behavioral: conflict story" },        // `text` → area
  ] }]);
  const b = getPosting(id)!.interviewBriefs![0];
  assert.equal(b.gaps?.length, 2);
  assert.equal(b.gaps![0].area, "Testing rigor");
  assert.equal(b.gaps![0].severity, undefined);
  assert.equal(b.gaps![1].area, "Behavioral: conflict story");
});

test("an unresolvable posting id parks an unbound result rather than crashing", () => {
  const res = ingest([{ id: 999999, summary: "orphan" }]);
  assert.equal(res.updated, 0);
  assert.equal(res.pending, 1);
});

test("enqueueInterviewBrief queues an interview-brief job with the posting id + slug in params", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  const out = enqueueInterviewBrief(id)!;
  assert.equal(out.jobId, `interview-brief-${id}`);
  assert.equal(out.slug, "acme");

  const job = db.select().from(jobs).where(eq(jobs.id, out.jobId)).get()!;
  assert.equal(job.type, "interview-brief");
  assert.equal(job.status, "queued");
  const params = JSON.parse(job.params!);
  assert.equal(params.id, id);
  assert.equal(params.slug, "acme");
  assert.match(job.task!, /interview-prep\/acme\//);
  assert.match(job.task!, /context\.md/);
});

test("enqueueInterviewEmails queues a company-keyed asset-capture job with a 3-month since date", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  const out = enqueueInterviewEmails(id)!;
  assert.match(out.jobId, /^interview-emails-\d+$/);
  assert.equal(out.slug, "acme");

  const job = db.select().from(jobs).where(eq(jobs.id, out.jobId)).get()!;
  assert.equal(job.type, "interview-emails");
  assert.equal(job.status, "queued");
  const params = JSON.parse(job.params!);
  assert.equal(params.company, "Acme");
  assert.equal(params.slug, "acme");
  assert.match(params.since, /^\d{4}\/\d{2}\/\d{2}$/); // Gmail-style YYYY/MM/DD, ~3 months back
  assert.match(job.task!, /interview-prep\/acme\//);
  assert.match(job.task!, /downloadGmailAttachments/);
});

test("nextTranscriptName numbers sequentially and never collides", () => {
  assert.equal(nextTranscriptName([]), "transcript-1.md");
  assert.equal(nextTranscriptName(["transcript-1.md"]), "transcript-2.md");
  // Gaps + non-transcript files are ignored; it always goes past the highest existing index.
  assert.equal(nextTranscriptName(["transcript-1.md", "transcript-5.md", "notes.md"]), "transcript-6.md");
});
