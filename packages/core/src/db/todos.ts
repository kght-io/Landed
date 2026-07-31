import { eq, asc, desc } from "drizzle-orm";
import { db } from "./index";
import { todos } from "./schema";
import type { TodoRow } from "./schema";

export type Todo = {
  id: number;
  text: string;
  done: boolean;
  due?: string;
  createdAt: string;
  updatedAt?: string;
};

const toTodo = (r: TodoRow): Todo => ({
  id: r.id,
  text: r.text,
  done: r.done,
  due: r.due ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt ?? undefined,
});

// Open items first, then newest. The view does the finer due-date sort.
export function listTodos(): Todo[] {
  return db
    .select()
    .from(todos)
    .orderBy(asc(todos.done), desc(todos.id))
    .all()
    .map(toTodo);
}

export function createTodo(text: string, due?: string): Todo {
  const row = db
    .insert(todos)
    .values({ text: text.trim(), due: due || null, createdAt: new Date().toISOString() })
    .returning()
    .get();
  return toTodo(row);
}

export function updateTodo(
  id: number,
  patch: { text?: string; done?: boolean; due?: string | null }
): Todo | null {
  const set: Partial<TodoRow> = { updatedAt: new Date().toISOString() };
  if (patch.text !== undefined) set.text = patch.text.trim();
  if (patch.done !== undefined) set.done = patch.done;
  if (patch.due !== undefined) set.due = patch.due || null;
  db.update(todos).set(set).where(eq(todos.id, id)).run();
  const row = db.select().from(todos).where(eq(todos.id, id)).get();
  return row ? toTodo(row) : null;
}

export function deleteTodo(id: number): boolean {
  return db.delete(todos).where(eq(todos.id, id)).run().changes > 0;
}
