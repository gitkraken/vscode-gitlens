import type { Event, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { Disposable, env, EventEmitter, lm, McpStdioServerDefinition } from 'vscode';
import type { Container } from '../../../../container';
import type { StorageChangeEvent } from '../../../../system/-webview/storage';
import { getHostAppName } from '../../../../system/-webview/vscode';
import { debug, log } from '../../../../system/decorators/log';
import type { Deferrable } from '../../../../system/function/debounce';
import { debounce } from '../../../../system/function/debounce';
import { Logger } from '../../../../system/logger';
import { runCLICommand, toMcpInstallProvider } from '../cli/utils';

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

type McpConfiguration = { name: string; type: string; command: string; args: string[]; version?: string };

export class GkMcpProvider implements McpServerDefinitionProvider, Disposable {
	private _cliVersion: string | undefined;
	private readonly _disposable: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	private _fireChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _getMcpConfigurationFromCLIPromise: Promise<McpConfiguration | undefined> | undefined;

	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this.container.storage.onDidChange(e => this.onStorageChanged(e)),
			lm.registerMcpServerDefinitionProvider('gitlens.gkMcpProvider', this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.workspace || !e.keys.includes('gk:cli:install')) return;

		// Only refresh if installation is completed
		const cliInstall = this.container.storage.get('gk:cli:install');
		if (cliInstall?.status !== 'completed') {
			return;
		}

		// Invalidate configuration promise if the version changed
		if (this._cliVersion !== cliInstall?.version) {
			this._getMcpConfigurationFromCLIPromise = undefined;
		}
		this._cliVersion = cliInstall?.version;

		this._fireChangeDebounced ??= debounce(() => {
			this._onDidChangeMcpServerDefinitions.fire();
		}, 500);
		this._fireChangeDebounced();
	}

	@log({ exit: true })
	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const config = await this.getMcpConfigurationFromCLI();
		if (config == null) return [];

		const serverDefinition = new McpStdioServerDefinition(
			config.name,
			config.command,
			config.args,
			{},
			config.version,
		);

		return [serverDefinition];
	}

	@log()
	private getMcpConfigurationFromCLI(): Promise<McpConfiguration | undefined> {
		this._getMcpConfigurationFromCLIPromise ??= this.getMcpConfigurationFromCLICore();
		return this._getMcpConfigurationFromCLIPromise;
	}

	@debug()
	private async getMcpConfigurationFromCLICore(): Promise<McpConfiguration | undefined> {
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
			const config: McpConfiguration = JSON.parse(output);

			this.onRegistrationCompleted(cliInstall.version);

			return {
				name: config.name,
				type: config.type,
				command: config.command,
				args: config.args,
				version: cliInstall.version,
			};
		} catch (ex) {
			Logger.error(`Error getting MCP configuration: ${ex}`);
			this.onRegistrationFailed('Error getting MCP configuration', undefined, cliInstall.version);
		}

		return undefined;
	}

	private onRegistrationCompleted(_cliVersion?: string | undefined) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.setGlobalAttribute('gk.mcp.registrationCompleted', true);
	}

	private onRegistrationFailed(reason: string, message?: string | undefined, cliVersion?: string | undefined) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent('mcp/registration/failed', {
			reason: reason,
			'error.message': message,
			source: 'gk-mcp-provider',
			'cli.version': cliVersion,
		});
	}
}
