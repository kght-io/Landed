"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, UploadCloud, CheckCircle2, Sparkles } from "lucide-react";

type Status = { exists: boolean; name: string; bytes?: number; mtime?: string };
type UploadResp = { ok?: boolean; error?: string; name?: string; bytes?: number; extractedChars?: number; profileUpdated?: boolean; extractedText?: string };

const fmtBytes = (n?: number) => (n == null ? "" : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(0)} KB`);

// Broadcast so the sibling Candidate-profile card re-fetches when the résumé updates the profile.
const announceProfile = () => window.dispatchEvent(new Event("fitlab-profile-updated"));

// Upload the base résumé (.docx) — the tailoring source of truth. On upload we extract the text
// (cross-platform via mammoth) to feed the candidate profile: auto-adopted if the profile is still
// the untouched seed, otherwise offered here so hand-edits aren't clobbered.
export default function ResumeUpload() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ text: string; chars: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    fetch("/api/resume/upload").then((r) => r.json()).then(setStatus).catch(() => setStatus({ exists: false, name: "resume-ref.docx" }));
  useEffect(() => { refresh(); }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setOffer(null);
    setNote(null);
    const form = new FormData();
    form.append("file", file);
    const r: UploadResp = await fetch("/api/resume/upload", { method: "POST", body: form })
      .then((x) => x.json())
      .catch(() => ({ error: "upload failed" }));
    setBusy(false);
    if (!r.ok) { setError(r.error || "upload failed"); return; }
    refresh();
    if (r.profileUpdated) { setNote("Candidate profile filled from this résumé."); announceProfile(); }
    else if (r.extractedText) setOffer({ text: r.extractedText, chars: r.extractedChars ?? r.extractedText.length });
  };

  const applyProfile = async () => {
    if (!offer) return;
    await fetch("/api/fitlab/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: offer.text }) }).catch(() => {});
    setOffer(null);
    setNote("Candidate profile replaced with this résumé.");
    announceProfile();
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = ""; // allow re-picking the same file
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300"><FileText size={15} /></span>
        <div className="min-w-0 flex-1">
          {status?.exists ? (
            <>
              <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
                <CheckCircle2 size={14} className="text-emerald-400" /> {status.name}
              </p>
              <p className="text-[12px] text-zinc-500">
                {fmtBytes(status.bytes)}{status.mtime ? ` · updated ${new Date(status.mtime).toLocaleDateString()}` : ""}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-zinc-500">No base résumé uploaded yet.</p>
          )}
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[13px] font-medium text-violet-50 transition enabled:hover:bg-violet-400 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          {status?.exists ? "Replace" : "Upload .docx"}
        </button>
        <input ref={inputRef} type="file" accept=".docx" onChange={onPick} className="hidden" />
      </div>

      {error && <p className="text-[12px] text-rose-300">{error}</p>}
      {note && <p className="flex items-center gap-1.5 text-[12px] text-emerald-400"><CheckCircle2 size={13} /> {note}</p>}

      {offer && (
        <div className="flex items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
          <Sparkles size={15} className="shrink-0 text-violet-300" />
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-zinc-300">
            Extracted <span className="font-medium text-zinc-100">{offer.chars.toLocaleString()}</span> chars from this résumé.
            Replace the candidate profile with it?
          </p>
          <button onClick={() => setOffer(null)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-zinc-400 hover:text-zinc-200">Keep current</button>
          <button onClick={applyProfile} className="shrink-0 rounded-lg bg-violet-500 px-3 py-1.5 text-[12px] font-medium text-violet-50 transition hover:bg-violet-400">Replace</button>
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-zinc-500">
        The <span className="text-zinc-300">.docx</span> is the tailoring source of truth. Tailored resumes (docx + pdf)
        are generated per application by the agent — no base PDF is needed here.
      </p>
    </div>
  );
}
