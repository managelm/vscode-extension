/**
 * ManageLM VS Code extension entry point.
 *
 * Registers the @managelm Copilot Chat participant.
 * The API key is read from VS Code settings (managelm.apiKey).
 */

import * as vscode from 'vscode';
import { registerParticipant } from './participant.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerParticipant(context);
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions
}
