/**
 * ManageLM VS Code extension entry point.
 *
 * Registers the @managelm Copilot Chat participant and all Language Model
 * tools. The API key is read from VS Code settings (managelm.apiKey).
 */

import * as vscode from 'vscode';
import { registerParticipant } from './participant.js';
import {
  ListAgentsTool,
  AgentInfoTool,
  RunTaskTool,
  GetTaskStatusTool,
  GetTaskHistoryTool,
  ApproveAgentTool,
  ListSkillsTool,
  AgentSkillsTool,
  GetSecurityTool,
  GetInventoryTool,
  RunSecurityAuditTool,
  RunInventoryScanTool,
  AccountInfoTool,
} from './tools.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Register @managelm chat participant
  registerParticipant(context);

  // Register Language Model tools (available to Copilot Chat and agent mode)
  context.subscriptions.push(
    vscode.lm.registerTool('managelm_listAgents', new ListAgentsTool()),
    vscode.lm.registerTool('managelm_agentInfo', new AgentInfoTool()),
    vscode.lm.registerTool('managelm_runTask', new RunTaskTool()),
    vscode.lm.registerTool('managelm_getTaskStatus', new GetTaskStatusTool()),
    vscode.lm.registerTool('managelm_getTaskHistory', new GetTaskHistoryTool()),
    vscode.lm.registerTool('managelm_approveAgent', new ApproveAgentTool()),
    vscode.lm.registerTool('managelm_listSkills', new ListSkillsTool()),
    vscode.lm.registerTool('managelm_agentSkills', new AgentSkillsTool()),
    vscode.lm.registerTool('managelm_getSecurity', new GetSecurityTool()),
    vscode.lm.registerTool('managelm_getInventory', new GetInventoryTool()),
    vscode.lm.registerTool('managelm_runSecurityAudit', new RunSecurityAuditTool()),
    vscode.lm.registerTool('managelm_runInventoryScan', new RunInventoryScanTool()),
    vscode.lm.registerTool('managelm_accountInfo', new AccountInfoTool()),
  );
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions
}
