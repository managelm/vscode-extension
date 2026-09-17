/**
 * Tool executor — dispatches tool calls from the LM to the ManageLM API.
 *
 * Each case validates input, calls the API client, and returns a JSON string
 * for the LM. Behaviour follows the ManageLM MCP tools of the same name.
 */

import * as api from './api.js';

/** Safely extract a string parameter from LM input. */
function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  return val != null ? String(val) : '';
}

const out = (value: unknown) => JSON.stringify(value);
const fail = (error: string) => out({ error });

/** Search tools → GET /api/search/<route>. The tool input is passed as the filters. */
const SEARCH_ROUTES: Record<string, string> = {
  search_agents: 'agents',
  search_inventory: 'inventory',
  search_security: 'security',
  search_activity: 'activity',
  search_ssh_keys: 'ssh-keys',
  search_sudo_rules: 'sudo-rules',
  search_certificates: 'certs',
  search_pki: 'pki',
  search_credentials: 'credentials',
  search_keystore: 'keystore',
  search_monitors: 'monitors',
  search_backups: 'backups',
  list_connectors: 'connectors',
  search_cloud: 'cloud',
};

/** run_* scan tools → scan type (key of api.SCANS). */
const SCAN_TOOLS: Record<string, string> = {
  run_security_audit: 'security',
  run_inventory_scan: 'inventory',
  run_access_scan: 'access',
  run_certificate_scan: 'certificates',
  run_activity_scan: 'activity',
};

/** Resolve the `hostname` input to exactly one agent, or an error string for the LM. */
async function resolveAgent(input: Record<string, unknown>): Promise<Pick<api.Agent, 'id' | 'hostname' | 'display_name' | 'status'> | string> {
  const hostname = str(input, 'hostname');
  if (!hostname) { return fail('hostname is required'); }
  const found = await api.findAgentByHostname(hostname);
  return 'agent' in found ? found.agent : fail(found.error);
}

/**
 * The fields get_agent_info returns, as the MCP tool does. The agent row also
 * carries the (masked) LLM API key, the LLM URL, enrollment details and the
 * emails of the users with access — none of which the model needs.
 */
const AGENT_INFO_FIELDS = [
  'id', 'hostname', 'display_name', 'status', 'node_type', 'os_info', 'agent_version',
  'ip_address', 'ip_addresses', 'is_public', 'tags', 'last_seen_at',
  'health_metrics', 'llm_status',
];

/**
 * The agent info the model reads, shaped like the MCP tool's: group names, and
 * the EFFECTIVE read-only flag. The row's own `read_only_ai` misses an agent
 * made read-only through a group, and the model would plan changes it refuses.
 */
function agentInfo(row: api.Json): api.Json {
  return {
    ...Object.fromEntries(AGENT_INFO_FIELDS.map(f => [f, row[f]])),
    groups: (row.groups ?? []).map((g: api.Json | string) => (typeof g === 'string' ? g : g.name)),
    read_only_ai: row.read_only_ai_effective ?? row.read_only_ai,
  };
}

/** Skills a task can use: a direct assignment can be switched off, and run_task refuses those. */
const usableSkills = (skills: api.Json[]) => skills.filter(s => s.enabled !== false);

