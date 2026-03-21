/**
 * @managelm Copilot Chat participant.
 *
 * Registers a chat participant that provides a conversational server
 * management experience. The participant runs an agentic tool-calling
 * loop: it sends the user's message to the LM together with ManageLM
 * tool definitions, executes any tool calls the LM makes, feeds results
 * back, and repeats until the LM produces a final text answer.
 */

import * as vscode from 'vscode';

const SYSTEM_PROMPT = `You are ManageLM, a Linux server management assistant integrated into VS Code.
You help users manage their servers through the ManageLM platform using natural language.

IMPORTANT: You MUST always use the provided tools to fulfill requests. Never say you cannot
execute tools or suggest the user do it manually. You have full access to all ManageLM tools
and they will execute when you call them.

Available tools:
- managelm_listAgents — list all servers with status and health
- managelm_agentInfo — detailed info for a specific server
- managelm_runTask — run a task on a server (requires target, skill, instruction)
- managelm_getTaskStatus — check status of a task by ID
- managelm_getTaskHistory — recent tasks for a server
- managelm_getSecurity — security audit findings for a server
- managelm_getInventory — system inventory for a server
- managelm_runSecurityAudit — start a security audit
- managelm_runInventoryScan — start an inventory scan
- managelm_approveAgent — approve a pending agent
- managelm_listSkills — list available skills
- managelm_agentSkills — skills assigned to a server
- managelm_accountInfo — account plan and usage

Common skills for managelm_runTask:
base, system, packages, services, users, network, security, files,
firewall, docker, apache, nginx, mysql, postgresql, backup, certificates, git.

When the user asks about a server:
1. If you don't know which server, call managelm_listAgents first
2. Call the appropriate tool to get the information or run the task
3. Present results clearly with relevant details

Always call tools. Never describe what you would do — just do it.
Be concise and helpful. Format output in readable markdown.`;

/** Maximum tool-calling iterations to prevent infinite loops. */
const MAX_ITERATIONS = 10;

/**
 * Register the @managelm chat participant.
 */
export function registerParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('managelm.chat', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
  context.subscriptions.push(participant);
}

// ─── Handler ─────────────────────────────────────────────────────────

async function handler(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  // Collect ManageLM tools available to the LM
  const chatTools: vscode.LanguageModelChatTool[] = vscode.lm.tools
    .filter(t => t.name.startsWith('managelm_'))
    .map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));

  // Build conversation messages
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
  ];

  // Replay history so the LM has conversational context
  for (const turn of context.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
        .map(r => r.value.value)
        .join('');
      if (text) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }
  }

  // Add the current user prompt
  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

  // ── Agentic tool-calling loop ──────────────────────────────────────
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await request.model.sendRequest(
        messages,
        { tools: chatTools },
        token,
      );

      // Collect all streamed parts
      const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];

      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          stream.markdown(part.value);
          parts.push(part);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          parts.push(part);
        }
      }

      // Extract tool calls from the response
      const toolCalls = parts.filter(
        (p): p is vscode.LanguageModelToolCallPart =>
          p instanceof vscode.LanguageModelToolCallPart,
      );

      // No tool calls means the LM produced a final answer — we're done
      if (toolCalls.length === 0) {
        break;
      }

      // Record the assistant message (text + tool calls) for context
      const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] =
        parts.map(p => {
          if (p instanceof vscode.LanguageModelTextPart) {
            return p;
          }
          return new vscode.LanguageModelToolCallPart(p.callId, p.name, p.input);
        });
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

      // Execute each tool call and feed results back
      for (const call of toolCalls) {
        let resultContent: (vscode.LanguageModelTextPart | vscode.LanguageModelPromptTsxPart)[];

        try {
          const result = await vscode.lm.invokeTool(
            call.name,
            {
              input: call.input,
              toolInvocationToken: request.toolInvocationToken,
            },
            token,
          );
          resultContent = result.content as (vscode.LanguageModelTextPart | vscode.LanguageModelPromptTsxPart)[];
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Tool call failed';
          resultContent = [new vscode.LanguageModelTextPart(`Error: ${errMsg}`)];
        }

        // Add tool result as a user message so the LM can process it
        messages.push(
          vscode.LanguageModelChatMessage.User([
            new vscode.LanguageModelToolResultPart(call.callId, resultContent),
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

  return {};
}
