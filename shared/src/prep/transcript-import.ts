// Turning an uploaded file into transcript TEXT.
//
// A transcript is stored as text on a row (see backend/src/prep/transcripts.ts) — the file under
// interview-prep/<slug>/transcripts/ is only a dump of it. So importing a file means extracting its
// text, not keeping the file: what the interview-brief job and the prep chat read is the text.
//
// In practice a call transcript arrives as a CAPTION export — Zoom, Meet and Teams all hand you .vtt
// or .srt — and pasting one raw buries the conversation under cue numbers and timestamps. That noise
// would then be what the brief grounds itself on, so the scaffolding is stripped here.
//
// Pure, so it lives in `shared` and is directly testable. Formats needing a real parser (.docx) are
// extracted server-side before this is reached.

// What the importer can actually read. No .pdf: nothing in the tree extracts PDF text, and offering
// it would only produce an empty transcript and a confused user.
export const TRANSCRIPT_ACCEPT = [".txt", ".md", ".vtt", ".srt", ".docx"] as const;

const isCaption = (name: string) => /\.(vtt|srt)$/i.test(name);

// A cue's timing line, in either dialect: VTT uses dots, SRT commas, and both may carry trailing
// positioning settings ("align:start line:90%").
const TIMING = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
const CUE_NUMBER = /^\s*\d+\s*$/;

// "<v Alice>text" (VTT voice span) and "Alice: text" (what Zoom/Teams write into the cue body) are
// the two ways a speaker shows up. Returned separately so consecutive cues can be merged per speaker.
function splitSpeaker(line: string): { speaker: string | null; text: string } {
  const voice = line.match(/^<v\s+([^>]+)>\s*(.*)$/i);
  if (voice) return { speaker: voice[1].trim(), text: voice[2].trim() };
  // Only treat a leading "Name:" as a speaker when it looks like a name — short, no sentence
  // punctuation — so "Note: we ran over" isn't mistaken for someone talking.
  const named = line.match(/^([A-Za-z][\w .'-]{0,40}):\s+(.*)$/);
  if (named && !/[.?!]/.test(named[1])) return { speaker: named[1].trim(), text: named[2].trim() };
  return { speaker: null, text: line.trim() };
}

// Strip caption scaffolding down to readable dialogue: drop the header, NOTE blocks, cue numbers and
// timings; unwrap speaker tags; merge consecutive cues from the same speaker into one turn.
export function cleanCaptions(raw: string): string {
  const turns: { speaker: string | null; parts: string[] }[] = [];
  let skippingNote = false;

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    // A NOTE block runs until the next blank line — its body is not dialogue.
    if (skippingNote) { if (!line) skippingNote = false; continue; }
    if (/^NOTE\b/.test(line)) { skippingNote = true; continue; }
    if (!line) continue;
    if (/^WEBVTT/i.test(line)) continue;
    if (TIMING.test(line)) continue;
    if (CUE_NUMBER.test(line)) continue;

    // Any remaining markup (<i>, <c.colour>, <00:00:01.000> inline timings) is presentation.
    const stripped = line.replace(/<[^>]*>/g, (m) => (/^<v\s/i.test(m) ? m : "")).trim();
    if (!stripped) continue;

    const { speaker, text } = splitSpeaker(stripped);
    if (!text) continue;

    const last = turns[turns.length - 1];
    // A caption breaks one sentence across cues every few seconds; merged, it reads as speech.
    if (last && last.speaker === speaker) {
      // Zoom re-emits the previous cue while a caption is still being finalised.
      if (last.parts[last.parts.length - 1] !== text) last.parts.push(text);
    } else {
      turns.push({ speaker, parts: [text] });
    }
  }

  return turns
    .map((t) => (t.speaker ? `${t.speaker}: ${t.parts.join(" ")}` : t.parts.join(" ")))
    .join("\n");
}

// The text to store for an uploaded transcript. The EXTENSION is the declared intent — a caption file
// renamed .txt is taken at its word rather than re-interpreted behind the user's back.
export function transcriptTextFrom(filename: string, content: string): string {
  return isCaption(filename) ? cleanCaptions(content) : content;
}
