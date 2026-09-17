/**
 * @managelm Copilot Chat participant.
 *
 * Sends the user's prompt along with ManageLM tool definitions to the LM,
 * executes any tool calls via the executor, feeds results back, and repeats
 * until the LM produces a final text answer.
 */

import * as vscode from 'vscode';
import { TOOL_DEFS } from './tools.js';
import { executeTool } from './executor.js';

const SYSTEM_PROMPT = `You are ManageLM, a server management assistant for Linux and Windows integrated into VS Code.
You help users manage their servers through the ManageLM platform using natural language.

IMPORTANT: You MUST always use the provided tools to fulfill requests. Never say you cannot
execute tools or suggest the user do it manually. Always call tools, never just describe.

When the user asks about a server:
1. If you don't know which server, call search_agents first
2. For questions about the fleet (what runs where, security issues, logins, certificates,
   monitors, backups, credentials), prefer the search_* tools: they read stored data and
   run nothing on the servers
3. To change or inspect something live, call run_task; pick the skill with get_agent_skills,
   or use "auto" to let the agent choose
4. When a task returns needs_input, ask the user the question and call answer_task
5. Disruptive hosting actions and task reverts change production systems: confirm with the user first
6. Present results clearly in markdown

Tasks and scans run on one server at a time. Approving agents, users, API keys and webhooks
are managed in the ManageLM portal.

Be concise and helpful.`;

/** Maximum tool-calling iterations to prevent infinite loops. */
const MAX_ITERATIONS = 10;

/**
 * A task the next turn may need to act on: one still running, or waiting for
 * the user's answer. Chat history only replays the text of earlier replies, not
 * tool results, so without this the task ID survived only if the model happened
 * to print it — and "answer it" or "is it done?" had nothing to act on.
 */
interface OpenTask { task_id: string; status: string }

/** Tasks a tool result left open (running or needs_input). */
function openTaskIn(resultText: string): OpenTask | null {
  try {
    const r = JSON.parse(resultText);
    return r.task_id && (r.status === 'running' || r.status === 'needs_input')
      ? { task_id: String(r.task_id), status: r.status }
      : null;
  } catch {
    return null;
  }
}

// ─── Participant ────────────────────────────────────────────────────

export function registerParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('managelm.chat', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
  context.subscriptions.push(participant);
}

async function handler(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  // Build conversation messages
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
  ];

  // Replay history
  for (const turn of context.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
        .map(r => r.value.value)
        .join('');
      const open = (turn.result.metadata?.openTasks ?? []) as OpenTask[];
      const note = open.map(t => `[task ${t.task_id} was ${t.status === 'running' ? 'still running' : 'waiting for input'}]`).join('\n');
      const replayed = [text, note].filter(Boolean).join('\n\n');
      if (replayed) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(replayed));
      }
    }
  }
  const openTasks = new Map<string, OpenTask>();

  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

  // ── Agentic tool-calling loop ──────────────────────────────────────
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (token.isCancellationRequested) { break; }

      const response = await request.model.sendRequest(
        messages,
        { tools: TOOL_DEFS },
        token,
      );

      // Collect streamed parts
      const textParts: string[] = [];
      const toolCalls: vscode.LanguageModelToolCallPart[] = [];

      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push(part);
        }
      }

      const fullText = textParts.join('');

      // No tool calls — stream text as final answer
      if (toolCalls.length === 0) {
        stream.markdown(fullText);
        break;
      }

      // Warn if this is the last iteration
      if (i === MAX_ITERATIONS - 1) {
        stream.markdown(fullText || '');
        stream.markdown('\n\n*Stopped: maximum tool call iterations reached.*');
        break;
      }

      // Record assistant message with tool calls for context
      const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
      if (fullText) {
        assistantParts.push(new vscode.LanguageModelTextPart(fullText));
      }
      for (const call of toolCalls) {
        assistantParts.push(new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input));
      }
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

      // Execute tool calls and feed results back
      for (const call of toolCalls) {
        let resultText: string;
        try {
          resultText = await executeTool(call.name, call.input as Record<string, unknown>);
        } catch (err: unknown) {
          resultText = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool call failed' });
        }
        // Latest state wins: a task answered in this turn is no longer open.
        const open = openTaskIn(resultText);
        const taskId = (call.input as Record<string, unknown>).task_id;
        if (typeof taskId === 'string') { openTasks.delete(taskId); }
        if (open) { openTasks.set(open.task_id, open); }

        messages.push(
          vscode.LanguageModelChatMessage.User([
            new vscode.LanguageModelToolResultPart(call.callId, [
              new vscode.LanguageModelTextPart(resultText),
            ]),
          ]),
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Error:** ${err.message}`);
    } else {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      stream.markdown(`**Error:** ${msg}`);
    }
  }

  return { metadata: { openTasks: [...openTasks.values()] } };
}
