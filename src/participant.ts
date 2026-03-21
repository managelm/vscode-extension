/**
 * @managelm Copilot Chat participant.
 *
 * Sends the user's prompt along with ManageLM tool definitions to the LM,
 * executes any tool calls, feeds results back, and repeats until the LM
 * produces a final text answer.
 */

import * as vscode from 'vscode';
import * as api from './api.js';

const SYSTEM_PROMPT = `You are ManageLM, a Linux server management assistant integrated into VS Code.
You help users manage their servers through the ManageLM platform using natural language.

IMPORTANT: You MUST always use the provided tools to fulfill requests. Never say you cannot
execute tools or suggest the user do it manually. Always call tools, never just describe.

Common skills for runTask:
base, system, packages, services, users, network, security, files,
firewall, docker, apache, nginx, mysql, postgresql, backup, certificates, git.

When the user asks about a server:
1. If you don't know which server, call listAgents first
2. Call the appropriate tool to get the information or run the task
3. Present results clearly in markdown

Be concise and helpful.`;

/** Maximum tool-calling iterations to prevent infinite loops. */
const MAX_ITERATIONS = 10;

// ─── Tool definitions passed to the LM ──────────────────────────────

const TOOL_DEFS: vscode.LanguageModelChatTool[] = [
  {
    name: 'listAgents',
    description: 'List all ManageLM agents (servers) with status, health, OS, IP.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agentInfo',
    description: 'Get detailed info about a server by hostname or display name.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname or display name' } },
      required: ['hostname'],
    },
  },
  {
    name: 'runTask',
    description: 'Run a task on a server using a skill. Skills: base, system, packages, services, users, network, security, files, firewall, docker, apache, nginx, mysql, postgresql, backup, certificates, git.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Server hostname, group name, or "all"' },
        skill: { type: 'string', description: 'Skill slug (e.g. users, packages, services)' },
        instruction: { type: 'string', description: 'Natural language instruction' },
      },
      required: ['target', 'skill', 'instruction'],
    },
  },
  {
    name: 'getTaskStatus',
    description: 'Get status and result of a task by its ID.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Task ID' } },
      required: ['taskId'],
    },
  },
  {
    name: 'getTaskHistory',
    description: 'Get recent task history for a server.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Server hostname' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['hostname'],
    },
  },
  {
    name: 'approveAgent',
    description: 'Approve a pending agent enrollment.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname to approve' } },
      required: ['hostname'],
    },
  },
  {
    name: 'listSkills',
    description: 'List all skills available in the ManageLM account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agentSkills',
    description: 'List skills assigned to a specific server.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'getSecurity',
    description: 'Get security audit findings for a server.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'getInventory',
    description: 'Get system inventory (packages, services, containers) for a server.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'runSecurityAudit',
    description: 'Start a security audit on a server.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'runInventoryScan',
    description: 'Start an inventory scan on a server.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'accountInfo',
    description: 'Get ManageLM account information (plan, members, usage).',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Tool executor — calls API directly ─────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'listAgents': {
      const agents = await api.listAgents();
      const summary = agents.map(a => ({
        hostname: a.hostname, display_name: a.display_name, status: a.status,
        ip_address: a.ip_address, os: a.os_info, health: a.health_metrics,
      }));
      return JSON.stringify({ agents: summary, total: agents.length }, null, 2);
    }
    case 'agentInfo': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      return JSON.stringify({ agent }, null, 2);
    }
    case 'runTask': {
      const agent = await api.findAgentByHostname(input.target as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.target}"` }); }
      if (agent.status !== 'online') { return JSON.stringify({ error: `Agent "${agent.hostname}" is ${agent.status}` }); }
      const result = await api.runTask(agent.id, input.skill as string, input.instruction as string);
      return JSON.stringify({
        task_id: result.task.id, status: result.task.status, summary: result.task.summary,
        error: result.task.error_message, mutating: result.task.mutating, result: result.result,
      }, null, 2);
    }
    case 'getTaskStatus': {
      const task = await api.getTask(input.taskId as string);
      return JSON.stringify({ task }, null, 2);
    }
    case 'getTaskHistory': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const tasks = await api.getTaskHistory(agent.id, (input.limit as number) || 20);
      return JSON.stringify({ hostname: agent.hostname, tasks, total: tasks.length }, null, 2);
    }
    case 'approveAgent': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      if (agent.status !== 'pending') { return JSON.stringify({ message: `Agent already ${agent.status}` }); }
      await api.approveAgent(agent.id);
      return JSON.stringify({ message: `Agent "${agent.hostname}" approved` });
    }
    case 'listSkills': {
      const skills = await api.listSkills();
      return JSON.stringify({ skills: skills.map(s => ({ name: s.name, slug: s.slug, description: s.description })) }, null, 2);
    }
    case 'agentSkills': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const skills = await api.getAgentSkills(agent.id);
      return JSON.stringify({ hostname: agent.hostname, skills: skills.map(s => ({ name: s.name, slug: s.slug })) }, null, 2);
    }
    case 'getSecurity': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const result = await api.getSecurity(agent.id);
      if (!result) { return JSON.stringify({ message: 'No security audit run yet. Use runSecurityAudit first.' }); }
      return JSON.stringify({ hostname: agent.hostname, status: result.status, findings: result.findings }, null, 2);
    }
    case 'getInventory': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const result = await api.getInventory(agent.id);
      if (!result) { return JSON.stringify({ message: 'No inventory scan run yet. Use runInventoryScan first.' }); }
      return JSON.stringify({ hostname: agent.hostname, status: result.status, items: result.items }, null, 2);
    }
    case 'runSecurityAudit': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      await api.runSecurityAudit(agent.id);
      return JSON.stringify({ message: `Security audit started on "${agent.hostname}"` });
    }
    case 'runInventoryScan': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      await api.runInventoryScan(agent.id);
      return JSON.stringify({ message: `Inventory scan started on "${agent.hostname}"` });
    }
    case 'accountInfo': {
      const info = await api.getAccountInfo();
      return JSON.stringify(info, null, 2);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
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
      if (text) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }
  }

  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

  // ── Agentic tool-calling loop ──────────────────────────────────────
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
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

  return {};
}
