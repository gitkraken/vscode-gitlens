import { commands, Disposable, env } from 'vscode';
import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { StorageChangeEvent } from '../../../../system/-webview/storage.js';
import { getHostAppName } from '../../../../system/-webview/vscode.js';
import { debug, trace } from '../../../../system/decorators/log.js';
import type { Deferrable } from '../../../../system/function/debounce.js';
import { debounce } from '../../../../system/function/debounce.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { RunError } from '../../git/shell.errors.js';
import { runCLICommand, toMcpInstallProvider } from '../cli/utils.js';

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

type McpConfiguration = { name: string; type: string; command: string; args: string[]; version?: string };

const ipcWaitTime = 30000; // 30 seconds

export abstract class GkMcpProviderBase implements Disposable {
	private readonly _disposable: Disposable;
	protected _fireChangeDebounced: Deferrable<() => void> | undefined = undefined;
	protected _getMcpConfigurationFromCLIPromise: Promise<McpConfiguration | undefined> | undefined;
	protected _ipcTimeoutId: NodeJS.Timeout | undefined;
	protected _waitingForIPC: boolean = true;

	constructor(protected readonly container: Container) {
		this._disposable = Disposable.from(
			container.storage.onDidChange(e => this.onStorageChanged(e)),
			container.events.on('gk:cli:ipc:started', () => this.onIpcServerStarted()),
			container.events.on('gk:cli:mcp:setup:completed', () => this.onMcpSetupCompleted()),
		);
		this._ipcTimeoutId = setTimeout(() => this.onIpcTimeoutExpired(), ipcWaitTime);
	}

	dispose(): void {
		this.clearIpcTimeout();
		this._disposable.dispose();
		this.onDispose();
	}

	protected abstract onDispose(): void;

	protected clearIpcTimeout(): void {
		this._waitingForIPC = false;
		if (this._ipcTimeoutId == null) return;

		clearTimeout(this._ipcTimeoutId);
		this._ipcTimeoutId = undefined;
	}

	protected onStorageChanged(e: StorageChangeEvent): void {
		if (e.type !== 'scoped' || !e.keys.includes('gk:cli:install')) return;

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status !== 'completed') return;

		// Always invalidate on any completion (including same-version reinstall, where a prior
		// failed mcp config result would otherwise be served from cache forever)
		this._getMcpConfigurationFromCLIPromise = undefined;

		this.fireChange();
	}

	protected onIpcServerStarted(): void {
		this.clearIpcTimeout();
		this.fireChange();
	}

	protected onMcpSetupCompleted(): void {
		this._getMcpConfigurationFromCLIPromise = undefined;
		this.fireChange(true);
	}

	protected onIpcTimeoutExpired(): void {
		this.clearIpcTimeout();
		if (this.shouldFireOnTimeout()) {
			this.fireChange(true);
		}
	}

	protected shouldFireOnTimeout(): boolean {
		return true;
	}

	protected abstract fireChangeCore(): void;

	protected fireChange(immediate: boolean = false): void {
		if (immediate) {
			this.fireChangeCore();
			return;
		}

		this._fireChangeDebounced ??= debounce(() => this.fireChangeCore(), 500);
		this._fireChangeDebounced();
	}

	@debug()
	protected getMcpConfigurationFromCLI(): Promise<McpConfiguration | undefined> {
		this._getMcpConfigurationFromCLIPromise ??= this.getMcpConfigurationFromCLICore().then(
			config => {
				if (config == null) {
					this._getMcpConfigurationFromCLIPromise = undefined;
				}
				return config;
			},
			(ex: unknown) => {
				this._getMcpConfigurationFromCLIPromise = undefined;
				throw ex;
			},
		);
		return this._getMcpConfigurationFromCLIPromise;
	}

	@trace()
	protected async getMcpConfigurationFromCLICore(): Promise<McpConfiguration | undefined> {
		const scope = getScopedLogger();

		const cliInstall = this.container.storage.getScoped('gk:cli:install');

		if (cliInstall?.status !== 'completed') {
			scope?.warn(`CLI not ready — install.status=${cliInstall?.status ?? 'undefined'}`);
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

			let output = await runCLICommand(args);
			output = output.replace(CLIProxyMCPConfigOutputs.checkingForUpdates, '').trim();

			let config: McpConfiguration;
			try {
				config = JSON.parse(output) as McpConfiguration;
			} catch (parseEx) {
				// The CLI returned non-JSON output. Log the raw output so the real error is visible.
				scope?.error(
					parseEx,
					`MCP config command returned non-JSON output (CLI ${cliInstall.version}): ${output.slice(0, 500)}`,
				);
				throw new Error(`Invalid MCP config output from CLI ${cliInstall.version}: ${String(parseEx)}`);
			}

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

			// If the CLI binary is missing mid-session, automatically reinstall it.
			if (ex instanceof RunError && ex.code === 'ENOENT') {
				void commands.executeCommand('gitlens.ai.mcp.reinstall', { source: 'gk-mcp-provider' });
			}

			const errorDetail = ex instanceof RunError && ex.stderr ? ex.stderr.trim() : String(ex);
			this.onRegistrationFailed('Error getting MCP configuration', errorDetail, cliInstall.version);
		}

		return undefined;
	}

	protected onRegistrationCompleted(_cliVersion?: string | undefined): void {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.setGlobalAttribute('gk.mcp.registrationCompleted', true);
	}

	protected onRegistrationFailed(
		reason: string,
		message?: string | undefined,
		cliVersion?: string | undefined,
	): void {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent('mcp/registration/failed', {
			reason: reason,
			'error.message': message,
			source: 'gk-mcp-provider',
			'cli.version': cliVersion,
		});
	}
}
