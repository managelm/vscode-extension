/**
 * ManageLM portal REST API client.
 *
 * All calls use the portal URL and API key from VS Code settings.
 * Mirrors the same endpoints used by the Slack and n8n plugins.
 */

import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  hostname: string;
  display_name: string | null;
  status: 'online' | 'offline' | 'pending';
  health_metrics: Record<string, unknown> | null;
  tags: string[] | null;
  llm_model: string | null;
  agent_version: string | null;
  os_info: Record<string, unknown> | null;
  ip_address: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  agent_id: string;
  skill_slug: string;
  operation: string;
  status: 'sent' | 'running' | 'completed' | 'failed' | 'timeout' | 'needs_input' | 'answered';
  error_message: string | null;
  summary: string | null;
  question: string | null;
  mutating: boolean;
  created_at: string;
  completed_at: string | null;
  response_payload: string | null;
}

export interface TaskSubmitResult {
  task: Task;
  result: unknown;
}

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
}

export interface SecurityFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'pass';
  category: string;
  title: string;
  explanation: string;
  remediation: string;
}

export interface InventoryItem {
  id: string;
  category: string;
  name: string;
  status: 'running' | 'stopped' | 'installed' | 'info';
  version: string;
  details: string;
}

// ─── HTTP helpers ────────────────────────────────────────────────────

/** Default timeout for API requests (30s). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Extended timeout for synchronous task execution (wait=true). */
const TASK_TIMEOUT_MS = 120_000;

class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function getConfig(): { portalUrl: string; apiKey: string } {
  const config = vscode.workspace.getConfiguration('managelm');
  const portalUrl = (config.get<string>('portalUrl') || 'https://app.managelm.com').replace(/\/+$/, '');
  const apiKey = config.get<string>('apiKey') || '';
  return { portalUrl, apiKey };
}

async function api<T = unknown>(
  method: string,
  endpoint: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const { portalUrl, apiKey } = getConfig();

  if (!apiKey) {
    throw new Error(
      'ManageLM API key not configured. Set it in Settings > ManageLM > Api Key.',
    );
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Abort on timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = { method, headers, signal: controller.signal };
  if (body && method !== 'GET' && method !== 'DELETE') {
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${portalUrl}/api${endpoint}`, init);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status} — portal returned non-JSON response`);
    }
    throw new ApiError(res.status, 'Unexpected non-JSON response from portal');
  }

  const json = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new ApiError(res.status, (json.error as string) || `HTTP ${res.status}`);
  }

  return json as T;
}

// ─── Agents ──────────────────────────────────────────────────────────

/** List all agents visible to the API key. */
export async function listAgents(): Promise<Agent[]> {
  const data = await api<{ agents: Agent[] }>('GET', '/agents');
  return data.agents;
}

/** Get a single agent by ID. */
export async function getAgent(agentId: string): Promise<Agent> {
  const data = await api<{ agent: Agent }>('GET', `/agents/${encodeURIComponent(agentId)}`);
  return data.agent;
}

/** Find an agent by hostname or display name (partial, case-insensitive). */
export async function findAgentByHostname(hostname: string): Promise<Agent | null> {
  const agents = await listAgents();
  const lower = hostname.toLowerCase();
  // Exact match first, then partial
  return (
    agents.find(a =>
      a.hostname.toLowerCase() === lower ||
      (a.display_name && a.display_name.toLowerCase() === lower),
    ) ||
    agents.find(a =>
      a.hostname.toLowerCase().includes(lower) ||
      (a.display_name && a.display_name.toLowerCase().includes(lower)),
    ) ||
    null
  );
}

/** Approve a pending agent. */
export async function approveAgent(agentId: string): Promise<void> {
  await api('POST', `/agents/${encodeURIComponent(agentId)}/approve`);
}

/** List skills assigned to an agent. */
export async function getAgentSkills(agentId: string): Promise<Skill[]> {
  const data = await api<{ skills: Skill[] }>('GET', `/agents/${encodeURIComponent(agentId)}/skills`);
  return data.skills;
}

// ─── Tasks ───────────────────────────────────────────────────────────

/** Submit a task and wait for the result (synchronous mode, 120s timeout). */
export async function runTask(agentId: string, skillSlug: string, instruction: string): Promise<TaskSubmitResult> {
  return api<TaskSubmitResult>('POST', '/tasks?wait=true', {
    agent_id: agentId,
    skill_slug: skillSlug,
    instruction,
  }, TASK_TIMEOUT_MS);
}

/** Get task status by ID. */
export async function getTask(taskId: string): Promise<Task> {
  const data = await api<{ task: Task }>('GET', `/tasks/${encodeURIComponent(taskId)}`);
  return data.task;
}

/** Answer a question from an interactive task (needs_input status). */
export async function answerTask(taskId: string, answer: string): Promise<TaskSubmitResult> {
  return api<TaskSubmitResult>('POST', `/tasks/${encodeURIComponent(taskId)}/answer?wait=true`, {
    answer,
  }, TASK_TIMEOUT_MS);
}

/** Get recent tasks for an agent. */
export async function getTaskHistory(agentId: string, limit = 20): Promise<Task[]> {
  const data = await api<{ tasks: Task[] }>(
    'GET',
    `/tasks?agent_id=${encodeURIComponent(agentId)}&limit=${limit}`,
  );
  return data.tasks;
}

