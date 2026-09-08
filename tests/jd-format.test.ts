import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, stripHtml, jdBlocks } from "@landed/shared/jobs/jd";

// ── entities ──────────────────────────────────────────────────────────────────────────────────
// Greenhouse `content` is DOUBLE-encoded: the markup is escaped (`&lt;p&gt;`) and the entities
// inside it are escaped again (`&amp;nbsp;`). One decode pass turns `&amp;nbsp;` into `&nbsp;` —
// after the `&nbsp;` rule has already run — so the literal text leaked into every stored JD.
test("a double-encoded entity decodes all the way", () => {
  assert.equal(decodeEntities("prices down.&amp;nbsp;"), "prices down. ");
  assert.equal(decodeEntities("a &amp;amp; b"), "a & b");
});

test("ordinary single-encoded entities still decode", () => {
  assert.equal(decodeEntities("R&amp;D"), "R&D");
  assert.equal(decodeEntities("it&#39;s"), "it's");
  assert.equal(decodeEntities("we&rsquo;ve"), "we’ve");
  assert.equal(decodeEntities("a&nbsp;b"), "a b");
});

// A bare ampersand in real prose must survive — "R&D" written literally is not an entity.
test("a bare ampersand is left alone", () => {
  assert.equal(decodeEntities("Trust & Safety"), "Trust & Safety");
});

// ── structure ─────────────────────────────────────────────────────────────────────────────────
test("block tags become paragraph breaks and list items become bullets", () => {
  const out = stripHtml("&lt;p&gt;Intro&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;li&gt;Two&lt;/li&gt;&lt;/ul&gt;");
  assert.match(out!, /Intro/);
  assert.match(out!, /• One/);
  assert.match(out!, /• Two/);
});

test("stripHtml returns null for empty input rather than an empty string", () => {
  assert.equal(stripHtml(null), null);
  assert.equal(stripHtml(""), null);
  assert.equal(stripHtml("&lt;p&gt;&lt;/p&gt;"), null);
});

// ── rendering blocks ──────────────────────────────────────────────────────────────────────────
// The panel renders typed blocks rather than one pre-wrapped string, so bullets indent and headings
// stand out instead of every line looking identical.
test("bullets are their own block type", () => {
  // Real prose either side, so the surrounding lines don't trip the heading rule (short +
  // unpunctuated) and the assertion is actually about the bullets.
  const bs = jdBlocks("You will own the billing platform end to end, working across teams.\n• First\n• Second\n\nWe are looking for someone who has shipped systems at this scale before.");
  assert.deepEqual(bs.map((b) => b.type), ["p", "ul", "p"]);
  assert.deepEqual(bs[1].items, ["First", "Second"]);
});

// A short line with no trailing punctuation, followed by more content, is how these JDs write their
// section headings ("Our Mission", "You'll enjoy this role if…") — there is no <h*> left by then.
test("a short unpunctuated line reads as a heading", () => {
  const bs = jdBlocks("Our Mission\n\nHealthcare should work for patients, but it doesn't.");
  assert.equal(bs[0].type, "h");
  assert.equal(bs[0].text, "Our Mission");
  assert.equal(bs[1].type, "p");
});

test("a long line is a paragraph even without punctuation", () => {
  const long = "This sentence runs on well past the length at which a line could plausibly be a section heading in a job description";
  assert.equal(jdBlocks(long)[0].type, "p");
});

test("blank runs don't produce empty blocks", () => {
  const bs = jdBlocks("One\n\n\n\nTwo");
  assert.equal(bs.length, 2);
  assert.ok(bs.every((b) => (b.text ?? "").trim() !== "" || b.items?.length));
});

test("empty input yields no blocks", () => {
  assert.deepEqual(jdBlocks(""), []);
  assert.deepEqual(jdBlocks("   \n  "), []);
});

// Already-stored JDs carry the literal `&nbsp;` from the old decoder. The renderer repairs them on
// the way out so reading them doesn't require a re-scan of every board.
test("blocks repair entities left behind by the old decoder", () => {
  const bs = jdBlocks("prices down.&amp;nbsp;\n\nNext paragraph");
  assert.equal(bs[0].text, "prices down.");
});
