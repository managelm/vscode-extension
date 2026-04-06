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
    name: 'answerTask',
    description: 'Answer a question from an interactive task that returned needs_input status. The agent paused because it needs information (domain name, password, config choice). Provide the answer to resume.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID that is in needs_input status' },
        answer: { type: 'string', description: 'Answer to the question asked by the agent' },
      },
      required: ['taskId', 'answer'],
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
  {
    name: 'searchAgents',
    description: 'Search agents by health metrics, OS, status, group, or free text. No commands dispatched.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search' },
        status: { type: 'string', description: 'Filter: online, offline' },
        group: { type: 'string', description: 'Filter by group name' },
        cpu_above: { type: 'number', description: 'CPU usage above %' },
        memory_above: { type: 'number', description: 'Memory usage above %' },
        disk_above: { type: 'number', description: 'Disk usage above %' },
      },
    },
  },
  {
    name: 'searchInventory',
    description: 'Search installed packages, running services, and containers across all servers. Queries stored inventory reports.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search by name, version, or details (e.g. nginx, docker)' },
        category: { type: 'string', description: 'Filter: service, package, container, network, storage' },
        status: { type: 'string', description: 'Filter: running, stopped, installed, info' },
        group: { type: 'string', description: 'Filter by group name' },
      },
    },
  },
  {
    name: 'searchSecurity',
    description: 'Search security findings across all servers. Queries stored audit reports.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search finding titles or explanations' },
        severity: { type: 'string', description: 'Minimum severity: critical, high, medium, low' },
        category: { type: 'string', description: 'Filter: SSH, Firewall, TLS, Users, Ports, etc.' },
        group: { type: 'string', description: 'Filter by group name' },
      },
    },
  },
  {
    name: 'searchSshKeys',
    description: 'Search SSH keys across infrastructure — deployed keys from access scans + registered profile keys.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search by fingerprint or system username' },
        user: { type: 'string', description: 'Filter by ManageLM user name or email' },
        unknown_only: { type: 'string', description: 'Only unknown keys: true/false' },
        group: { type: 'string', description: 'Filter by group name' },
      },
    },
  },
  {
    name: 'searchSudoRules',
    description: 'Search sudo privileges across all servers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search by system username' },
        user: { type: 'string', description: 'Filter by ManageLM user name or email' },
        nopasswd_only: { type: 'string', description: 'Only NOPASSWD rules: true/false' },
        group: { type: 'string', description: 'Filter by group name' },
      },
    },
  },
  {
    name: 'getTaskChanges',
    description: 'View file changes made by a task (files modified in /etc/ and tracked dirs).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        fullDiff: { type: 'boolean', description: 'Fetch full diff from agent (requires online)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'revertTask',
    description: 'Revert file changes from a previous task. Requires agent online.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Task ID to revert' } },
      required: ['taskId'],
    },
  },
  {
    name: 'sendEmail',
    description: 'Send an email report or summary to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'followUpTask',
    description: 'Continue a conversation on a completed task. Loads prior context. Context expires after 5 minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID of the completed task to follow up on' },
        instruction: { type: 'string', description: 'Follow-up message or question' },
      },
      required: ['taskId', 'instruction'],
    },
  },
  {
    name: 'getPentestCredits',
    description: 'Get credit balance for pentests. Check this before starting a pentest.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getPentestCatalog',
    description: 'Get available pentest tests with descriptions and credit costs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'startPentest',
    description: 'Start a pentest on a public agent. Requires credits and verified domains for target URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Server hostname (must be a public agent)' },
        tests: { type: 'string', description: 'Comma-separated test slugs (e.g. nuclei_vuln,testssl_full)' },
        targetUrls: { type: 'string', description: 'Comma-separated target URLs (optional)' },
      },
      required: ['hostname', 'tests'],
    },
  },
  {
    name: 'getPentest',
    description: 'Get pentest status and results for an agent. Returns score, findings, and status.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'getPentestHistory',
    description: 'Get past pentest results for an agent (up to 50).',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname' } },
      required: ['hostname'],
    },
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
      return JSON.stringify({ agents: summary, total: agents.length });
    }
    case 'agentInfo': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      return JSON.stringify({ agent });
    }
    case 'runTask': {
      const agent = await api.findAgentByHostname(input.target as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.target}"` }); }
      if (agent.status !== 'online') { return JSON.stringify({ error: `Agent "${agent.hostname}" is ${agent.status}` }); }
      const result = await api.runTask(agent.id, input.skill as string, input.instruction as string);
      // Interactive task — the agent needs user input before it can continue
      if (result.task.status === 'needs_input') {
        return JSON.stringify({
          task_id: result.task.id, status: 'needs_input',
          question: result.task.question || 'The agent needs more information to continue.',
          message: 'Ask the user this question, then call answerTask with their response.',
        });
      }
      return JSON.stringify({
        task_id: result.task.id, status: result.task.status, summary: result.task.summary,
        error: result.task.error_message, mutating: result.task.mutating, result: result.result,
      });
    }
    case 'answerTask': {
      const result = await api.answerTask(input.taskId as string, input.answer as string);
      if (result.task.status === 'needs_input') {
        return JSON.stringify({
          task_id: result.task.id, status: 'needs_input',
          question: result.task.question || 'The agent needs more information.',
          message: 'Ask the user this question, then call answerTask with their response.',
        });
      }
      return JSON.stringify({
        task_id: result.task.id, status: result.task.status, summary: result.task.summary,
        error: result.task.error_message, result: result.result,
      });
    }
    case 'getTaskStatus': {
      const task = await api.getTask(input.taskId as string);
      return JSON.stringify({ task });
    }
    case 'getTaskHistory': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const tasks = await api.getTaskHistory(agent.id, (input.limit as number) || 20);
      return JSON.stringify({ hostname: agent.hostname, tasks, total: tasks.length });
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
      return JSON.stringify({ skills: skills.map(s => ({ name: s.name, slug: s.slug, description: s.description })) });
    }
    case 'agentSkills': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const skills = await api.getAgentSkills(agent.id);
      return JSON.stringify({ hostname: agent.hostname, skills: skills.map(s => ({ name: s.name, slug: s.slug })) });
    }
    case 'getSecurity': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const result = await api.getSecurity(agent.id);
      if (!result) { return JSON.stringify({ message: 'No security audit run yet. Use runSecurityAudit first.' }); }
      return JSON.stringify({ hostname: agent.hostname, status: result.status, findings: result.findings });
    }
    case 'getInventory': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const result = await api.getInventory(agent.id);
      if (!result) { return JSON.stringify({ message: 'No inventory scan run yet. Use runInventoryScan first.' }); }
      return JSON.stringify({ hostname: agent.hostname, status: result.status, items: result.items });
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
      return JSON.stringify(info);
    }
    case 'searchAgents': {
      const results = await api.searchAgents(input as Record<string, string | number>);
      return JSON.stringify({ agents: results, total: results.length });
    }
    case 'searchInventory': {
      const items = await api.searchInventory(input as Record<string, string>);
      return JSON.stringify({ items, total: items.length });
    }
    case 'searchSecurity': {
      const findings = await api.searchSecurity(input as Record<string, string>);
      return JSON.stringify({ findings, total: findings.length });
    }
    case 'searchSshKeys': {
      const keys = await api.searchSshKeys(input as Record<string, string>);
      return JSON.stringify(keys);
    }
    case 'searchSudoRules': {
      const rules = await api.searchSudoRules(input as Record<string, string>);
      return JSON.stringify({ rules, total: rules.length });
    }
    case 'getTaskChanges': {
      const changeset = await api.getTaskChanges(input.taskId as string, !!input.fullDiff);
      return JSON.stringify(changeset);
    }
    case 'revertTask': {
      const revertResult = await api.revertTask(input.taskId as string);
      return JSON.stringify(revertResult);
    }
    case 'sendEmail': {
      const emailResult = await api.sendEmail(input.subject as string, input.body as string);
      return JSON.stringify(emailResult);
    }
    case 'followUpTask': {
      const followResult = await api.followUpTask(input.taskId as string, input.instruction as string);
      if (followResult.task.status === 'needs_input') {
        return JSON.stringify({
          task_id: followResult.task.id, status: 'needs_input',
          question: followResult.task.question || 'The agent needs more information.',
          message: 'Ask the user this question, then call answerTask with their response.',
        });
      }
      return JSON.stringify({
        task_id: followResult.task.id, status: followResult.task.status, summary: followResult.task.summary,
        error: followResult.task.error_message, result: followResult.result,
      });
    }
    case 'getPentestCredits': {
      const credits = await api.getPentestCredits();
      return JSON.stringify(credits);
    }
    case 'getPentestCatalog': {
      const catalog = await api.getPentestCatalog();
      return JSON.stringify(catalog);
    }
    case 'startPentest': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      if (agent.status !== 'online') { return JSON.stringify({ error: `Agent "${agent.hostname}" is ${agent.status}` }); }
      const tests = (input.tests as string).split(',').map(t => t.trim()).filter(Boolean);
      const targetUrls = input.targetUrls ? (input.targetUrls as string).split(',').map(u => u.trim()).filter(Boolean) : [];
      const pentestResult = await api.startPentest(agent.id, tests, targetUrls);
      return JSON.stringify(pentestResult);
    }
    case 'getPentest': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const pentest = await api.getPentest(agent.id);
      return JSON.stringify({ hostname: agent.hostname, ...pentest });
    }
    case 'getPentestHistory': {
      const agent = await api.findAgentByHostname(input.hostname as string);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${input.hostname}"` }); }
      const history = await api.getPentestHistory(agent.id);
      return JSON.stringify({ hostname: agent.hostname, history });
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
