import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  label: z
    .string()
    .describe(
      "Nombre exacto del color/variante a mostrar, ej: 'Marfil', 'gris oscuro texturado'",
    ),
  caption: z
    .string()
    .optional()
    .describe("Texto corto opcional para acompañar la primera foto"),
});

type Args = z.infer<typeof schema>;

// Cap sends per call: keeps run() comfortably under the registry's 10s
// timeout (sent in parallel below) and avoids spamming the customer.
const MAX_PHOTOS_PER_SEND = 4;

interface ProductImageRow {
  label: string;
  image_urls: string[];
}

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  // The whole body is wrapped in try/catch and NEVER rethrows: registry.run()
  // retries a tool that throws (or times out) by re-executing it in full —
  // for a tool with a real side-effect (sending a WhatsApp message) that
  // would re-send photos that already went out. Always resolve to a
  // ToolResult instead.
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    let row: ProductImageRow | null = null;

    const { data: exact } = await svc
      .from("product_images")
      .select("label, image_urls")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("label", args.label)
      .maybeSingle();
    row = (exact as ProductImageRow | null) ?? null;

    if (!row) {
      const { data: fuzzy } = await svc
        .from("product_images")
        .select("label, image_urls")
        .eq("workspace_id", ctx.workspaceId)
        .ilike("label", `%${args.label}%`)
        .limit(1)
        .maybeSingle();
      row = (fuzzy as ProductImageRow | null) ?? null;
    }

    if (!row || row.image_urls.length === 0) {
      const { data: all } = await svc
        .from("product_images")
        .select("label")
        .eq("workspace_id", ctx.workspaceId);
      const available = ((all as { label: string }[] | null) ?? [])
        .map((r) => r.label)
        .join(", ");
      return {
        ok: false,
        output: null,
        error: `No hay fotos cargadas para "${args.label}". Colores disponibles: ${available || "ninguno"}`,
      };
    }

    const { dispatchImage } = await import("../../inbox/services/dispatch");
    const urls = row.image_urls.slice(0, MAX_PHOTOS_PER_SEND);

    const results = await Promise.all(
      urls.map((imageUrl, i) =>
        dispatchImage({
          workspaceId: ctx.workspaceId,
          conversationId: ctx.conversationId,
          imageUrl,
          caption: i === 0 ? args.caption : undefined,
        }).catch((err) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        })),
      ),
    );

    const sent = results.filter((r) => r.ok).length;

    return {
      ok: sent > 0,
      output: { sent, label: row.label },
      error: sent === 0 ? "No se pudo enviar ninguna foto" : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      output: null,
      error:
        err instanceof Error ? err.message : "Error inesperado enviando la foto",
    };
  }
}

export const sendPhotoTool: Tool<Args> = {
  name: "send_photo",
  description:
    "Envía al cliente por WhatsApp una o más fotos reales de un color/variante del catálogo. Usala cuando el cliente pida ver una foto de un color específico — pasá el nombre exacto del color.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
