import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient as svcClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";

const BUCKET = "product-photos";
const MAX_FILES_PER_UPLOAD = 4;
const MAX_URLS_PER_LABEL = 8;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function svc() {
  return svcClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

interface ProductImageRow {
  id: string;
  label: string;
  image_urls: string[];
  created_at: string;
}

// ── GET /api/workspace/[id]/product-images ───────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;

  const { data, error } = await svc()
    .from("product_images")
    .select("id, label, image_urls, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/workspace/[id]/product-images]:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json({ data: (data as ProductImageRow[] | null) ?? [] });
}

// ── POST /api/workspace/[id]/product-images ──────────────────────────────────
// multipart/form-data: { label: string, files: File[] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const label = String(formData.get("label") ?? "").trim();
  if (!label) {
    return NextResponse.json({ error: "El label es obligatorio" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Agregá al menos una foto" }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return NextResponse.json(
      { error: `Máximo ${MAX_FILES_PER_UPLOAD} fotos por carga` },
      { status: 400 },
    );
  }
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.type)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido: ${f.type || "desconocido"}` },
        { status: 400 },
      );
    }
  }

  const supabase = svc();
  const uploadedUrls: string[] = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const path = `${workspaceId}/${randomUUID()}.${extensionFor(file.type)}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Uint8Array(buffer), { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[POST /api/workspace/[id]/product-images] upload failed:", uploadError.message);
      return NextResponse.json({ error: "Error al subir una de las fotos" }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    uploadedUrls.push(pub.publicUrl);
  }

  const { data: existing } = await supabase
    .from("product_images")
    .select("id, image_urls")
    .eq("workspace_id", workspaceId)
    .ilike("label", label)
    .maybeSingle();

  if (existing) {
    const merged = Array.from(
      new Set([...(existing.image_urls as string[]), ...uploadedUrls]),
    ).slice(0, MAX_URLS_PER_LABEL);

    const { error: updateError } = await supabase
      .from("product_images")
      .update({ image_urls: merged })
      .eq("id", existing.id as string);

    if (updateError) {
      console.error("[POST /api/workspace/[id]/product-images] update failed:", updateError.message);
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }

    return NextResponse.json({ data: { id: existing.id, label, image_urls: merged } }, { status: 200 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("product_images")
    .insert({ workspace_id: workspaceId, label, image_urls: uploadedUrls })
    .select("id, label, image_urls")
    .single();

  if (insertError) {
    console.error("[POST /api/workspace/[id]/product-images] insert failed:", insertError.message);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json({ data: inserted }, { status: 201 });
}

// ── DELETE /api/workspace/[id]/product-images ─────────────────────────────────
// body: { id: uuid, imageUrl?: string } — with imageUrl, removes just that
// photo (deleting the whole row if it was the last one); without it, deletes
// the row and all its photos.
const DeleteSchema = z.object({
  id: z.string().uuid(),
  imageUrl: z.string().url().optional(),
});

function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = DeleteSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const supabase = svc();

  const { data: existing } = await supabase
    .from("product_images")
    .select("id, image_urls")
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const currentUrls = existing.image_urls as string[];
  const urlsToDelete = parsed.data.imageUrl ? [parsed.data.imageUrl] : currentUrls;

  const paths = urlsToDelete
    .map(storagePathFromPublicUrl)
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      console.warn("[DELETE /api/workspace/[id]/product-images] storage removal failed:", removeError.message);
    }
  }

  if (parsed.data.imageUrl) {
    const remaining = currentUrls.filter((u) => u !== parsed.data.imageUrl);
    if (remaining.length === 0) {
      await supabase.from("product_images").delete().eq("id", existing.id as string);
    } else {
      await supabase
        .from("product_images")
        .update({ image_urls: remaining })
        .eq("id", existing.id as string);
    }
  } else {
    await supabase.from("product_images").delete().eq("id", existing.id as string);
  }

  return NextResponse.json({ success: true });
}
