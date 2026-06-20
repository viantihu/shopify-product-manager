// app/agent/anthropic-client.server.ts
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { ModelTurn } from "./loop";

const client = new Anthropic();

// Adapts Anthropic's Messages API to the loop's ModelTurn shape.
export async function complete(messages: unknown[]): Promise<ModelTurn> {
  const res = await client.messages.create({
    model: process.env.LLM_MODEL ?? "claude-opus-4-8",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: TOOLS as never,
    messages: messages as never,
  });
  const toolCalls = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  return { stop_reason: res.stop_reason ?? "end_turn", toolCalls };
}
