"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Loader2, CalendarDays, Check } from "lucide-react";

type Todo = {
  id: number;
  text: string;
  done: boolean;
  due?: string;
  createdAt: string;
  updatedAt?: string;
};

const TODAY = new Date().toISOString().slice(0, 10);

// Friendly due-date label + urgency color.
function dueMeta(due?: string): { label: string; cls: string } | null {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  const days = Math.round((d.getTime() - new Date(TODAY + "T00:00:00").getTime()) / 86400000);
  const label =
    days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday"
    : days < 0 ? `${-days}d overdue`
    : days <= 7 ? `in ${days}d`
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
  const cls =
    days < 0 ? "text-rose-300 bg-rose-500/10 ring-rose-500/25"
    : days === 0 ? "text-amber-300 bg-amber-500/10 ring-amber-500/25"
    : "text-zinc-400 bg-zinc-800/60 ring-zinc-700/50";
  return { label, cls };
}

// Open items sorted by due date (dated first, soonest first), then newest.
function sortOpen(a: Todo, b: Todo): number {
  if (a.due && b.due) return a.due.localeCompare(b.due);
  if (a.due) return -1;
  if (b.due) return 1;
  return b.id - a.id;
}

export default function TodoView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/todos")
      .then((r) => r.json())
      .then((d) => setTodos(d.todos ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const { open, done } = useMemo(() => {
    const open = todos.filter((t) => !t.done).sort(sortOpen);
    const done = todos.filter((t) => t.done).sort((a, b) => b.id - a.id);
    return { open, done };
  }, [todos]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || adding) return;
    setAdding(true);
    try {
      const r = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, due: due || undefined }),
      });
      if (r.ok) {
        const { todo } = await r.json();
        setTodos((all) => [todo, ...all]);
        setText("");
        setDue("");
        inputRef.current?.focus();
        pendo.track("todo_created", {
          has_due_date: !!due,
          text_length: t.length,
        });
      }
    } finally {
      setAdding(false);
    }
  }

  async function toggle(todo: Todo) {
    const done = !todo.done;
    if (done) {
      pendo.track("todo_completed", {
        todo_id: todo.id,
        was_overdue: !!todo.due && todo.due < TODAY,
      });
    }
    setTodos((all) => all.map((t) => (t.id === todo.id ? { ...t, done } : t)));
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
  }

  async function remove(todo: Todo) {
    pendo.track("todo_deleted", {
      todo_id: todo.id,
      was_done: todo.done,
    });
    setTodos((all) => all.filter((t) => t.id !== todo.id));
    await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
  }

  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-3.5 backdrop-blur">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">You · To-do</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          {open.length} open{done.length > 0 && ` · ${done.length} done`}
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-6">
        {/* add */}
        <form onSubmit={add} className="flex items-center gap-2 py-4">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a to-do — follow up, prep, send thank-you…"
            className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-200 ring-1 ring-inset ring-zinc-800 outline-none placeholder:text-zinc-600 focus:ring-zinc-600"
          />
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            title="Due date (optional)"
            className="rounded-lg bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-300 ring-1 ring-inset ring-zinc-800 outline-none focus:ring-zinc-600 [color-scheme:dark]"
          />
          <button
            type="submit"
            disabled={!text.trim() || adding}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Add
          </button>
        </form>

        {/* list */}
        <div className="flex-1 space-y-1.5 overflow-y-auto pb-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> loading…
            </div>
          ) : open.length === 0 && done.length === 0 ? (
            <div className="m-auto mt-16 max-w-sm rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center text-sm text-zinc-500">
              Nothing here yet. Add your first to-do above.
            </div>
          ) : (
            <>
              {open.map((t) => (
                <TodoRow key={t.id} t={t} onToggle={toggle} onRemove={remove} />
              ))}
              {done.length > 0 && (
                <p className="px-1 pb-1 pt-5 text-[13px] font-medium uppercase tracking-wider text-zinc-600">
                  Done
                </p>
              )}
              {done.map((t) => (
                <TodoRow key={t.id} t={t} onToggle={toggle} onRemove={remove} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TodoRow({
  t,
  onToggle,
  onRemove,
}: {
  t: Todo;
  onToggle: (t: Todo) => void;
  onRemove: (t: Todo) => void;
}) {
  const due = !t.done ? dueMeta(t.due) : null;
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition hover:border-zinc-800 hover:bg-zinc-900/40">
      <button
        onClick={() => onToggle(t)}
        title={t.done ? "Mark not done" : "Mark done"}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
          t.done
            ? "border-emerald-500 bg-emerald-500 text-emerald-950"
            : "border-zinc-600 text-transparent hover:border-zinc-400"
        }`}
      >
        <Check size={13} strokeWidth={3} />
      </button>
      <span className={`flex-1 text-sm ${t.done ? "text-zinc-600 line-through" : "text-zinc-200"}`}>
        {t.text}
      </span>
      {due && (
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${due.cls}`}>
          <CalendarDays size={10} />
          {due.label}
        </span>
      )}
      <button
        onClick={() => onRemove(t)}
        title="Delete"
        className="shrink-0 rounded-md p-1 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-rose-300 group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
