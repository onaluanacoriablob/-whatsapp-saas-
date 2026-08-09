import { createClient as createSbClient } from "@supabase/supabase-js";
import { registry } from "../registry";
import type { Tool } from "../core/tool";
import { buildCustomWebhookSchema, type AiParam } from "../lib/tool-config";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ToolConfigRow {
  tool: { key?: string } | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

/**
 * Returns the list of Tool instances that are enabled for a given workspace.
 * Reads the tool_configs table — if a tool has no row, it is considered disabled.
 *
 * custom_webhook gets its schema rebuilt per workspace from its configured
 * ai_params (see buildCustomWebhookSchema) — every other tool keeps its
 * static schema unchanged.
 */
export async function getEnabledTools(workspaceId: string): Promise<Tool[]> {
  const supabase = svc();

  const { data } = await supabase
    .from("tool_configs")
    .select("tool:tools(key), enabled, config")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  const rows = (data as ToolConfigRow[] | null) ?? [];

  const enabledKeys = new Set<string>();
  const configByKey = new Map<string, Record<string, unknown> | null>();
  for (const row of rows) {
    const key = row.tool?.key;
    if (typeof key !== "string") continue;
    enabledKeys.add(key);
    configByKey.set(key, row.config);
  }

  return registry
    .list()
    .filter((t) => enabledKeys.has(t.name))
    .map((t) => {
      if (t.name !== "custom_webhook") return t;
      const config = configByKey.get(t.name);
      const aiParams = Array.isArray(config?.ai_params)
        ? (config!.ai_params as AiParam[])
        : [];
      if (aiParams.length === 0) return t;
      return { ...t, schema: buildCustomWebhookSchema(aiParams) };
    });
}
