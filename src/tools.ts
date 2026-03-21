/**
 * Language Model tool implementations for ManageLM.
 *
 * Each tool is registered with vscode.lm.registerTool() and becomes available
 * to Copilot Chat. The @managelm chat participant uses these tools via the
 * agentic tool-calling loop in participant.ts.
 *
 * Read-only tools: listAgents, agentInfo, getTaskStatus, getTaskHistory,
 *                  listSkills, agentSkills, getSecurity, getInventory, accountInfo
 * Action tools:    runTask, approveAgent, runSecurityAudit, runInventoryScan
 */

import * as vscode from 'vscode';
import * as api from './api.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Wrap any value as a LanguageModelToolResult with JSON text. */
function textResult(data: unknown): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(
      typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    ),
  ]);
}

/** Resolve a hostname/display_name to an Agent, or throw a helpful error. */
async function resolveAgent(hostname: string): Promise<api.Agent> {
  const agent = await api.findAgentByHostname(hostname);
  if (!agent) {
    throw new Error(
      `No agent found matching "${hostname}". ` +
      'Use managelm_listAgents to see available servers.',
    );
  }
  return agent;
}

// ─── List Agents ─────────────────────────────────────────────────────

export class ListAgentsTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agents = await api.listAgents();
    const summary = agents.map(a => ({
      hostname: a.hostname,
      display_name: a.display_name,
      status: a.status,
      ip_address: a.ip_address,
      os: a.os_info,
      health: a.health_metrics,
      last_seen: a.last_seen_at,
    }));
    return textResult({ agents: summary, total: agents.length });
  }
}

// ─── Agent Info ──────────────────────────────────────────────────────

interface AgentInfoInput {
  hostname: string;
}

export class AgentInfoTool implements vscode.LanguageModelTool<AgentInfoInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AgentInfoInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    return textResult({ agent });
  }
}

// ─── Run Task ────────────────────────────────────────────────────────

interface RunTaskInput {
  target: string;
  skill: string;
  instruction: string;
}

export class RunTaskTool implements vscode.LanguageModelTool<RunTaskInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunTaskInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const { target, skill, instruction } = options.input;
    return {
      invocationMessage: `Running "${instruction}" with skill **${skill}** on **${target}**`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunTaskInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { target, skill, instruction } = options.input;
    const agent = await resolveAgent(target);

    if (agent.status !== 'online') {
      throw new Error(
        `Agent "${agent.hostname}" is ${agent.status}. It must be online to run tasks.`,
      );
    }

    const result = await api.runTask(agent.id, skill, instruction);
    return textResult({
      task_id: result.task.id,
      status: result.task.status,
      summary: result.task.summary,
      error: result.task.error_message,
      mutating: result.task.mutating,
      result: result.result,
    });
  }
}

// ─── Get Task Status ─────────────────────────────────────────────────

interface TaskStatusInput {
  taskId: string;
}

export class GetTaskStatusTool implements vscode.LanguageModelTool<TaskStatusInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TaskStatusInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const task = await api.getTask(options.input.taskId);
    return textResult({ task });
  }
}

// ─── Get Task History ────────────────────────────────────────────────

interface TaskHistoryInput {
  hostname: string;
  limit?: number;
}

export class GetTaskHistoryTool implements vscode.LanguageModelTool<TaskHistoryInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TaskHistoryInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    const tasks = await api.getTaskHistory(agent.id, options.input.limit);
    return textResult({ hostname: agent.hostname, tasks, total: tasks.length });
  }
}

// ─── Approve Agent ───────────────────────────────────────────────────

interface ApproveInput {
  hostname: string;
}

export class ApproveAgentTool implements vscode.LanguageModelTool<ApproveInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ApproveInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Approving agent **${options.input.hostname}**`,
      confirmationMessages: {
        title: 'Approve Agent',
        message: new vscode.MarkdownString(
          `Approve agent **${options.input.hostname}** to join your ManageLM account?`,
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ApproveInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    if (agent.status !== 'pending') {
      return textResult({ message: `Agent "${agent.hostname}" is already ${agent.status}.` });
    }
    await api.approveAgent(agent.id);
    return textResult({ message: `Agent "${agent.hostname}" has been approved.` });
  }
}

// ─── List Skills ─────────────────────────────────────────────────────

export class ListSkillsTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const skills = await api.listSkills();
    return textResult({
      skills: skills.map(s => ({ name: s.name, slug: s.slug, description: s.description })),
    });
  }
}

// ─── Agent Skills ────────────────────────────────────────────────────

interface AgentSkillsInput {
  hostname: string;
}

export class AgentSkillsTool implements vscode.LanguageModelTool<AgentSkillsInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AgentSkillsInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    const skills = await api.getAgentSkills(agent.id);
    return textResult({
      hostname: agent.hostname,
      skills: skills.map(s => ({ name: s.name, slug: s.slug, description: s.description })),
    });
  }
}

// ─── Security Findings ──────────────────────────────────────────────

interface SecurityInput {
  hostname: string;
}

export class GetSecurityTool implements vscode.LanguageModelTool<SecurityInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SecurityInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    const result = await api.getSecurity(agent.id);
    if (!result) {
      return textResult({ hostname: agent.hostname, message: 'No security audit has been run on this server yet. Use managelm_runSecurityAudit to start one.' });
    }
    return textResult({ hostname: agent.hostname, audit_status: result.status, findings: result.findings, total: result.findings.length });
  }
}

// ─── Inventory ──────────────────────────────────────────────────────

interface InventoryInput {
  hostname: string;
}

export class GetInventoryTool implements vscode.LanguageModelTool<InventoryInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<InventoryInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    const result = await api.getInventory(agent.id);
    if (!result) {
      return textResult({ hostname: agent.hostname, message: 'No inventory scan has been run on this server yet. Use managelm_runInventoryScan to start one.' });
    }
    return textResult({ hostname: agent.hostname, scan_status: result.status, items: result.items, total: result.items.length });
  }
}

// ─── Run Security Audit ─────────────────────────────────────────────

export class RunSecurityAuditTool implements vscode.LanguageModelTool<SecurityInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SecurityInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Starting security audit on **${options.input.hostname}**`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SecurityInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    await api.runSecurityAudit(agent.id);
    return textResult({
      message: `Security audit started on "${agent.hostname}". Use managelm_getSecurity to check results.`,
    });
  }
}

// ─── Run Inventory Scan ─────────────────────────────────────────────

export class RunInventoryScanTool implements vscode.LanguageModelTool<InventoryInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<InventoryInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Starting inventory scan on **${options.input.hostname}**`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<InventoryInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const agent = await resolveAgent(options.input.hostname);
    await api.runInventoryScan(agent.id);
    return textResult({
      message: `Inventory scan started on "${agent.hostname}". Use managelm_getInventory to check results.`,
    });
  }
}

// ─── Account Info ───────────────────────────────────────────────────

export class AccountInfoTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const info = await api.getAccountInfo();
    return textResult(info);
  }
}
