import { cursor } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../../../../container.js';
import { GkMcpProviderBase } from './integrationBase.js';

export class CursorGkMcpProvider extends GkMcpProviderBase {
	private _registeredServerName: string | undefined;

	constructor(container: Container) {
		super(container);

		// Try immediately in case the CLI is already installed
		void this.tryRegister();
	}

	protected override onDispose(): void {
		this.tryUnregister();
	}

	protected override fireChangeCore(): void {
		void this.tryRegister();
	}

	@debug()
	private async tryRegister(): Promise<void> {
		const scope = getScopedLogger();

		const discoveryFilePath = this._discoveryFilePath;

		// Gives time for the IPC server to start and emit the discovery path
		if (discoveryFilePath != null) {
			this.clearIpcTimeout();
		} else if (this._waitingForIPC) {
			return;
		}

		const config = await this.getMcpConfigurationFromCLI();
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
