import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  canTransition,
  type ConversationState,
} from "@/features/inbox/services/state-machine";

const toggleAiSchema = z.object({
  ai_enabled: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // 1. Parse and validate body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = toggleAiSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { ai_enabled } = parsed.data;

    // 2. Verify authenticated user session
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Resolve conversation id from route params
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Missing conversation id" },
        { status: 400 },
      );
    }

    // 4. Update ai_enabled AND the conversation state together — RLS on this
    // read/update ensures the user can only touch their workspace rows.
    //
    // The state has to move with the flag: decide() abstains unless the state
    // is exactly 'ai_active', so flipping ai_enabled alone produced a
    // conversation that claimed the AI was on while it stayed permanently
    // mute. Mirrors applyTransition()'s `ai_enabled: to === "ai_active"`.
    const { data: current, error: readError } = await supabase
      .from("conversations")
      .select("id, state")
      .eq("id", id)
      .single();

    if (readError || !current) {
      if (readError?.code === "PGRST116" || !current) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      console.error("[toggle-ai] read error:", readError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const currentState = current.state as ConversationState;
    const targetState: ConversationState = ai_enabled
      ? "ai_active"
      : "human_active";

    // 'closed' is terminal and nothing transitions out of it.
    if (
      currentState !== targetState &&
      !canTransition(currentState, targetState)
    ) {
      return NextResponse.json(
        {
          error: `No se puede ${ai_enabled ? "activar" : "desactivar"} la IA desde el estado "${currentState}"`,
        },
        { status: 409 },
      );
    }

    const { data, error: updateError } = await supabase
      .from("conversations")
      .update({
        ai_enabled,
        state: targetState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, ai_enabled, state")
      .single();

    if (updateError) {
      if (updateError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      console.error("[toggle-ai] update error:", updateError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      ai_enabled: data.ai_enabled,
      state: data.state,
    });
  } catch (err) {
    console.error("[toggle-ai] unhandled error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
