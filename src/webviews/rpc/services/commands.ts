/**
 * Commands service — execute VS Code commands from webviews.
 *
 * Two dispatch paths:
 * - `execute()` — for non-webview commands (no context injection needed)
 * - `executeScoped()` — for webview-scoped commands (auto-injects `WebviewContext`)
 *
 * Webview-scoped commands (registered via `registerWebviewCommand`) require
 * `WebviewContext` as the first argument for routing to the correct webview
 * instance. `executeScoped` handles this automatically.
 */

import type { GlExtensionCommands, GlWebviewCommands } from '../../../constants.commands.js';
import type { Container } from '../../../container.js';
import { executeCommand } from '../../../system/-webview/command.js';
import type { RpcServiceHost } from './types.js';

export class CommandsService {
	readonly #host: RpcServiceHost;

	constructor(_container: Container, host: RpcServiceHost) {
		this.#host = host;
	}

	/**
	 * Execute a non-webview GitLens command.
	 * @param command - The command identifier (must NOT be a webview-scoped command)
	 * @param args - Optional arguments to pass to the command
	 */
	async execute(command: GlExtensionCommands, ...args: unknown[]): Promise<unknown> {
		return executeCommand(command, ...args) as Promise<unknown>;
	}

	/**
	 * Execute a webview-scoped command, automatically injecting `WebviewContext`.
	 * The webview's ID and instance are merged into the first argument.
	 * @param command - A webview-scoped command (e.g. `gitlens.switchToBranch:home`)
	 * @param args - Optional arguments (merged with WebviewContext)
	 */
	async executeScoped(command: GlWebviewCommands, args?: Record<string, unknown>): Promise<unknown> {
		const context = { webview: this.#host.id, webviewInstance: this.#host.instanceId, ...args };
		return executeCommand(command, context) as Promise<unknown>;
	}
}
