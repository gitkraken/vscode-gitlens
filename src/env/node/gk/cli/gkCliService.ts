import type { ConfigurationChangeEvent, Disposable, Event } from 'vscode';
import { EventEmitter, Disposable as VsDisposable } from 'vscode';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatLoggableScopeBlock, getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Sources } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import type { SubscriptionChangeEvent } from '../../../../plus/gk/subscriptionService.js';
import { registerCommand } from '../../../../system/-webview/command.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { gate } from '../../../../system/decorators/gate.js';
import { getCliPublishInfo } from '../../ipc/ipcService.js';
import { CliBinaryInstaller } from './binaryInstaller.js';
import { CliCommandHandlers } from './commands.js';
import { clearResolvedCLIExecutableCache, getDevCLILocalPath, isInsidersCLIEnabled, runCLICommand } from './utils.js';

export interface CliCommandRequest {
	cwd?: string;
	args?: string[];
}
export type CliCommandResponse = { stdout?: string; stderr?: string } | void;

export interface CliInstallChangeEvent {
	status: 'completed' | 'attempted' | 'unsupported';
	version?: string;
	path?: string;
	source?: Sources;
}

export class GkCliService implements Disposable {
	private readonly _disposable: VsDisposable;
	private _runningDisposable: VsDisposable | undefined;
	private readonly _installer: CliBinaryInstaller;

	private readonly _onDidChangeInstall = new EventEmitter<CliInstallChangeEvent>();
	get onDidChangeInstall(): Event<CliInstallChangeEvent> {
		return this._onDidChangeInstall.event;
	}

	private readonly _onDidStartIpc = new EventEmitter<{ discoveryFilePath: string | undefined }>();
	get onDidStartIpc(): Event<{ discoveryFilePath: string | undefined }> {
		return this._onDidStartIpc.event;
	}

	constructor(private readonly container: Container) {
		this._installer = new CliBinaryInstaller(container);

		// Defer the `gk version` probe out of the first-render window so the 1.5–2 s
		// subprocess doesn't contend with Graph/Home webview bootstrap on slower filesystems
		// (e.g. WSL). Still fully async; just lands a couple of seconds later.
		let deferredUpdate: ReturnType<typeof setTimeout> | undefined;
		this._disposable = VsDisposable.from(
			this._installer,
			this._onDidChangeInstall,
			this._onDidStartIpc,
			configuration.onDidChange(e => this.onConfigurationChanged(e)),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			...this.registerCommands(),
			this.container.onReady(() => {
				this.onConfigurationChanged();
				deferredUpdate = setTimeout(() => {
					deferredUpdate = undefined;
					void this._installer
						.ensureUpdateOrInstall()
						.then(result => this.onInstallCompleted(result, 'gk-cli-integration'));
				}, 3000);
			}),
			new VsDisposable(() => {
				if (deferredUpdate != null) {
					clearTimeout(deferredUpdate);
					deferredUpdate = undefined;
				}
			}),
		);
	}

	dispose(): void {
		this.stopIpc();
		this._disposable.dispose();
	}

	// === Public API ===

	/** Low-level CLI invocation. Does NOT gate on install state. */
	run(args: string[], options?: { cwd?: string }): Promise<string> {
		return runCLICommand(args, options);
	}

	/** Triggers an install with custom options — used by command handlers that want fine-grained control over `force`/`autoInstall`. */
	async install(
		autoInstall?: boolean,
		source?: Sources,
		force = false,
	): Promise<{
		cliVersion?: string;
		cliPath?: string;
		status: 'completed' | 'unsupported' | 'attempted';
		changed: boolean;
	}> {
		const result = await this._installer.install(autoInstall, source, force);
		await this.onInstallCompleted(result, source);
		return result;
	}

