/**
 * ManageLM tool definitions for the Copilot Chat participant.
 *
 * Named and described like the ManageLM MCP server's tools, so the same
 * question gets the same tool in Claude and in VS Code. Each maps to the
 * portal REST API (see executor.ts). Where the API is narrower than MCP —
 * tasks and scans take one server rather than a group, site or "all" — the
 * description says so.
 */

import type { LanguageModelChatTool } from 'vscode';

const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object', properties, required });

const HOSTNAME = { type: 'string', description: 'Server hostname or display name' };
const GROUP = { type: 'string', description: 'Filter by server group name' };
const SITE = { type: 'string', description: 'Filter by site name (datacenter, office, region)' };
const AGENT = { type: 'string', description: 'Filter by agent hostname or display name' };
const SINCE = { type: 'string', description: 'ISO-8601 date or datetime (inclusive), e.g. "2026-05-10"' };
const UNTIL = { type: 'string', description: 'ISO-8601 date or datetime (exclusive)' };

/** One run_* tool per scan type (executor.ts maps each to a key of api.SCANS). */
const scanTool = (name: string, what: string): LanguageModelChatTool => ({
  name,
  description: `Run ${what} on one server and wait for the result (up to 3 minutes). Requires the Reports authorization on the API key.`,
  inputSchema: obj({ hostname: HOSTNAME }, ['hostname']),
});

