import { createClient as createSbClient } from "@supabase/supabase-js";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Labels that currently have at least one photo, so the agent prompt can tell
 * the model exactly which names send_photo will resolve. Returns [] on error —
 * a missing photo list must never break reply generation.
 */
export async function listProductImageLabels(
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await svc()
    .from("product_images")
    .select("label, image_urls")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[product-images] listProductImageLabels:", error.message);
    return [];
  }

  return ((data as { label: string; image_urls: string[] }[] | null) ?? [])
    .filter((r) => r.image_urls.length > 0)
    .map((r) => r.label);
}