	/**
	 * Post-install sequence, run only when a fresh install actually landed (`changed: true`): authenticate
	 * the new binary, then announce the change. Auth runs *before* the event fires so reactive consumers
	 * (notably GkMcpService) act on an already-authenticated CLI.
	 *
	 * No-op for short-circuit paths (`changed: false` — already installed, dev binary, up-to-date). Firing
	 * on those would feedback-loop with listeners like GkMcpService.setupCore, which re-invokes `install`.
	 */
	private async onInstallCompleted(
		result:
			| {
					cliVersion?: string;
					cliPath?: string;
					status: 'completed' | 'unsupported' | 'attempted';
					changed: boolean;
			  }
			| undefined,
		source?: Sources,
	): Promise<void> {
		if (result?.status !== 'completed' || !result.changed) return;

		await this.authenticate();
		this._onDidChangeInstall.fire({
			status: 'completed',
			version: result.cliVersion,
			path: result.cliPath,
			source: source,
		});
	}

	/** Authentication — also re-runs on subscription account change. */
	@trace()
	async authenticate(): Promise<void> {
		const scope = getScopedLogger();

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status !== 'completed') return;

		const currentSessionToken = (await this.container.subscription.getAuthenticationSession())?.accessToken;
		if (currentSessionToken == null) return;

		try {
			await runCLICommand(['auth', 'login', '-t', currentSessionToken]);
		} catch (ex) {
			debugger;
			scope?.error(ex, 'Failed to authenticate CLI');
		}
	}

	// === Private lifecycle ===

	private onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (
			e != null &&
			(configuration.changed(e, 'gitkraken.cli.localPath') ||
				configuration.changed(e, 'gitkraken.cli.insiders.enabled'))
		) {
			clearResolvedCLIExecutableCache();
		}

		if (e == null || configuration.changed(e, 'ai.enabled')) {
			if (!this.container.ai.enabled) {
				this.stopIpc();
			} else {
				void this.startIpc();
			}
		}

		// Reinstall CLI when insiders setting changes (skip when using local CLI)
		if (e != null && configuration.changed(e, 'gitkraken.cli.insiders.enabled') && getDevCLILocalPath() == null) {
			const cliInstall = this.container.storage.getScoped('gk:cli:install');
			if (cliInstall?.status === 'completed') {
				Logger.info(
					`${formatLoggableScopeBlock('CLI')} Forcing CLI reinstall on settings change (insiders = ${isInsidersCLIEnabled()})`,
				);
				// Force reinstall — MCP service reacts via onDidChangeInstall and re-runs setup when allowed
				void this.install(true, 'settings', true).catch(() => undefined);
			}
		}
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id != null && e.current.account.id !== e.previous?.account?.id) {
			await this.authenticate();
		}
	}

	@gate()
	private async startIpc(): Promise<void> {
		this.stopIpc();

		// Register CLI handlers on the shared IPC server.
		const handlers = new CliCommandHandlers(this.container);

		// Publish the CLI discovery file (writes the file at the cli dir).
		try {
			await this.container.ipc.publishCli(await getCliPublishInfo());
		} catch (ex) {
			Logger.warn(`${formatLoggableScopeBlock('IPC')} Failed to publish CLI discovery: ${ex}`);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/discoveryFile/failed', {
					'error.message': ex instanceof Error ? ex.message : 'Unknown error',
				});
			}
		}

		// Fire onDidStartIpc whenever the IPC server is up — even if the discovery
		// file write failed — so MCP providers don't sit idle for the 30s ipcWaitTime.
		if (this.container.ipc.address != null) {
			this._onDidStartIpc.fire({ discoveryFilePath: this.container.ipc.cliDiscoveryFilePath });
		}

		this._runningDisposable = VsDisposable.from(handlers, {
			dispose: () => void this.container.ipc.unpublishCli(),
		});
	}

	private stopIpc(): void {
		if (this._runningDisposable != null) {
			this._runningDisposable.dispose();
			this._runningDisposable = undefined;
			Logger.info(`${formatLoggableScopeBlock('IPC')} CLI handlers stopped`);
		}
	}

	private registerCommands(): Disposable[] {
		return [registerCommand('gitlens.ai.mcp.authCLI', () => this.authenticate())];
	}
}
