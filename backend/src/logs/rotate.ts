// Rotation for the logs NOTHING else rotates — the launchd service's stdout/stderr. launchd points
// the process's fds straight at a file and never truncates them, so they grow until the disk does
// something about it. That already happened: launchd-jobhunt.err.log carries 115 `ENOSPC: no space
// left on device` errors.
//
// The mechanics live in scripts/rotate-logs.mjs; what's here is the DECISION, kept pure so the part
// that can silently destroy a generation is directly testable.
//
// Rotation is copy-truncate, not rename: launchd holds an open fd on the live file, so renaming it
// would leave the server writing to an invisible orphaned inode. Truncating in place keeps the fd
// valid (launchd opens O_APPEND, so writes resume at the new EOF).

// Rotate once a log passes this. Big enough that rotation is rare, small enough that four
// generations can't meaningfully dent the disk.
export const ROTATE_THRESHOLD_BYTES = 20_000_000; // 20 MB

// How many compressed generations to keep per log.
export const ROTATE_KEEP = 3;

// The logs to rotate, repo-root-relative. Only files this process can write: Caddy's
// data/landed-proxy.*.log are root-owned (it runs under sudo) and are left to the runner to skip.
export const ROTATE_TARGETS = [
  "data/launchd-jobhunt.out.log",
  "data/launchd-jobhunt.err.log",
] as const;

export function shouldRotate(bytes: number): boolean {
  return bytes >= ROTATE_THRESHOLD_BYTES;
}

export type Shift = { from: string; to: string };

// Work out the renames for one rotation, given the generation files that already exist alongside
// `base` (names only, any order — unrelated files are ignored).
//
// Returns shifts in APPLY ORDER: oldest generation first. Applying them in any other order
// overwrites the generation above before it has been moved, silently losing it.
export function planShifts(base: string, existing: string[], keep: number): { shifts: Shift[]; deletes: string[] } {
  const gen = (n: number) => `${base}.${n}.gz`;
  // Which generations are actually present — ignore anything not named `<base>.<n>.gz`.
  const present = new Set<number>();
  for (const name of existing) {
    if (!name.startsWith(`${base}.`) || !name.endsWith(".gz")) continue;
    const middle = name.slice(base.length + 1, -".gz".length);
    if (!/^\d+$/.test(middle)) continue;
    present.add(Number(middle));
  }

  const shifts: Shift[] = [];
  const deletes: string[] = [];
  // Walk DOWN from the oldest so each target slot is free before it's written into.
  for (let n = keep; n >= 1; n--) {
    if (!present.has(n)) continue;
    if (n >= keep) deletes.push(gen(n)); // ageing out of the window entirely
    else shifts.push({ from: gen(n), to: gen(n + 1) });
  }
  shifts.push({ from: base, to: gen(1) }); // the live log becomes generation 1
  return { shifts, deletes };
}
