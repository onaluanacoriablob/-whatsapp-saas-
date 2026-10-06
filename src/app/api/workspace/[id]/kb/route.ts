// F7: Knowledge base API — ingest documents and list KB for a workspace.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSvcClient } from "@supabase/supabase-js";
import {
  ingestDocument,
  listKbDocuments,
  updateDocument,
} from "@/features/inbox/services/kb-service";
import { fetchUrlText } from "@/features/inbox/services/url-scraper";

function svc() {
  return createSvcClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const IngestSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(500_000),
  sourceType: z.string().max(50).optional(),
});

// ── Shared auth + membership helper ──────────────────────────────────────────

async function resolveWorkspaceMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
) {
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

// ── GET /api/workspace/[id]/kb ───────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveWorkspaceMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  try {
    const documents = await listKbDocuments(workspaceId);
    return NextResponse.json({ data: documents });
  } catch (err) {
    console.error("[GET /api/workspace/[id]/kb]:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

// ── POST /api/workspace/[id]/kb ──────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveWorkspaceMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = IngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // For URL sources, download and extract the page text BEFORE ingesting —
  // otherwise only the URL string itself gets indexed (the old bug).
  let content = parsed.data.content;
  let meta: Record<string, unknown> | undefined;
  if (parsed.data.sourceType === "url") {
    const sourceUrl = parsed.data.content.trim();
    try {
      const scraped = await fetchUrlText(parsed.data.content);
      content = `[Fuente: ${sourceUrl}]\n\n${scraped}`;
      // Store the URL so the agent can share the page link (not just answer
      // from the scraped text, which rarely surfaces the URL itself).
      meta = { source_url: sourceUrl };
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "No se pudo leer la URL",
        },
        { status: 422 },
      );
    }
  }

  try {
    const result = await ingestDocument({
      workspaceId,
      title: parsed.data.title,
      content,
      sourceType: parsed.data.sourceType,
      meta,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/workspace/[id]/kb]:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

// ── PATCH /api/workspace/[id]/kb ──────────────────────────────────────────────

const UpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(500_000),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveWorkspaceMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Confirm the document belongs to this workspace before touching it.
  const { data: existing } = await svc()
    .from("kb_documents")
    .select("id")
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Documento no encontrado" },
      { status: 404 },
    );
  }

  try {
    const result = await updateDocument({
      workspaceId,
      documentId: parsed.data.id,
      title: parsed.data.title,
      content: parsed.data.content,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[PATCH /api/workspace/[id]/kb]:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

// ── DELETE /api/workspace/[id]/kb ─────────────────────────────────────────────

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const member = await resolveWorkspaceMember(supabase, workspaceId, user.id);
  if (!member) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  if (!["admin", "manager"].includes(member.role as string)) {
    return NextResponse.json(
      { error: "Se requiere rol admin o manager" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = svc();

  // Verify the document belongs to this workspace before deleting
  const { data: existing } = await db
    .from("kb_documents")
    .select("id, meta")
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Documento no encontrado" },
      { status: 404 },
    );
  }

  // Delete from Storage if media_url exists in meta
  const meta = existing.meta as Record<string, unknown> | null;
  if (meta?.media_url && typeof meta.media_url === "string") {
    try {
      // Extract path from storage URL: .../storage/v1/object/public/[bucket]/[path]
      const url = new URL(meta.media_url);
      const segments = url.pathname.split("/object/public/");
      if (segments.length === 2) {
        const [bucket, ...pathParts] = segments[1].split("/");
        const filePath = pathParts.join("/");
        await db.storage.from(bucket).remove([filePath]);
      }
    } catch {
      // Non-fatal — proceed with DB deletion
      console.warn("[DELETE /api/workspace/[id]/kb] Storage removal failed");
    }
  }

  // Delete document — kb_chunks cascade via FK
  const { error: deleteError } = await db
    .from("kb_documents")
    .delete()
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId);

  if (deleteError) {
    console.error("[DELETE /api/workspace/[id]/kb]:", deleteError);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
