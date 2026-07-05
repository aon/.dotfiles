import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

import originalTodoExtension from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/index.ts";
import { loadConfig, validateGuidanceFields } from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/config.ts";
import {
  DEFAULT_PROMPT_GUIDELINES,
  DEFAULT_PROMPT_SNIPPET,
} from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/todo.ts";
import { applyTaskMutation } from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/state/state-reducer.ts";
import { commitState, getState } from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/state/store.ts";
import { buildToolResult } from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/tool/response-envelope.ts";
import {
  TOOL_LABEL,
  TOOL_NAME,
  TodoParamsSchema,
  type TaskMutationParams,
} from "/Users/agustin/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/tool/types.ts";

// Use the original rpiv-todo extension for everything (overlay, /todos command,
// session replay, in-progress rendering, hide-completed behavior). The only
// customization here is re-registering the same `todo` tool with empty
// transcript renderers after the original tool is registered.

function hidden(): Container {
  return new Container();
}

function registerHiddenTodoTool(pi: ExtensionAPI): void {
  const guidance = validateGuidanceFields(loadConfig().guidance);

  pi.registerTool({
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description:
      "Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
    promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
    promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
    parameters: TodoParamsSchema,
    renderShell: "self" as const,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = applyTaskMutation(getState(), params.action, params as TaskMutationParams);
      commitState(result.state);
      return buildToolResult(params.action, params as TaskMutationParams, result.state, result.op);
    },

    renderCall: hidden,
    renderResult: hidden,
  });
}

export default function compactTodoExtension(pi: ExtensionAPI) {
  originalTodoExtension(pi);
  registerHiddenTodoTool(pi);
}
