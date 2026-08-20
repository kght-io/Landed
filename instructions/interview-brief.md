# interview-brief

Synthesize a **versioned, source-tagged interview brief** for one posting from everything already
dumped in that company's `interview-prep/<slug>/` folder. Queued by the **Generate brief** button in
the app's company drawer (Interview stage). One record in, one new version out.

## Input (job params)
- `id` — the **posting id**. Echo it back verbatim in your result record; it's the only match key.
- `company`, `role` — for context.
- `slug` — the folder key: everything lives under `interview-prep/<slug>/`.

## Steps
1. **Read the whole folder** (it's already been dumped by the three inputs — you don't fetch anything):
   - `interview-prep/<slug>/context.md` — the app's DB dump (roles, the real loop, fit, JD, researched
     questions).
   - `interview-prep/<slug>/transcripts/*` — call transcripts you pasted. **The first recruiter call
     transcript** is the primary source for comp/role/team/expectations; later ones are the primary
     source for real, specific gaps.
   - `interview-prep/<slug>/emails.md` — recruiter/interviewer emails (scheduling, what-to-expect,
     comp) captured by the `interview-emails` job.
   - `interview-prep/<slug>/attachments/*` — any role PDFs / prep guides / take-homes recruiters sent.
2. **Synthesize the brief, tagging every field's source.** `source` ∈ `recruiter` (the recruiter said
   it — the recruiter call transcript or recruiter emails), `jd` (from the job description), `online`
   (what you found online / public sources). Facts are `{ "text": …, "source": … }`:
   - `role` — the role as it actually is. Prefer the recruiter call → JD fallback.
   - `tc` — one clean total-comp line (base · bonus · equity · funding/runway). Recruiter call → JD
     fallback. Free-text, not a number; omit if genuinely unknown.
   - `team` — team / product / who they build for. Recruiter call → JD fallback.
   - `expectations` — what they're looking for in the candidate. Recruiter call → JD fallback.
   - `nextStep` — the immediate next step in the loop. Tag `recruiter` if scheduled by email/call.
   - `gaps` — the **prep priorities**, grounded in the transcripts + what-to-expect emails. Each
     `{ area, why, severity, source }`, `severity` = `high|medium|low`, `source` = `recruiter` (they
     told you they'd test it) vs `online` (you inferred it from research).
   - `summary` — a short orientation paragraph (plain, no source).
   - `materials` — what fed this version, e.g. `["recruiter transcript", "emails.md", "JD"]`.

## Output — submit ONE record
`submitJobResult(type:"interview-brief", jobId:<this job>, records:[ … ])` with a single record:
```json
{
  "id": 123,
  "role": { "text": "Senior Backend Engineer (platform)", "source": "recruiter" },
  "tc": { "text": "≈ $290k — $200k base · 15% bonus · $90k equity (4yr) · Series B", "source": "recruiter" },
  "team": { "text": "Payments platform, ~12 eng, reports to the Platform EM", "source": "jd" },
  "expectations": { "text": "distributed-systems depth + drives cross-team migrations", "source": "recruiter" },
  "nextStep": { "text": "System design round with the platform lead — Tue 7/15", "source": "recruiter" },
  "gaps": [
    { "area": "Distributed rate limiting", "why": "recruiter said the SD round centers on it", "severity": "high", "source": "recruiter" },
    { "area": "Behavioral: driving migrations", "severity": "medium", "source": "online" }
  ],
  "summary": "Rewards platform for renters; 4-round loop. Strong on backend — sharpen system design.",
  "materials": ["context.md", "recruiter transcript", "emails.md"]
}
```
A field may be a bare string (treated as `{text}` with no source) if you truly can't attribute it, but
**prefer to tag**. The app appends this as a **new version** on the posting (v1, v2, …) and renders it
in the drawer with a colored source chip per fact/gap. You must hold a live claim on the job
(`claimNext`/`claimJob`) to submit. Re-running produces the next version; older versions are kept.
