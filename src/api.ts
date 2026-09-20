/**
 * ManageLM portal REST API client.
 *
 * All calls use the portal URL and API key from VS Code settings. The API key
 * reaches the same features as the ManageLM MCP server (tasks, scans,
 * searches, hosting actions); portal management — approving agents, users,
 * webhooks — is done in the portal.
 */

import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  hostname: string;
  display_name: string | null;
  status: 'online' | 'offline' | 'approved' | 'pending_approval' | 'revoked';
  health_metrics: Record<string, unknown> | null;
  tags: string[] | null;
  agent_version: string | null;
  os_info: string | null;
  ip_address: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  agent_id: string;
  skill_slug: string;
  operation: string;
  status: 'sent' | 'completed' | 'failed' | 'timeout' | 'needs_input' | 'answered';
  error_message: string | null;
  summary: string | null;
  question: string | null;
  mutating: boolean;
  created_at: string;
  completed_at: string | null;
}

/** A task that finished within the wait, or one still running after it. */
export type TaskOutcome =
  | { task: Task; result: unknown }
  | { task_id: string; status: 'sent'; still_running: true };

export type Json = Record<string, any>;

// ─── HTTP helpers ────────────────────────────────────────────────────

/** Default timeout for API requests (30s). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How long the portal waits for a task before answering "still running"
 * (wait_seconds), and a client timeout that covers it. A longer task is not
 * lost: the reply carries its ID for get_task_status.
 */
const TASK_WAIT_SECONDS = 120;
const TASK_TIMEOUT_MS = (TASK_WAIT_SECONDS + 15) * 1000;

/**
 * Calls the portal answers only once the agent or hypervisor has: a revert
 * and a Proxmox action wait up to 60 s, a full diff 30 s. A shorter client
 * timeout reports a failure for an action that went through, and the model
 * retries it (a second reboot, a duplicate snapshot).
 */
const SLOW_CALL_TIMEOUT_MS = 90_000;

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

async function api<T = Json>(
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

  // Abort on timeout — covers both fetch and response body parsing
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = { method, headers, signal: controller.signal };
  if (body && method !== 'GET' && method !== 'DELETE') {
    init.body = JSON.stringify(body);
  }

  let res: Response;
  let json: Record<string, unknown>;
  try {
    res = await fetch(`${portalUrl}/api${endpoint}`, init);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!res.ok) {
        throw new ApiError(res.status, `HTTP ${res.status} — portal returned non-JSON response`);
      }
      throw new ApiError(res.status, 'Unexpected non-JSON response from portal');
    }

    json = await res.json() as Record<string, unknown>;
  } catch (err: unknown) {
    if (err instanceof ApiError) { throw err; }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ApiError(res.status, (json.error as string) || `HTTP ${res.status}`);
  }

  return json as T;
}