// ─── Skills ──────────────────────────────────────────────────────────

/** List all skills in the account. */
export async function listSkills(): Promise<Skill[]> {
  const data = await api<{ skills: Skill[] }>('GET', '/skills');
  return data.skills;
}

// ─── Security ────────────────────────────────────────────────────────

interface AuditResponse {
  audit: {
    status: string;
    report: SecurityFinding[];
    started_at: string;
    completed_at: string | null;
  } | null;
}

/** Get security audit findings for an agent. */
export async function getSecurity(agentId: string): Promise<{ status: string; findings: SecurityFinding[] } | null> {
  const data = await api<AuditResponse>('GET', `/security/${encodeURIComponent(agentId)}`);
  if (!data.audit) {
    return null;
  }
  return { status: data.audit.status, findings: data.audit.report };
}

/** Start a security audit on an agent. */
export async function runSecurityAudit(agentId: string): Promise<void> {
  await api('POST', `/security/${encodeURIComponent(agentId)}`);
}

// ─── Inventory ───────────────────────────────────────────────────────

interface InventoryResponse {
  inventory: {
    id: string;
    status: string;
    report: InventoryItem[];
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
  } | null;
}

/** Get inventory items for an agent. */
export async function getInventory(agentId: string): Promise<{ status: string; items: InventoryItem[] } | null> {
  const data = await api<InventoryResponse>('GET', `/inventory/${encodeURIComponent(agentId)}`);
  if (!data.inventory) {
    return null;
  }
  return { status: data.inventory.status, items: data.inventory.report };
}

/** Start an inventory scan on an agent. */
export async function runInventoryScan(agentId: string): Promise<void> {
  await api('POST', `/inventory/${encodeURIComponent(agentId)}`);
}

// ─── Search ──────────────────────────────────────────────────────────

/** Search agents by health, OS, status, group, or free text. */
export async function searchAgents(params: Record<string, string | number>): Promise<any[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v !== undefined && v !== '') qs.set(k, String(v)); }
  const data = await api<{ agents: any[] }>('GET', `/search/agents?${qs}`);
  return data.agents;
}

/** Search inventory items across all agents. */
export async function searchInventory(params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  const data = await api<{ items: any[] }>('GET', `/search/inventory?${qs}`);
  return data.items;
}

/** Search security findings across all agents. */
export async function searchSecurity(params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  const data = await api<{ findings: any[] }>('GET', `/search/security?${qs}`);
  return data.findings;
}

/** Search SSH keys across infrastructure. */
export async function searchSshKeys(params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  return api('GET', `/search/ssh-keys?${qs}`);
}

/** Search sudo rules across infrastructure. */
export async function searchSudoRules(params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  const data = await api<{ rules: any[] }>('GET', `/search/sudo-rules?${qs}`);
  return data.rules;
}

// ─── Task Changes ────────────────────────────────────────────────────

/** Get file changes made by a task. */
export async function getTaskChanges(taskId: string, fullDiff = false): Promise<Record<string, unknown>> {
  const qs = fullDiff ? '?full_diff=true' : '';
  const data = await api<{ changeset: Record<string, unknown> }>('GET', `/tasks/${encodeURIComponent(taskId)}/changes${qs}`);
  return data.changeset;
}

/** Revert file changes from a task. */
export async function revertTask(taskId: string): Promise<Record<string, unknown>> {
  return api('POST', `/tasks/${encodeURIComponent(taskId)}/revert`);
}

// ─── Email ───────────────────────────────────────────────────────────

/** Send an email to the authenticated user. */
export async function sendEmail(subject: string, body: string): Promise<Record<string, unknown>> {
  return api('POST', '/email', { subject, body });
}

// ─── Follow-up Tasks ────────────────────────────────────────────────

/** Continue a conversation on a completed task. */
export async function followUpTask(taskId: string, instruction: string): Promise<TaskSubmitResult> {
  return api<TaskSubmitResult>('POST', `/tasks/${encodeURIComponent(taskId)}/follow-up?wait=true`, {
    instruction,
  }, TASK_TIMEOUT_MS);
}

// ─── Pentest ────────────────────────────────────────────────────────

/** Get credit balance for pentests. */
export async function getPentestCredits(): Promise<Record<string, unknown>> {
  return api('GET', '/pentest/credits');
}

/** Get available pentest test catalog. */
export async function getPentestCatalog(): Promise<Record<string, unknown>> {
  return api('GET', '/pentest/tests');
}

/** Start a pentest on an agent. */
export async function startPentest(
  agentId: string,
  tests: string[],
  targetUrls: string[] = [],
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { tests };
  if (targetUrls.length > 0) body.target_urls = targetUrls;
  return api('POST', `/pentest/${encodeURIComponent(agentId)}`, body);
}

/** Get pentest status and results for an agent. */
export async function getPentest(agentId: string): Promise<Record<string, unknown>> {
  return api('GET', `/pentest/${encodeURIComponent(agentId)}`);
}

/** Get pentest history for an agent. */
export async function getPentestHistory(agentId: string): Promise<any[]> {
  return api<any[]>('GET', `/pentest/history/${encodeURIComponent(agentId)}`);
}

// ─── Account ─────────────────────────────────────────────────────────

/** Get account info. */
export async function getAccountInfo(): Promise<Record<string, unknown>> {
  return api('GET', '/account');
}
