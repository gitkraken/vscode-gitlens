import type { Event, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { Disposable, env, EventEmitter, lm, McpStdioServerDefinition } from 'vscode';
import type { Container } from '../../../../container';
import type { StorageChangeEvent } from '../../../../system/-webview/storage';
import { getHostAppName } from '../../../../system/-webview/vscode';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { runCLICommand, toMcpInstallProvider } from '../cli/utils';

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

export class GkMcpProvider implements McpServerDefinitionProvider, Disposable {
	private readonly _disposable: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this.container.storage.onDidChange(e => this.checkStorage(e)),
			lm.registerMcpServerDefinitionProvider('gitlens.gkMcpProvider', this),
		);
	}

	private checkStorage(e?: StorageChangeEvent): void {
		if (e != null && !(e.keys as string[]).includes('gk:cli:install')) return;
		this._onDidChangeMcpServerDefinitions.fire();
	}

	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const config = await this.getMcpConfigurationFromCLI();
		if (config == null) {
			return [];
		}

		const serverDefinition = new McpStdioServerDefinition(
			`${config.name} (bundled with GitLens)`,
			config.command,
			config.args,
			{},
			config.version,
		);

		return [serverDefinition];
	}

	@log()
	private async getMcpConfigurationFromCLI(): Promise<
		{ name: string; type: string; command: string; args: string[]; version?: string } | undefined
	> {
		const cliInstall = this.container.storage.get('gk:cli:install');
		const cliPath = this.container.storage.get('gk:cli:path');

		if (cliInstall?.status !== 'completed' || !cliPath) {
			return undefined;
		}

		const appName = toMcpInstallProvider(await getHostAppName());
		if (appName == null) {
			return undefined;
		}

		let output = await runCLICommand(['mcp', 'config', appName, '--source=gitlens', `--scheme=${env.uriScheme}`], {
			cwd: cliPath,
		});
		output = output.replace(CLIProxyMCPConfigOutputs.checkingForUpdates, '').trim();

		try {
			const configuration = JSON.parse(output) as { name: string; type: string; command: string; args: string[] };

			this.notifySetupCompleted(cliInstall.version);

			return {
				name: configuration.name,
				type: configuration.type,
				command: configuration.command,
				args: configuration.args,
				version: cliInstall.version,
			};
		} catch (ex) {
			Logger.error(`Error getting MCP configuration: ${ex}`);
			this.notifySetupFailed('Error getting MCP configuration', undefined, cliInstall.version);
		}

		return undefined;
	}

	private notifySetupCompleted(cliVersion?: string | undefined) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent('mcp/registration/completed', {
			requiresUserCompletion: false,
			source: 'gk-mcp-provider',
			'cli.version': cliVersion,
		});
	}

	private notifySetupFailed(reason: string, message?: string | undefined, cliVersion?: string | undefined) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent('mcp/registration/failed', {
			reason: reason,
			'error.message': message,
			source: 'gk-mcp-provider',
			'cli.version': cliVersion,
		});
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}
}
