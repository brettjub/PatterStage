// ═══════════════════════════════════════════════════════════════
// hub-validation.ts — Zod schemas for hub API request bodies
// ═══════════════════════════════════════════════════════════════
//
// Every schema is an explicit whitelist (z.object strips unknown keys),
// so PUT handlers cannot mass-assign columns that are not listed here.

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  PROJECT_COLORS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/types/hub";

const id = z.string().trim().min(1, "id is required").max(100);

/** Calendar date YYYY-MM-DD that exists (rejects 2026-02-31). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2026-01-31")
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "is not a real calendar date");

const optionalId = z.union([id, z.null()]).optional();
const optionalDate = z.union([isoDateSchema, z.null()]).optional();

// ── Projects ───────────────────────────────────────────────────

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  description: z.string().max(2000).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

export const projectUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1, "name cannot be empty").max(120).optional(),
  description: z.string().max(2000).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = Omit<z.infer<typeof projectUpdateSchema>, "id">;

// ── Tasks ──────────────────────────────────────────────────────

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  notes: z.string().max(10000).optional(),
  projectId: optionalId,
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: optionalDate,
});

export const taskUpdateSchema = z.object({
  id,
  title: z.string().trim().min(1, "title cannot be empty").max(300).optional(),
  notes: z.string().max(10000).optional(),
  projectId: optionalId,
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: optionalDate,
  missionId: optionalId,
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = Omit<z.infer<typeof taskUpdateSchema>, "id">;

// ── Sites ──────────────────────────────────────────────────────

export const siteUrlSchema = z
  .string()
  .trim()
  .min(1, "url is required")
  .max(2000)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be a full http:// or https:// address");

export const siteCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  url: siteUrlSchema,
  projectId: optionalId,
});

export const siteUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1, "name cannot be empty").max(120).optional(),
  url: siteUrlSchema.optional(),
  projectId: optionalId,
});

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = Omit<z.infer<typeof siteUpdateSchema>, "id">;

// ── GitHub repos ───────────────────────────────────────────────

/** GitHub owner/name; also accepts a pasted https://github.com/owner/name URL. */
export const repoFullNameSchema = z
  .string()
  .trim()
  .transform((s) =>
    s
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, ""),
  )
  .pipe(
    z
      .string()
      .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/,
        "must look like owner/repository",
      ),
  );

export const repoCreateSchema = z.object({
  fullName: repoFullNameSchema,
  projectId: optionalId,
});

export const repoUpdateSchema = z.object({
  id,
  projectId: optionalId,
});

// ── Error response ─────────────────────────────────────────────

/**
 * 400 response naming the first problem in plain words (e.g.
 * "dueDate must be a date like 2026-01-31") so the UI can show it as-is.
 */
export function hubValidationError(error: z.ZodError): NextResponse {
  return NextResponse.json({ error: describeZodError(error) }, { status: 400 });
}

/** First issue as one readable line; prefixes the field unless the message already names it. */
export function describeZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body";
  const path = issue.path.map(String).join(".");
  const last = issue.path.length ? String(issue.path[issue.path.length - 1]) : "";
  if (!path || (last && issue.message.startsWith(last))) return issue.message;
  return path + ": " + issue.message;
}
