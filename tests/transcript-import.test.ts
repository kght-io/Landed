import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCaptions, transcriptTextFrom, TRANSCRIPT_ACCEPT } from "@landed/shared/prep/transcript-import";

// A call transcript arrives as a caption export far more often than as prose — Zoom, Meet and Teams
// all hand you .vtt or .srt. Pasting one raw buries the conversation in cue numbers and timestamps,
// and that noise is what the interview-brief job would then be grounding itself on. So the import
// strips the scaffolding and keeps the dialogue.

const VTT = `WEBVTT

NOTE recording started

1
00:00:01.000 --> 00:00:04.000
<v Alice>Hi, thanks for joining today.

2
00:00:04.500 --> 00:00:07.000
<v Alice>Let's start with your background.

3
00:00:07.500 --> 00:00:11.000
<v Bob>Sure — I've been working on distributed systems.
`;

const SRT = `1
00:00:01,000 --> 00:00:04,000
Alice: Hi, thanks for joining today.

2
00:00:04,500 --> 00:00:07,000
Bob: Happy to be here.
`;

test("a WEBVTT export keeps the dialogue and drops the scaffolding", () => {
  const out = cleanCaptions(VTT);
  assert.ok(!out.includes("WEBVTT"));
  assert.ok(!out.includes("-->"), "timestamps gone");
  assert.ok(!/^\d+$/m.test(out), "cue numbers gone");
  assert.ok(!out.includes("NOTE recording started"));
  assert.ok(out.includes("Hi, thanks for joining today."));
  assert.ok(out.includes("distributed systems"));
});

test("speaker tags become readable labels", () => {
  const out = cleanCaptions(VTT);
  assert.ok(out.includes("Alice:"), "speaker attributed");
  assert.ok(out.includes("Bob:"));
  assert.ok(!out.includes("<v "), "no raw markup left");
});

// A caption file breaks one sentence across cues every few seconds. Left as separate lines the
// transcript reads as staccato fragments rather than as someone talking.
test("consecutive cues from the same speaker are merged into one turn", () => {
  const out = cleanCaptions(VTT);
  const aliceLines = out.split("\n").filter((l) => l.startsWith("Alice:"));
  assert.equal(aliceLines.length, 1, "Alice's two cues became one turn");
  assert.ok(aliceLines[0].includes("thanks for joining"));
  assert.ok(aliceLines[0].includes("your background"));
});

test("an SRT export is handled the same way", () => {
  const out = cleanCaptions(SRT);
  assert.ok(!out.includes("-->"));
  assert.ok(out.includes("Alice: Hi, thanks for joining today."));
  assert.ok(out.includes("Bob: Happy to be here."));
});

// Zoom repeats the speaker name on every cue; keeping it on every merged turn is fine, but the
// label must not be duplicated INSIDE a turn when cues merge.
test("merging does not repeat the speaker label inside a turn", () => {
  const out = cleanCaptions(VTT);
  const alice = out.split("\n").find((l) => l.startsWith("Alice:")) ?? "";
  assert.equal(alice.match(/Alice:/g)?.length, 1);
});

test("plain text passes through untouched", () => {
  const prose = "Interviewer: how would you shard this?\n\nMe: by tenant, then by time.";
  assert.equal(transcriptTextFrom("notes.txt", prose).trim(), prose);
  assert.equal(transcriptTextFrom("notes.md", prose).trim(), prose);
});

test("a caption file is cleaned based on its extension", () => {
  assert.ok(!transcriptTextFrom("call.vtt", VTT).includes("-->"));
  assert.ok(!transcriptTextFrom("call.srt", SRT).includes("-->"));
  // Same content with a .txt name is NOT reinterpreted — the extension is the declared intent.
  assert.ok(transcriptTextFrom("call.txt", VTT).includes("-->"));
});

test("an empty or whitespace-only file yields empty text, not junk", () => {
  assert.equal(cleanCaptions(""), "");
  assert.equal(cleanCaptions("WEBVTT\n\n").trim(), "");
  assert.equal(transcriptTextFrom("a.vtt", "   \n  \n").trim(), "");
});

test("a caption file with no speaker tags still yields its lines", () => {
  const noSpeaker = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
so tell me about a hard bug

2
00:00:03.500 --> 00:00:06.000
there was a race in the queue
`;
  const out = cleanCaptions(noSpeaker);
  assert.ok(out.includes("hard bug"));
  assert.ok(out.includes("race in the queue"));
  assert.ok(!out.includes("-->"));
});

// Zoom emits a duplicate of the previous cue while a caption is still being finalised.
test("a cue repeated verbatim is not written twice", () => {
  const dupe = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Alice>same line

2
00:00:03.000 --> 00:00:05.000
<v Alice>same line
`;
  assert.equal(cleanCaptions(dupe).match(/same line/g)?.length, 1);
});

test("the accept list covers what the importer can actually read", () => {
  const accept: readonly string[] = TRANSCRIPT_ACCEPT;
  for (const ext of [".txt", ".md", ".vtt", ".srt", ".docx"]) assert.ok(accept.includes(ext), ext);
  assert.ok(!accept.includes(".pdf"), "no pdf extractor is installed — don't offer it");
});