/** Build a query string from tool input, skipping empty values. */
export function query(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') { qs.set(k, String(v)); }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

const id = (value: string) => encodeURIComponent(value);

// ─── Agents ──────────────────────────────────────────────────────────

/** id, hostname, display_name and status of every visible agent: enough to resolve a name, a fraction of the full rows. */
async function listAgentNames(): Promise<Pick<Agent, 'id' | 'hostname' | 'display_name' | 'status'>[]> {
  return (await api<{ agents: Agent[] }>('GET', '/agents?view=basic')).agents;
}

/** Get a single agent by ID. */
export async function getAgent(agentId: string): Promise<Agent> {
  return (await api<{ agent: Agent }>('GET', `/agents/${id(agentId)}`)).agent;
}

/**
 * Resolve a hostname or display name to exactly one agent (case-insensitive).
 * Like the MCP server, a partial name is never taken as a match: "web" could be
 * web01 or web02, and a task would run on whichever the list returned first.
 * Near matches come back as suggestions instead.
 */
export async function findAgentByHostname(hostname: string): Promise<{ agent: Pick<Agent, 'id' | 'hostname' | 'display_name' | 'status'> } | { error: string }> {
  const agents = await listAgentNames();
  const lower = hostname.toLowerCase();
  const exact = agents.filter(a =>
    a.hostname.toLowerCase() === lower || a.display_name?.toLowerCase() === lower);
  if (exact.length === 1) { return { agent: exact[0] }; }
  if (exact.length > 1) {
    return { error: `"${hostname}" names ${exact.length} servers (${exact.map(a => a.hostname).join(', ')}). Use the full hostname.` };
  }
  const near = agents.filter(a =>
    a.hostname.toLowerCase().includes(lower) || a.display_name?.toLowerCase().includes(lower));
  if (near.length > 0) {
    return { error: `No server is named "${hostname}". Did you mean: ${near.slice(0, 5).map(a => a.hostname).join(', ')}?` };
  }
  return { error: `No server is named "${hostname}". Use search_agents to list servers.` };
}

/** Skills assigned to an agent. */
export async function getAgentSkills(agentId: string): Promise<Json[]> {
  return (await api<{ skills: Json[] }>('GET', `/agents/${id(agentId)}/skills`)).skills;
}

// ─── Skills & account ────────────────────────────────────────────────

export async function getSkillCatalog(): Promise<Json[]> {
  return (await api<{ catalog: Json[] }>('GET', '/skills/catalog')).catalog;
}

export async function getAccount(): Promise<Json> {
  return api('GET', '/account');
}

export async function listGroups(): Promise<Json[]> {
  return (await api<{ groups: Json[] }>('GET', '/groups')).groups;
}

export async function listSites(): Promise<Json[]> {
  return (await api<{ sites: Json[] }>('GET', '/sites')).sites;
}

// ─── Tasks ───────────────────────────────────────────────────────────

/** Submit a task and wait for the result, up to TASK_WAIT_SECONDS. */
export async function runTask(agentId: string, skillSlug: string, instruction: string): Promise<TaskOutcome> {
  return api<TaskOutcome>('POST', `/tasks?wait_seconds=${TASK_WAIT_SECONDS}`, {
    agent_id: agentId,
    skill_slug: skillSlug,
    instruction,
  }, TASK_TIMEOUT_MS);
}

/** Answer a question from an interactive task (needs_input) and wait for the resumed task. */
export async function answerTask(taskId: string, answer: string): Promise<TaskOutcome> {
  return api<TaskOutcome>('POST', `/tasks/${id(taskId)}/answer?wait_seconds=${TASK_WAIT_SECONDS}`, { answer }, TASK_TIMEOUT_MS);
}

/** Continue a conversation on a completed task. */
export async function followUpTask(taskId: string, instruction: string): Promise<TaskOutcome> {
  return api<TaskOutcome>('POST', `/tasks/${id(taskId)}/follow-up?wait_seconds=${TASK_WAIT_SECONDS}`, { instruction }, TASK_TIMEOUT_MS);
}

export async function getTask(taskId: string): Promise<Json> {
  return (await api<{ task: Json }>('GET', `/tasks/${id(taskId)}`)).task;
}

export async function getTaskHistory(params: Record<string, unknown>): Promise<Json[]> {
  return (await api<{ tasks: Json[] }>('GET', `/tasks${query(params)}`)).tasks;
}

export async function getTaskChanges(taskId: string, fullDiff: boolean): Promise<Json> {
  const endpoint = `/tasks/${id(taskId)}/changes${fullDiff ? '?full_diff=true' : ''}`;
  return (await api<{ changeset: Json }>('GET', endpoint, undefined, fullDiff ? SLOW_CALL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)).changeset;
}

export async function revertTask(taskId: string): Promise<Json> {
  return api('POST', `/tasks/${id(taskId)}/revert`, undefined, SLOW_CALL_TIMEOUT_MS);
}

// ─── Scans ───────────────────────────────────────────────────────────

/** Portal route and reply key of each scan (POST starts it, GET reads the latest). */
export const SCANS: Record<string, { route: string; key: string }> = {
  security: { route: 'security', key: 'audit' },
  inventory: { route: 'inventory', key: 'inventory' },
  access: { route: 'sshkeys', key: 'scan' },
  certificates: { route: 'certscan', key: 'scan' },
  activity: { route: 'activity', key: 'audit' },
};

/** Latest scan of an agent, or null when none has run. */
export async function getScan(type: string, agentId: string): Promise<Json | null> {
  const scan = SCANS[type];
  const data = await api<Json>('GET', `/${scan.route}/${id(agentId)}`);
  return data[scan.key] ?? null;
}

/**
 * Start a scan and wait for it to finish, like the MCP run_* tools. Polls the
 * result every few seconds; a scan still running after `timeoutMs` is returned
 * as is (status "running") so the caller can read it later.
 */
export async function runScanAndWait(type: string, agentId: string, timeoutMs = 180_000): Promise<Json | null> {
  const scan = SCANS[type];
  await api('POST', `/${scan.route}/${id(agentId)}`);
  const deadline = Date.now() + timeoutMs;
  let latest: Json | null = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    latest = await getScan(type, agentId);
    if (latest && latest.status !== 'running' && latest.status !== 'pending') { break; }
  }
  return latest;
}

// ─── Search ──────────────────────────────────────────────────────────

/** GET /api/search/<kind> with the given filters. */
export async function search(kind: string, params: Record<string, unknown>): Promise<Json> {
  return api('GET', `/search/${kind}${query(params)}`);
}

// ─── Hosting ─────────────────────────────────────────────────────────

/** Actions a hosting connector permits (id, label, risk, params). */
export async function getConnectorActions(connectorId: string): Promise<Json> {
  return api('GET', `/connectors/${id(connectorId)}/actions`);
}

export async function runConnectorAction(connectorId: string, resourceId: string, action: string, params: Json | undefined): Promise<Json> {
  return api('POST', `/connectors/${id(connectorId)}/actions`, { resource_id: resourceId, action, params }, SLOW_CALL_TIMEOUT_MS);
}
