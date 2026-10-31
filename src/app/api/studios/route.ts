import { NextRequest, NextResponse } from "next/server";
import { cleanStudioTitle } from "@/lib/title";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isBusyStatus, stopJob } from "@/lib/jobs";
import {
  detectSource,
  processStudio,
  rerenderStudio,
  resolveLocalVideo,
  saveUpload,
  validateSourceUrl,
  VIDEO_EXT_RE,
} from "@/lib/pipeline";
import { denyIfUnlicensed } from "@/lib/license-guard";
import { guardApiRequest } from "@/lib/request-guard";
import { listStudios, loadStudio, mergeSkills, saveStudio } from "@/lib/store";
import type { Studio } from "@/lib/types";

const createSchema = z.object({
  source: z.enum(["youtube", "tiktok", "upload"]).optional(),
  link: z.string().url().optional(),
  /** Absolute path to a video already on this machine (used in place). */
  localPath: z.string().min(1).optional(),
  title: z.string().optional(),
  exportAspect: z.enum(["9:16", "16:9", "1:1"]).optional(),
  targetSec: z.number().min(15).max(180).optional(),
  genre: z.string().optional(),
  skills: z
    .object({
      smartCover: z.boolean().optional(),
      smartHook: z.boolean().optional(),
      hookStyle: z.enum(["classic", "dark", "bold", "sticker", "clapper"]).optional(),
      autoReframe: z.boolean().optional(),
      captions: z.boolean().optional(),
      captionLanguage: z.enum(["id", "en", "auto"]).optional(),
    })
    .optional(),
});

export async function GET() {
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  return NextResponse.json({ status: true, data: { items: listStudios() } });
}

