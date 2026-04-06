/**
 * ManageLM tool definitions for the Copilot Chat participant.
 *
 * Each tool maps to a ManageLM portal API endpoint. The LM selects
 * which tools to call based on the user's prompt and these descriptions.
 */

import type { LanguageModelChatTool } from 'vscode';

export const TOOL_DEFS: LanguageModelChatTool[] = [
  // ── Agents ──────────────────────────────────────────────────────────
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
    name: 'approveAgent',
    description: 'Approve a pending agent enrollment.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Server hostname to approve' } },
      required: ['hostname'],
    },
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

  // ── Tasks ───────────────────────────────────────────────────────────
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

  // ── Skills ──────────────────────────────────────────────────────────
  {
    name: 'listSkills',
    description: 'List all skills available in the ManageLM account.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Security & Inventory ────────────────────────────────────────────
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

  // ── Search (read-only, no commands dispatched) ──────────────────────
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
        unknown_only: { type: 'boolean', description: 'Only show keys not matched to any ManageLM user' },
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
        nopasswd_only: { type: 'boolean', description: 'Only show NOPASSWD sudo rules' },
        group: { type: 'string', description: 'Filter by group name' },
      },
    },
  },

  // ── Account & Email ─────────────────────────────────────────────────
  {
    name: 'accountInfo',
    description: 'Get ManageLM account information (plan, members, usage).',
    inputSchema: { type: 'object', properties: {} },
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
];