/** What the LM reads after a task: its result, its question, or that it is still running. */
function taskOutcome(outcome: api.TaskOutcome): string {
  if ('still_running' in outcome) {
    return out({
      task_id: outcome.task_id, status: 'running',
      message: 'The task is still running. Tell the user, including its task ID, and check it later with get_task_status.',
    });
  }
  const { task, result } = outcome;
  if (task.status === 'needs_input') {
    return out({
      task_id: task.id, status: 'needs_input',
      question: task.question || 'The agent needs more information to continue.',
      message: 'Ask the user this question, then call answer_task with this task ID and their response.',
    });
  }
  return out({
    task_id: task.id, status: task.status, summary: task.summary,
    error: task.error_message, mutating: task.mutating, result,
  });
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  // ── Searches ────────────────────────────────────────────────────
  if (SEARCH_ROUTES[name]) {
    return out(await api.search(SEARCH_ROUTES[name], input));
  }

  // ── Scans: start and wait ───────────────────────────────────────
  if (SCAN_TOOLS[name]) {
    const agent = await resolveAgent(input);
    if (typeof agent === 'string') { return agent; }
    const scan = await api.runScanAndWait(SCAN_TOOLS[name], agent.id);
    if (!scan) { return fail('The scan did not produce a result.'); }
    if (scan.status === 'running' || scan.status === 'pending') {
      return out({ hostname: agent.hostname, status: 'running', message: 'The scan is still running. Its result will be in the matching search_* tool once it completes.' });
    }
    if (scan.status === 'failed') {
      return out({ hostname: agent.hostname, status: 'failed', error: scan.error_message });
    }
    return out({ hostname: agent.hostname, status: scan.status, completed_at: scan.completed_at, report: scan.report });
  }

  switch (name) {
    // ── Discovery ───────────────────────────────────────────────────
    case 'get_agent_info': {
      const agent = await resolveAgent(input);
      if (typeof agent === 'string') { return agent; }
      const [full, skills, tasks] = await Promise.all([
        api.getAgent(agent.id),
        api.getAgentSkills(agent.id).catch(() => []),     // No LLM accounts have no skills route
        api.getTaskHistory({ agent_id: agent.id, limit: 5 }),
      ]);
      return out({
        agent: agentInfo(full as unknown as api.Json),
        skills: usableSkills(skills).map(s => ({ slug: s.slug, name: s.name })),
        recent_tasks: tasks.map(t => ({ id: t.id, skill: t.skill_slug, status: t.status, summary: t.summary, created_at: t.created_at })),
      });
    }
    case 'get_agent_skills': {
      const agent = await resolveAgent(input);
      if (typeof agent === 'string') { return agent; }
      const skills = await api.getAgentSkills(agent.id);
      return out({ hostname: agent.hostname, skills: usableSkills(skills).map(s => ({ slug: s.slug, name: s.name, description: s.description })) });
    }
    case 'list_available_skills': {
      const catalog = await api.getSkillCatalog();
      return out({
        available: catalog.filter(s => !s.imported).map(s => ({ slug: s.slug, name: s.name, node_type: s.node_type, description: s.description })),
      });
    }
    case 'get_account_info': {
      const [account, groups, sites] = await Promise.all([api.getAccount(), api.listGroups(), api.listSites()]);
      return out({
        account: account.account,
        members: (account.users || []).length,
        groups: groups.map(g => g.name),
        sites: sites.map(s => s.name),
      });
    }
    case 'list_team_members': {
      const account = await api.getAccount();
      const filter = str(input, 'user').toLowerCase();
      const users = (account.users || [])
        .filter((u: api.Json) => !filter || `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(filter))
        .map((u: api.Json) => ({
          name: `${u.first_name || ''} ${u.last_name || ''}`.trim(), email: u.email, role: u.account_role,
          enabled: u.enabled, has_ssh_key: u.has_ssh_key, system_username: u.system_username,
          permissions: Object.keys(u).filter(k => k.startsWith('perm_') && u[k]).map(k => k.slice(5)),
        }));
      return out({ members: users });
    }

    // ── Hosting ─────────────────────────────────────────────────────
    case 'get_cloud_info': {
      const resource = str(input, 'resource');
      if (!resource) { return fail('resource is required'); }
      const { resources } = await api.search('cloud', { query: resource });
      if (!resources.length) { return fail(`No hosting resource matches "${resource}". Use search_cloud to browse.`); }
      const matches: api.Json[] = resources.slice(0, 5);
      const actionsByConnector = new Map<string, api.Json>();
      for (const r of matches) {
        if (!actionsByConnector.has(r.connector_id)) {
          actionsByConnector.set(r.connector_id, await api.getConnectorActions(r.connector_id));
        }
      }
      const rows = matches.map((r: api.Json) => ({ ...r, available_actions: actionsByConnector.get(r.connector_id)?.actions ?? [] }));
      return out(rows.length === 1 ? rows[0] : rows);
    }
    case 'cloud_action': {
      const resource = str(input, 'resource');
      const action = str(input, 'action');
      if (!resource || !action) { return fail('resource and action are required'); }
      // Exactly one VM, by exact name or provider ID, as the MCP tool requires.
      // The search also matches regions and partial names, which only ever
      // become suggestions: never guess which machine to act on.
      const { resources, truncated } = await api.search('cloud', { query: resource, type: 'vm' });
      const lower = resource.toLowerCase();
      const exact = resources.filter((r: api.Json) =>
        String(r.name).toLowerCase() === lower || String(r.provider_id).toLowerCase() === lower);
      const listed = (rows: api.Json[]) =>
        rows.slice(0, 10).map((r: api.Json) => ({ name: r.name, provider_id: r.provider_id, connector: r.connector_name }));
      if (exact.length === 0 && truncated) {
        // The search stops at 100 rows ordered by name: an exactly named VM can
        // be past the cap, so this is not "no such VM".
        return fail(`Too many VMs match "${resource}" to find it by name. Ask the user for its exact provider ID.`);
      }
      if (exact.length === 0) {
        return resources.length === 0
          ? fail(`No VM matches "${resource}". Use search_cloud to find it.`)
          : out({ error: `No VM is named "${resource}". Ask the user which one they mean; do not choose on their behalf.`, candidates: listed(resources) });
      }
      if (exact.length > 1) {
        return out({ error: `"${resource}" names ${exact.length} VMs. Ask the user which one; do not choose on their behalf.`, candidates: listed(exact) });
      }
      const vm = exact[0];
      const { actions = [] } = await api.getConnectorActions(vm.connector_id);
      const descriptor = actions.find((a: api.Json) => a.id === action);
      if (!descriptor) {
        return out({ error: `Action "${action}" is not allowed on ${vm.name}.`, allowed_actions: actions.map((a: api.Json) => a.id) });
      }
      if (descriptor.risk === 'disruptive' && input.confirm !== true) {
        return fail(`"${action}" on ${vm.name} (${vm.connector_name}) is disruptive: ${descriptor.description} Ask the user to confirm this VM and action, then retry with confirm=true.`);
      }
      return out(await api.runConnectorAction(vm.connector_id, vm.id, action, input.params as api.Json | undefined));
    }

    // ── Tasks ───────────────────────────────────────────────────────
    case 'run_task': {
      const skill = str(input, 'skill');
      const instruction = str(input, 'instruction');
      if (!skill || !instruction) { return fail('hostname, skill and instruction are required'); }
      const agent = await resolveAgent(input);
      if (typeof agent === 'string') { return agent; }
      if (agent.status !== 'online') { return fail(`Agent "${agent.hostname}" is ${agent.status}`); }
      return taskOutcome(await api.runTask(agent.id, skill, instruction));
    }
    case 'answer_task': {
      const taskId = str(input, 'task_id');
      const answer = str(input, 'answer');
      if (!taskId || !answer) { return fail('task_id and answer are required'); }
      return taskOutcome(await api.answerTask(taskId, answer));
    }
    case 'follow_up_task': {
      const taskId = str(input, 'task_id');
      const instruction = str(input, 'instruction');
      if (!taskId || !instruction) { return fail('task_id and instruction are required'); }
      return taskOutcome(await api.followUpTask(taskId, instruction));
    }
    case 'get_task_status': {
      const taskId = str(input, 'task_id');
      if (!taskId) { return fail('task_id is required'); }
      return out({ task: await api.getTask(taskId) });
    }
    case 'get_task_history': {
      const agent = await resolveAgent(input);
      if (typeof agent === 'string') { return agent; }
      const limit = typeof input.limit === 'number' ? Math.min(input.limit, 200) : 20;
      const tasks = await api.getTaskHistory({ agent_id: agent.id, limit, since: input.since, until: input.until });
      return out({
        hostname: agent.hostname,
        tasks: tasks.map(t => ({ id: t.id, skill: t.skill_slug, status: t.status, summary: t.summary, question: t.question, created_at: t.created_at })),
      });
    }
    case 'get_task_changes': {
      const taskId = str(input, 'task_id');
      if (!taskId) { return fail('task_id is required'); }
      return out(await api.getTaskChanges(taskId, input.full_diff === true));
    }
    case 'revert_task': {
      const taskId = str(input, 'task_id');
      if (!taskId) { return fail('task_id is required'); }
      return out(await api.revertTask(taskId));
    }

    // ── Utility ─────────────────────────────────────────────────────
    case 'send_email': {
      const subject = str(input, 'subject');
      const body = str(input, 'body');
      if (!subject || !body) { return fail('subject and body are required'); }
      return out(await api.sendEmail(subject, body));
    }

    default:
      return fail(`Unknown tool: ${name}`);
  }
}
