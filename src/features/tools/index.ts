import { registry } from "./registry";
import { echoTool } from "./tools/echo";
import { scheduleLinkTool } from "./tools/schedule-link";
import { scheduleHighLevelTool } from "./tools/schedule-highlevel";
import { checkAvailabilityTool } from "./tools/check-availability";

// custom_webhook is not registered here — it's not a single static tool
// anymore. Each workspace's webhook_tools rows become their own dynamic
// Tool instances via buildWebhookInstanceTool(), assembled per-request by
// getEnabledTools() (tool-configs.ts).
registry.register(echoTool);
registry.register(scheduleLinkTool);
registry.register(scheduleHighLevelTool);
registry.register(checkAvailabilityTool);

export { registry };
export type {
  Tool,
  ToolContext,
  ToolResult,
  ToolSensitivity,
} from "./core/tool";
