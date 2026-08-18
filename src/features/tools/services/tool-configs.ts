import { createClient as createSbClient } from "@supabase/supabase-js";
import { registry } from "../registry";
import type { Tool } from "../core/tool";
import {
  buildWebhookInstanceTool,
  type WebhookToolRow,
} from "../tools/custom-webhook";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ToolConfigRow {
  tool: { key?: string } | null;
  enabled: boolean;
}

/**
 * Static tool keys resolved from tool_configs — "custom_webhook" is
 * deliberately excluded: it's now a family of dynamically-named instances
 * sourced from webhook_tools (below), not a single toggleable tool.
 */
async function getEnabledStaticTools(workspaceId: string): Promise<Tool[]> {
  const supabase = svc();

  const { data } = await supabase
    .from("tool_configs")
    .select("tool:tools(key), enabled")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  const rows = (data as ToolConfigRow[] | null) ?? [];

  const enabledKeys = new Set<string>();
  for (const row of rows) {
    const key = row.tool?.key;
    if (typeof key !== "string" || key === "custom_webhook") continue;
    enabledKeys.add(key);
  }

  return registry.list().filter((t) => enabledKeys.has(t.name));
}

/** Builds one dynamic Tool per enabled webhook_tools row for this workspace. */
async function getEnabledWebhookInstanceTools(
  workspaceId: string,
): Promise<Tool[]> {
  const supabase = svc();

  const { data } = await supabase
    .from("webhook_tools")
    .select("name, description, webhook_url, payload_fields, ai_params")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  const rows = (data as WebhookToolRow[] | null) ?? [];
  return rows.map(buildWebhookInstanceTool);
}

/**
 * Returns the list of Tool instances that are enabled for a given workspace,
 * merging:
 *  - static tools (echo, schedule_link, schedule_highlevel, ...) resolved
 *    from tool_configs exactly as before, and
 *  - dynamic webhook instances, one per enabled webhook_tools row, each
 *    with its own name/description/schema (see buildWebhookInstanceTool).
 *
 * Tool names must be unique within the returned list — the model can't
 * distinguish two tools that share a name. webhookToolNameSchema (save-time
 * validation) and the DB's UNIQUE(workspace_id, name) already prevent this
 * at the source, but we guard again here since this list is what actually
 * reaches the model: any row that collides with an already-seen name
 * (static or dynamic) is dropped and logged rather than silently offered.
 */
export async function getEnabledTools(workspaceId: string): Promise<Tool[]> {
  const [staticTools, webhookTools] = await Promise.all([
    getEnabledStaticTools(workspaceId),
    getEnabledWebhookInstanceTools(workspaceId),
  ]);

  const seen = new Set<string>();
  const result: Tool[] = [];
  for (const t of [...staticTools, ...webhookTools]) {
    if (seen.has(t.name)) {
      console.warn(
        `[tool-configs] duplicate tool name "${t.name}" for workspace ${workspaceId} — dropping the extra instance`,
      );
      continue;
    }
    seen.add(t.name);
    result.push(t);
  }
  return result;
}
