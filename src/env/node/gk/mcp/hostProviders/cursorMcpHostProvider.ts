import { cursor } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../../../../../container.js';
import type { GkMcpService } from '../gkMcpService.js';
import type { McpHostRegistrationProvider } from './types.js';

export class CursorMcpHostProvider implements McpHostRegistrationProvider {
	private _registeredServerName: string | undefined;
	private _disposed = false;

	constructor(
		private readonly container: Container,
		private readonly service: GkMcpService,
	) {
		// Try immediately in case the CLI is already installed
		void this.refresh();
	}

	dispose(): void {
		this._disposed = true;
		this.tryUnregister();
	}

	shouldFireOnTimeout(): boolean {
		return true;
	}

	@debug()
	async refresh(): Promise<void> {
		const scope = getScopedLogger();

		const config = await this.service.resolveMcpConfig();
		// Bail if disposed while the config fetch was in flight — otherwise a toggle-off during the fetch
		// would re-register a server after dispose()'s tryUnregister already ran, orphaning it for the session.
		if (config == null || this._disposed) return;

		void this.container.usage.track('action:gitlens.mcp.bundledMcpDefinitionProvided:happened');

		try {
			// Unregister the previous registration before re-registering (e.g. on CLI update)
			this.tryUnregister();

			this._registeredServerName = config.name;
			cursor.mcp.registerServer({
				name: config.name,
				server: {
					command: config.command,
					args: config.args,
					env: {},
				},
			});
		} catch (ex) {
			scope?.error(ex, `Failed to register MCP server: ${ex instanceof Error ? ex.message : 'Unknown error'}`);
		}
	}

	@debug()
	private tryUnregister(): void {
		const scope = getScopedLogger();

		if (this._registeredServerName == null) return;

		try {
			cursor.mcp.unregisterServer(this._registeredServerName);
		} catch (ex) {
			scope?.error(ex, `Failed to unregister MCP server: ${ex instanceof Error ? ex.message : 'Unknown error'}`);
		} finally {
			this._registeredServerName = undefined;
		}
	}
}
