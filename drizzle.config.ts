import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./backend/src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "./data/jobhunt.db" },
});
