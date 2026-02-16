import type { Event, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { Disposable, env, EventEmitter, lm, McpStdioServerDefinition } from 'vscode';
import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { StorageChangeEvent } from '../../../../system/-webview/storage.js';
import { getHostAppName } from '../../../../system/-webview/vscode.js';
import { debug, trace } from '../../../../system/decorators/log.js';
import type { Deferrable } from '../../../../system/function/debounce.js';
import { debounce } from '../../../../system/function/debounce.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { runCLICommand, toMcpInstallProvider } from '../cli/utils.js';

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

type McpConfiguration = { name: string; type: string; command: string; args: string[]; version?: string };

const ipcWaitTime = 30000; // 30 seconds

export class GkMcpProvider implements McpServerDefinitionProvider, Disposable {
	private readonly _disposable: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	private _fireChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _getMcpConfigurationFromCLIPromise: Promise<McpConfiguration | undefined> | undefined;

	private _ipcTimeoutId: NodeJS.Timeout | undefined;
	private _hasProvidedDefinition: boolean = false;
	private _waitingForIPC: boolean = true;

	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this.container.storage.onDidChange(e => this.onStorageChanged(e)),
			this.container.events.on('gk:cli:ipc:started', () => this.onIpcServerStarted()),
			this.container.events.on('gk:cli:mcp:setup:completed', () => this.onMcpSetupCompleted()),
			lm.registerMcpServerDefinitionProvider('gitlens.gkMcpProvider', this),
		);

		this._ipcTimeoutId = setTimeout(() => this.onIpcTimeoutExpired(), ipcWaitTime);
	}

	private clearIpcTimeout(): void {
		this._waitingForIPC = false;
		if (this._ipcTimeoutId == null) return;

		clearTimeout(this._ipcTimeoutId);
		this._ipcTimeoutId = undefined;
	}

	dispose(): void {
		this.clearIpcTimeout();
		this._disposable.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.type !== 'scoped' || !e.keys.includes('gk:cli:install')) return;

		// Only refresh if installation is completed
		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status !== 'completed') {
			return;
		}

		// Always invalidate on any completion (including same-version reinstall, where a prior
		// failed mcp config result would otherwise be served from cache forever)
		this._getMcpConfigurationFromCLIPromise = undefined;

		this.fireChange();
	}

	private onIpcServerStarted(): void {
		this.clearIpcTimeout();

		// Fire change event to refresh MCP server definitions now that GK_GL_ADDR is available
		this.fireChange();
	}

	private onMcpSetupCompleted(): void {
		this._getMcpConfigurationFromCLIPromise = undefined;
		this.fireChange(true);
	}

	private onIpcTimeoutExpired(): void {
		this.clearIpcTimeout();

		if (!this._hasProvidedDefinition) {
			this.fireChange(true);
		}
	}

	private fireChange(immediate: boolean = false) {
		if (immediate) {
			this._onDidChangeMcpServerDefinitions.fire();
			return;
		}

		this._fireChangeDebounced ??= debounce(() => {
			this._onDidChangeMcpServerDefinitions.fire();
		}, 500);
		this._fireChangeDebounced();
	}

	@debug({ exit: true })
	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const { environmentVariableCollection: envVars } = this.container.context;
		const discoveryFilePath = envVars.get('GK_GL_PATH')?.value;

		// Gives time for the IPC server to start and set the environment variables
		if (discoveryFilePath != null) {
			this.clearIpcTimeout();
		} else if (this._waitingForIPC) {
			return [];
		}

		const config = await this.getMcpConfigurationFromCLI();
		if (config == null) return [];

		if (!this._hasProvidedDefinition) {
			// Mark that we've provided a definition (either with or without GK_GL_PATH)
			this._hasProvidedDefinition = true;
			// Track usage for walkthrough completion
			void this.container.usage.track('action:gitlens.mcp.bundledMcpDefinitionProvided:happened');
		}

		const serverEnv: McpStdioServerDefinition['env'] = {};
		if (discoveryFilePath != null) {
			serverEnv['GK_GL_PATH'] = discoveryFilePath;
		}

		const serverDefinition = new McpStdioServerDefinition(
			config.name,
			config.command,
			config.args,
			serverEnv,
			config.version,
		);

		return [serverDefinition];
	}

	@debug()
	private getMcpConfigurationFromCLI(): Promise<McpConfiguration | undefined> {
		this._getMcpConfigurationFromCLIPromise ??= this.getMcpConfigurationFromCLICore();
		return this._getMcpConfigurationFromCLIPromise;
	}

	@trace()
	private async getMcpConfigurationFromCLICore(): Promise<McpConfiguration | undefined> {
		const scope = getScopedLogger();

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		const cliPath = this.container.storage.getScoped('gk:cli:path');

		if (cliInstall?.status !== 'completed' || !cliPath) {
			scope?.warn(
				`CLI not ready — install.status=${cliInstall?.status ?? 'undefined'}, cliPath=${cliPath ? 'set' : 'missing'}`,
			);
			return undefined;
		}

		const appName = toMcpInstallProvider(await getHostAppName());
		if (appName == null) {
			scope?.warn(`Unsupported host app — hostAppName=${await getHostAppName()}`);
			return undefined;
		}

		try {
			const args = ['mcp', 'config', appName, '--source=gitlens', `--scheme=${env.uriScheme}`];
			if (configuration.get('gitkraken.cli.insiders.enabled')) {
				args.push('--insiders');
			}

			let output = await runCLICommand(args, { cwd: cliPath });
			output = output.replace(CLIProxyMCPConfigOutputs.checkingForUpdates, '').trim();

			const config: McpConfiguration = JSON.parse(output);
			if (!config.type || !config.command || !Array.isArray(config.args)) {
				throw new Error(`Invalid MCP configuration: missing required properties (${output})`);
			}

			this.onRegistrationCompleted(cliInstall.version);

			return {
				name: config.name ?? 'GitKraken',
				type: config.type,
				command: config.command,
				args: config.args,
				version: cliInstall.version,
			};
		} catch (ex) {
			debugger;
			scope?.error(ex, `Error getting MCP configuration`);
			this.onRegistrationFailed('Error getting MCP configuration', String(ex), cliInstall.version);
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