export const TOOL_DEFS: LanguageModelChatTool[] = [
  // ── Discovery ───────────────────────────────────────────────────────
  {
    name: 'get_agent_info',
    description: 'Detailed info for one server: OS, version, IPs, health, status, assigned skills and recent tasks.',
    inputSchema: obj({ hostname: HOSTNAME }, ['hostname']),
  },
  {
    name: 'get_agent_skills',
    description: 'Skills assigned to a server (directly or through a group). Use it to pick the skill for run_task.',
    inputSchema: obj({ hostname: HOSTNAME }, ['hostname']),
  },
  {
    name: 'list_available_skills',
    description: 'Catalog skills not yet imported into the account.',
    inputSchema: obj({}),
  },
  {
    name: 'get_account_info',
    description: 'Account name, optional features, and the groups and sites (valid group / site filter values).',
    inputSchema: obj({}),
  },
  {
    name: 'list_team_members',
    description: 'ManageLM users with their role, permissions and whether they registered an SSH key.',
    inputSchema: obj({ user: { type: 'string', description: 'Filter by name or email (partial match)' } }),
  },

  // ── Search (read-only, queries stored data) ─────────────────────────
  {
    name: 'search_agents',
    description: 'List and filter servers by status, group, site, health metrics or free text. Call first to discover servers.',
    inputSchema: obj({
      query: { type: 'string', description: 'Free text on hostname, OS, IP or tags' },
      status: { type: 'string', description: 'online, offline, approved, pending_approval' },
      group: GROUP, site: SITE,
      cpu_above: { type: 'number', description: 'CPU usage above %' },
      memory_above: { type: 'number', description: 'Memory usage above %' },
      disk_above: { type: 'number', description: 'Disk usage above %' },
    }),
  },
  {
    name: 'search_inventory',
    description: 'Find which servers run a service, have a package installed or run containers, from stored inventory scans.',
    inputSchema: obj({
      query: { type: 'string', description: 'Item name, version or details (e.g. nginx, docker)' },
      category: { type: 'string', description: 'system, web, database, mail, container, network, storage, security, monitoring, log, user, scheduler, software, other' },
      status: { type: 'string', description: 'running, stopped, installed, info' },
      group: GROUP, site: SITE,
    }),
  },
  {
    name: 'search_security',
    description: 'Security issues across servers: audit and vulnerability findings, pentest findings, threat alerts (service, session, virus, exposure) and exposure checks, each tagged with its source.',
    inputSchema: obj({
      query: { type: 'string', description: 'Search titles and explanations' },
      severity: { type: 'string', description: 'Minimum severity: critical, high, medium, low' },
      category: { type: 'string', description: 'ssh, firewall, users, permissions, updates, kernel, tls, docker, vulnerability, ... ("Threat Detection" for threats, "Exposure" for exposure checks)' },
      source: { type: 'string', description: 'audit, pentest, threat, exposure, or all' },
      kind: { type: 'string', description: 'Threat alerts only: service, session, virus, exposure (comma-separated for several)' },
      unresolved: { type: 'boolean', description: 'Only open items (default true)' },
      group: GROUP, site: SITE, since: SINCE, until: UNTIL,
    }),
  },
  {
    name: 'search_activity',
    description: 'User activity across servers: logins, failed logins, sudo commands and file changes, from stored activity scans.',
    inputSchema: obj({
      query: { type: 'string', description: 'Username, command, source IP or file path' },
      category: { type: 'string', description: 'sessions, failed_auth, root_commands, file_changes' },
      user: { type: 'string', description: 'System username or ManageLM user' },
      group: GROUP, site: SITE, since: SINCE, until: UNTIL,
    }),
  },
  {
    name: 'search_ssh_keys',
    description: 'SSH keys deployed on servers and registered in ManageLM profiles, with identity mapping. Use "user" for a person.',
    inputSchema: obj({
      query: { type: 'string', description: 'Fingerprint or system username' },
      user: { type: 'string', description: 'ManageLM user name or email ("me" for yourself)' },
      unknown_only: { type: 'boolean', description: 'Only keys not matched to a ManageLM user' },
      group: GROUP, site: SITE,
    }),
  },
  {
    name: 'search_sudo_rules',
    description: 'Sudo rules (Linux) and administrator group membership (Windows) across servers.',
    inputSchema: obj({
      query: { type: 'string', description: 'System username' },
      user: { type: 'string', description: 'ManageLM user name or email ("me" for yourself)' },
      nopasswd_only: { type: 'boolean', description: 'Only NOPASSWD rules' },
      group: GROUP, site: SITE,
    }),
  },
  {
    name: 'search_certificates',
    description: 'x509 certificates DISCOVERED on servers by certificate scans: expired, expiring, weak, self-signed, unmanaged.',
    inputSchema: obj({
      query: { type: 'string', description: 'Subject, issuer or path' },
      status: { type: 'string', description: 'managed, unmanaged, expired, expiring, weak, self_signed' },
      path: { type: 'string', description: 'Filesystem path (partial)' },
      group: GROUP, site: SITE,
    }),
  },
  {
    name: 'search_pki',
    description: 'Certificates ManageLM itself issues and renews (Internal CA and Let\'s Encrypt).',
    inputSchema: obj({
      query: { type: 'string', description: 'Common name, agent or SAN' },
      status: { type: 'string', description: 'active, revoked, expired, failed, pending' },
      source: { type: 'string', description: 'local_ca, letsencrypt' },
      agent: AGENT, site: SITE,
    }),
  },
  {
    name: 'search_credentials',
    description: 'Credentials ManageLM rotates: last and next rotation, state, failures. Metadata only; values can never be retrieved. Requires the Credentials authorization.',
    inputSchema: obj({
      query: { type: 'string', description: 'Name, account, host or connector' },
      state: { type: 'string', description: 'active, failed, pending, rotating' },
      type: { type: 'string', description: 'Kind or backend (substring): password, ssh_key, ldap, entra, ...' },
      agent: AGENT, site: SITE,
    }),
  },
  {
    name: 'search_keystore',
    description: 'KSM Keystore: keys, the applications using them, and their usage or refusals. Metadata only. Requires the Keystore authorization.',
    inputSchema: obj({
      view: { type: 'string', description: 'keys (default), clients, denied, activity' },
      query: { type: 'string', description: 'Key, handle, application, caller or refusal reason' },
      agent: AGENT,
    }),
  },
  {
    name: 'search_monitors',
    description: 'Monitors with their current status (up, down, degraded, pending, or stalled when the agent is offline), value and unit.',
    inputSchema: obj({
      query: { type: 'string', description: 'Monitor name, agent or type' },
      status: { type: 'string', description: 'up, down, degraded, pending, stalled' },
      slug: { type: 'string', description: 'Monitor type: website, mysql, smtp, cpu, memory, filesystem, process, ...' },
      agent: AGENT, site: SITE,
    }),
  },
  {
    name: 'search_backups',
    description: 'Filesystem backups with status, schedule, snapshot count and last run.',
    inputSchema: obj({
      query: { type: 'string', description: 'Backup name, source path or agent' },
      status: { type: 'string', description: 'pending, running, ok, failed' },
      agent: AGENT, site: SITE,
    }),
  },

  // ── Hosting ─────────────────────────────────────────────────────────
  {
    name: 'list_connectors',
    description: 'Hosting connectors (AWS, Azure, GCP, OpenStack, Proxmox, VMware) with sync status and resource counts.',
    inputSchema: obj({}),
  },
  {
    name: 'search_cloud',
    description: 'VMs, volumes, networks and security groups discovered by hosting connectors.',
    inputSchema: obj({
      query: { type: 'string', description: 'Resource name, provider ID or region' },
      type: { type: 'string', description: 'vm, volume, network, security_group' },
      status: { type: 'string', description: 'Provider-side status (running, stopped, ...)' },
      provider: { type: 'string', description: 'aws, azure, gcp, vmware, proxmox, openstack' },
      connector: { type: 'string', description: 'Connector name' },
      unmatched: { type: 'boolean', description: 'Only VMs with no ManageLM agent' },
    }),
  },
  {
    name: 'get_cloud_info',
    description: 'One hosting resource by name or provider ID, with the actions its connector allows and their risk.',
    inputSchema: obj({ resource: { type: 'string', description: 'Resource name or provider ID' } }, ['resource']),
  },
  {
    name: 'cloud_action',
    description: 'Start, shut down, stop, reboot or snapshot a VM through its hosting connector. The resource must match exactly one VM. Disruptive actions need confirm=true: ask the user first. Requires the Hosting authorization.',
    inputSchema: obj({
      resource: { type: 'string', description: 'VM name or provider ID' },
      action: { type: 'string', description: 'Action ID from get_cloud_info, e.g. vm.start, vm.shutdown, vm.reboot, vm.snapshot.create' },
      params: { type: 'object', description: 'Action parameters, e.g. {"name": "before-upgrade"} for a snapshot' },
      confirm: { type: 'boolean', description: 'Required (true) for disruptive actions. Never set it without asking the user.' },
    }, ['resource', 'action']),
  },

  // ── Scans (start + wait) ────────────────────────────────────────────
  scanTool('run_security_audit', 'a security audit (SSH, firewall, ports, users, TLS, kernel, ...)'),
  scanTool('run_inventory_scan', 'an inventory scan (services, packages, containers, network, storage)'),
  scanTool('run_access_scan', 'an access scan (SSH authorized keys and sudo rules, or Windows local accounts)'),
  scanTool('run_certificate_scan', 'a certificate discovery scan (metadata only, never private keys)'),
  scanTool('run_activity_scan', 'an activity scan over the last 24 hours (logins, failed logins, sudo, file changes)'),

  // ── Tasks ───────────────────────────────────────────────────────────
  {
    name: 'run_task',
    description: 'Run a natural-language task on one server with a skill. Use get_agent_skills to choose the skill, or "auto" to let the agent pick. Waits up to 2 minutes; a longer task returns status "running" with its task_id.',
    inputSchema: obj({
      hostname: HOSTNAME,
      skill: { type: 'string', description: 'Skill slug (e.g. packages, services, users, containers, webserver, database) or "auto"' },
      instruction: { type: 'string', description: 'What to do, in plain language. Be specific.' },
    }, ['hostname', 'skill', 'instruction']),
  },
  {
    name: 'answer_task',
    description: 'Answer the question of a task in needs_input status (the agent needs a domain name, password, choice, ...). Ask the user first.',
    inputSchema: obj({
      task_id: { type: 'string', description: 'Task ID in needs_input status' },
      answer: { type: 'string', description: 'The user\'s answer' },
    }, ['task_id', 'answer']),
  },
  {
    name: 'follow_up_task',
    description: 'Continue the conversation of a completed task (context kept for 5 minutes).',
    inputSchema: obj({
      task_id: { type: 'string', description: 'ID of the completed task' },
      instruction: { type: 'string', description: 'Follow-up request' },
    }, ['task_id', 'instruction']),
  },
  {
    name: 'get_task_status',
    description: 'Status and result of a task by ID.',
    inputSchema: obj({ task_id: { type: 'string', description: 'Task ID' } }, ['task_id']),
  },
  {
    name: 'get_task_history',
    description: 'Recent tasks on a server, optionally within a time range.',
    inputSchema: obj({
      hostname: HOSTNAME,
      limit: { type: 'number', description: 'Max results (default 20, max 200)' },
      since: SINCE, until: UNTIL,
    }, ['hostname']),
  },
  {
    name: 'get_task_changes',
    description: 'Files changed by a task, with an optional full diff fetched from the agent.',
    inputSchema: obj({
      task_id: { type: 'string', description: 'Task ID' },
      full_diff: { type: 'boolean', description: 'Fetch the unified diff (agent must be online)' },
    }, ['task_id']),
  },
  {
    name: 'revert_task',
    description: 'Revert the file changes of a task (agent online, changes under 30 days old). Call get_task_changes first.',
    inputSchema: obj({ task_id: { type: 'string', description: 'Task ID to revert' } }, ['task_id']),
  },
];
