/**
 * Tool executor — dispatches tool calls from the LM to the ManageLM API.
 *
 * Each case validates input, calls the appropriate API method, and returns
 * a JSON string for the LM to interpret.
 */

import * as api from './api.js';

/** Safely extract a string parameter from LM input. */
function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  return val != null ? String(val) : '';
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    // ── Agents ──────────────────────────────────────────────────────
    case 'listAgents': {
      const agents = await api.listAgents();
      const summary = agents.map(a => ({
        hostname: a.hostname, display_name: a.display_name, status: a.status,
        ip_address: a.ip_address, os: a.os_info, health: a.health_metrics,
      }));
      return JSON.stringify({ agents: summary, total: agents.length });
    }
    case 'agentInfo': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname parameter is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      return JSON.stringify({ agent });
    }
    case 'approveAgent': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      if (agent.status !== 'pending') { return JSON.stringify({ message: `Agent already ${agent.status}` }); }
      await api.approveAgent(agent.id);
      return JSON.stringify({ message: `Agent "${agent.hostname}" approved` });
    }
    case 'agentSkills': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      const skills = await api.getAgentSkills(agent.id);
      return JSON.stringify({ hostname: agent.hostname, skills: skills.map(s => ({ name: s.name, slug: s.slug })) });
    }

    // ── Tasks ───────────────────────────────────────────────────────
    case 'runTask': {
      const target = str(input, 'target');
      const skill = str(input, 'skill');
      const instruction = str(input, 'instruction');
      if (!target || !skill || !instruction) { return JSON.stringify({ error: 'target, skill, and instruction are required' }); }
      const agent = await api.findAgentByHostname(target);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${target}"` }); }
      if (agent.status !== 'online') { return JSON.stringify({ error: `Agent "${agent.hostname}" is ${agent.status}` }); }
      const result = await api.runTask(agent.id, skill, instruction);
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
      const taskId = str(input, 'taskId');
      const answer = str(input, 'answer');
      if (!taskId || !answer) { return JSON.stringify({ error: 'taskId and answer are required' }); }
      const result = await api.answerTask(taskId, answer);
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
    case 'followUpTask': {
      const taskId = str(input, 'taskId');
      const instruction = str(input, 'instruction');
      if (!taskId || !instruction) { return JSON.stringify({ error: 'taskId and instruction are required' }); }
      const followResult = await api.followUpTask(taskId, instruction);
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
    case 'getTaskStatus': {
      const taskId = str(input, 'taskId');
      if (!taskId) { return JSON.stringify({ error: 'taskId is required' }); }
      const task = await api.getTask(taskId);
      return JSON.stringify({ task });
    }
    case 'getTaskHistory': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      const tasks = await api.getTaskHistory(agent.id, (input.limit as number) || 20);
      return JSON.stringify({ hostname: agent.hostname, tasks, total: tasks.length });
    }
    case 'getTaskChanges': {
      const taskId = str(input, 'taskId');
      if (!taskId) { return JSON.stringify({ error: 'taskId is required' }); }
      const changeset = await api.getTaskChanges(taskId, !!input.fullDiff);
      return JSON.stringify(changeset);
    }
    case 'revertTask': {
      const taskId = str(input, 'taskId');
      if (!taskId) { return JSON.stringify({ error: 'taskId is required' }); }
      const revertResult = await api.revertTask(taskId);
      return JSON.stringify(revertResult);
    }

    // ── Skills ──────────────────────────────────────────────────────
    case 'listSkills': {
      const skills = await api.listSkills();
      return JSON.stringify({ skills: skills.map(s => ({ name: s.name, slug: s.slug, description: s.description })) });
    }

    // ── Security & Inventory ────────────────────────────────────────
    case 'getSecurity': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      const result = await api.getSecurity(agent.id);
      if (!result) { return JSON.stringify({ message: 'No security audit run yet. Use runSecurityAudit first.' }); }
      return JSON.stringify({ hostname: agent.hostname, status: result.status, findings: result.findings });
    }
    case 'getInventory': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      const result = await api.getInventory(agent.id);
      if (!result) { return JSON.stringify({ message: 'No inventory scan run yet. Use runInventoryScan first.' }); }
      return JSON.stringify({ hostname: agent.hostname, status: result.status, items: result.items });
    }
    case 'runSecurityAudit': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      await api.runSecurityAudit(agent.id);
      return JSON.stringify({ message: `Security audit started on "${agent.hostname}"` });
    }
    case 'runInventoryScan': {
      const hostname = str(input, 'hostname');
      if (!hostname) { return JSON.stringify({ error: 'hostname is required' }); }
      const agent = await api.findAgentByHostname(hostname);
      if (!agent) { return JSON.stringify({ error: `No agent found matching "${hostname}"` }); }
      await api.runInventoryScan(agent.id);
      return JSON.stringify({ message: `Inventory scan started on "${agent.hostname}"` });
    }

    // ── Search ──────────────────────────────────────────────────────
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

    // ── Account & Email ─────────────────────────────────────────────
    case 'accountInfo': {
      const info = await api.getAccountInfo();
      return JSON.stringify(info);
    }
    case 'sendEmail': {
      const subject = str(input, 'subject');
      const body = str(input, 'body');
      if (!subject || !body) { return JSON.stringify({ error: 'subject and body are required' }); }
      const emailResult = await api.sendEmail(subject, body);
      return JSON.stringify(emailResult);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
