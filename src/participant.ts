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

You have access to ManageLM tools to:
- List and inspect servers (agents) — use managelm_listAgents and managelm_agentInfo
- Run tasks on servers using skills — use managelm_runTask with a target, skill, and instruction
- Check task status and history — use managelm_getTaskStatus and managelm_getTaskHistory
- View security audit findings — use managelm_getSecurity
- View system inventory — use managelm_getInventory
- Start security audits and inventory scans — use managelm_runSecurityAudit and managelm_runInventoryScan
- Approve new agents — use managelm_approveAgent
- List available skills — use managelm_listSkills and managelm_agentSkills
- Check account details — use managelm_accountInfo

Common skills for managelm_runTask:
base, system, packages, services, users, network, security, files,
firewall, docker, apache, nginx, mysql, postgresql, backup, certificates, git.

When the user asks about a server:
1. If you don't know which server, list agents first
2. Use the appropriate tool to get the information or run the task
3. Present results clearly with relevant details

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
