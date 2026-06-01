import { cursor } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../../../../../container.js';
import type { GkMcpService } from '../gkMcpService.js';
import type { McpHostRegistrationProvider } from './types.js';

export class CursorMcpHostProvider implements McpHostRegistrationProvider {
	readonly id = 'cursor' as const;

	private _registeredServerName: string | undefined;

	constructor(
		private readonly container: Container,
		private readonly service: GkMcpService,
	) {
		// Try immediately in case the CLI is already installed
		void this.refresh();
	}

	dispose(): void {
		this.tryUnregister();
	}

	@debug()
	async refresh(): Promise<void> {
		const scope = getScopedLogger();

		const discoveryFilePath = this.service.discoveryFilePath;

		if (discoveryFilePath != null) {
			this.service.clearIpcTimeout();
		} else if (this.service.isWaitingForIpc) {
			return;
		}

		const config = await this.service.getMcpConfig();
		if (config == null) return;

		void this.container.usage.track('action:gitlens.mcp.bundledMcpDefinitionProvided:happened');

		const serverEnv: Record<string, string> = {};
		if (discoveryFilePath != null) {
			serverEnv['GK_GL_PATH'] = discoveryFilePath;
		}

		try {
			// Unregister the previous registration before re-registering (e.g. on CLI update)
			this.tryUnregister();

			this._registeredServerName = config.name;
			cursor.mcp.registerServer({
				name: config.name,
				server: {
					command: config.command,
					args: config.args,
					env: serverEnv,
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
