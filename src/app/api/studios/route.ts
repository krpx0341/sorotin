import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { detectSource, processStudio, saveUpload, validateSourceUrl } from "@/lib/pipeline";
import { listStudios, loadStudio, mergeSkills, saveStudio } from "@/lib/store";
import type { Studio } from "@/lib/types";

const createSchema = z.object({
  source: z.enum(["youtube", "tiktok", "upload"]).optional(),
  link: z.string().url().optional(),
  title: z.string().optional(),
  exportAspect: z.enum(["9:16", "16:9", "1:1"]).optional(),
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
  return NextResponse.json({ status: true, data: { items: listStudios() } });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  let source: Studio["source"] | undefined;
  let link: string | undefined;
  let title: string | undefined;
  let exportAspect: Studio["exportAspect"] | undefined;
  let skillsPartial: Parameters<typeof mergeSkills>[0];
  let uploadAbs: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const linkField = form.get("link");
    const sourceField = form.get("source");
    title = String(form.get("title") || "") || undefined;
    exportAspect = (String(form.get("exportAspect") || "9:16") as Studio["exportAspect"]) || "9:16";
    const skillsRaw = form.get("skills");
    if (typeof skillsRaw === "string" && skillsRaw) {
      skillsPartial = JSON.parse(skillsRaw);
    }
    if (file instanceof File && file.size > 0) {
      const up = await saveUpload(file);
      uploadAbs = up.absPath;
      title = title || up.title;
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
    skillsPartial = body.skills;
    if (body.source === "upload") {
      return NextResponse.json(
        { status: false, message: "upload pakai multipart form-data" },
        { status: 400 },
      );
    }
    if (!link) {
      return NextResponse.json({ status: false, message: "link wajib" }, { status: 400 });
    }
    source = body.source || detectSource(link);
    const err = validateSourceUrl(source, link);
    if (err) return NextResponse.json({ status: false, message: err }, { status: 400 });
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
  };
  saveStudio(studio);

  // Fire-and-forget local worker. Personal tool — process on this machine.
  void processStudio(studio.id);

  return NextResponse.json({ status: true, data: studio });
}

export async function PATCH(req: NextRequest) {
  const body = z
    .object({
      id: z.string(),
      skills: createSchema.shape.skills,
      exportAspect: createSchema.shape.exportAspect,
      reprocess: z.boolean().optional(),
    })
    .parse(await req.json());
  const studio = loadStudio(body.id);
  if (!studio) return NextResponse.json({ status: false, message: "not found" }, { status: 404 });
  const next = {
    ...studio,
    skills: body.skills ? mergeSkills({ ...studio.skills, ...body.skills }) : studio.skills,
    exportAspect: body.exportAspect || studio.exportAspect,
    updatedAt: new Date().toISOString(),
  };
  saveStudio(next);
  if (body.reprocess) {
    next.status = "queued";
    next.error = undefined;
    saveStudio(next);
    void processStudio(next.id);
  }
  return NextResponse.json({ status: true, data: loadStudio(next.id) });
}