export async function POST(req: NextRequest) {
  const blocked = guardApiRequest(req, { allowMultipart: true });
  if (blocked) return blocked;
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  const contentType = req.headers.get("content-type") || "";
  let source: Studio["source"] | undefined;
  let link: string | undefined;
  let title: string | undefined;
  let exportAspect: Studio["exportAspect"] | undefined;
  let targetSec: number | undefined;
  let genre: string | undefined;
  let skillsPartial: Parameters<typeof mergeSkills>[0];
  let uploadAbs: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const linkField = form.get("link");
    const localField = form.get("localPath");
    const sourceField = form.get("source");
    title = String(form.get("title") || "") || undefined;
    exportAspect = (String(form.get("exportAspect") || "9:16") as Studio["exportAspect"]) || "9:16";
    targetSec = Number(form.get("targetSec") || 40) || 40;
    genre = String(form.get("genre") || "") || undefined;
    const skillsRaw = form.get("skills");
    if (typeof skillsRaw === "string" && skillsRaw) {
      skillsPartial = JSON.parse(skillsRaw);
    }
    if (file instanceof File && file.size > 0) {
      if (!VIDEO_EXT_RE.test(file.name) && !(file.type || "").startsWith("video/")) {
        return NextResponse.json({ status: false, message: "File bukan video" }, { status: 400 });
      }
      const up = await saveUpload(file);
      uploadAbs = up.absPath;
      title = title || up.title;
      source = "upload";
    } else if (typeof localField === "string" && localField.trim()) {
      const r = resolveLocalVideo(localField);
      if (!r.ok) return NextResponse.json({ status: false, message: r.message }, { status: 400 });
      uploadAbs = r.absPath;
      title = title || r.title;
      source = "upload";
    } else if (typeof linkField === "string" && linkField) {
      link = linkField;
      source =
        sourceField === "tiktok" || sourceField === "youtube"
          ? sourceField
          : detectSource(linkField);
    } else {
      return NextResponse.json({ status: false, message: "file atau link wajib" }, { status: 400 });
    }
  } else {
    const body = createSchema.parse(await req.json());
    link = body.link;
    title = body.title;
    exportAspect = body.exportAspect;
    targetSec = body.targetSec;
    genre = body.genre;
    skillsPartial = body.skills;
    if (body.localPath) {
      const r = resolveLocalVideo(body.localPath);
      if (!r.ok) return NextResponse.json({ status: false, message: r.message }, { status: 400 });
      uploadAbs = r.absPath;
      title = title || r.title;
      source = "upload";
    } else if (body.source === "upload") {
      return NextResponse.json(
        { status: false, message: "upload: kirim file (multipart) atau localPath" },
        { status: 400 },
      );
    } else if (!link) {
      return NextResponse.json({ status: false, message: "link atau localPath wajib" }, { status: 400 });
    } else {
      source = body.source || detectSource(link);
      const err = validateSourceUrl(source, link);
      if (err) return NextResponse.json({ status: false, message: err }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const studio: Studio = {
    id: randomUUID(),
    title: title || "Untitled",
    source: source!,
    sourceUrl: uploadAbs || link,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    skills: mergeSkills(skillsPartial),
    clips: [],
    exportAspect: exportAspect || "9:16",
    mediaPath: uploadAbs,
    targetSec: targetSec || 40,
    genre: genre || "general",
    progress: { pct: 0, message: "Queued…" },
  };
  saveStudio(studio);
  void processStudio(studio.id);
  return NextResponse.json({ status: true, data: studio });
}

export async function PATCH(req: NextRequest) {
  const blocked = guardApiRequest(req);
  if (blocked) return blocked;
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  const body = z
    .object({
      id: z.string(),
      skills: createSchema.shape.skills,
      exportAspect: createSchema.shape.exportAspect,
      reprocess: z.boolean().optional(),
      rerender: z.boolean().optional(),
      clipId: z.string().optional(),
      /** Rename the studio's display title; "" resets to the automatic title. */
      displayTitle: z.string().max(200).optional(),
      clipPatch: z
        .object({
          liked: z.boolean().nullable().optional(),
          hidden: z.boolean().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
        })
        .optional(),
    })
    .parse(await req.json());

  const studio = loadStudio(body.id);
  if (!studio) return NextResponse.json({ status: false, message: "not found" }, { status: 404 });

  let next: Studio = {
    ...studio,
    skills: body.skills ? mergeSkills({ ...studio.skills, ...body.skills }) : studio.skills,
    exportAspect: body.exportAspect || studio.exportAspect,
    updatedAt: new Date().toISOString(),
  };

  if (body.displayTitle !== undefined) {
    const t = body.displayTitle.replace(/\s+/g, " ").trim().slice(0, 120);
    next = t
      ? { ...next, displayTitle: t, displayTitleSource: "user" }
      : { ...next, displayTitle: cleanStudioTitle(next.title), displayTitleSource: "local" };
  }

  if (body.clipId && body.clipPatch) {
    next = {
      ...next,
      clips: next.clips.map((c) => {
        if (c.id !== body.clipId) return c;
        const patch = { ...body.clipPatch };
        if (patch.title !== undefined) {
          patch.title = patch.title.replace(/\s+/g, " ").trim().slice(0, 120);
          if (!patch.title || patch.title === c.title) delete patch.title;
        }
        // A real rename is sticky: AI/local title generation will leave it alone.
        return patch.title !== undefined ? { ...c, ...patch, titleEdited: true } : { ...c, ...patch };
      }),
    };
  }

  saveStudio(next);
  if (body.reprocess || body.rerender) {
    if (isBusyStatus(studio.status)) stopJob(studio.id);
    const canRerender =
      Boolean(body.rerender) &&
      Boolean(next.mediaPath) &&
      Boolean(next.transcript?.length) &&
      Boolean(next.clips?.length);
    next = {
      ...next,
      status: "queued",
      error: undefined,
      progress: {
        pct: 0,
        message: canRerender ? "Re-render queued…" : "Queued…",
      },
      updatedAt: new Date().toISOString(),
    };
    saveStudio(next);
    if (canRerender) void rerenderStudio(next.id);
    else void processStudio(next.id);
  }
  return NextResponse.json({ status: true, data: loadStudio(next.id) });
}
