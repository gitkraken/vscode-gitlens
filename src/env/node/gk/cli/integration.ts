import type { ConfigurationChangeEvent } from 'vscode';
import { version as codeVersion, Disposable, env, ProgressLocation, window } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatLoggableScopeBlock, getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { compare } from '@gitlens/utils/version.js';
import { urls } from '../../../../constants.js';
import type { StoredGkCLIInstallInfo } from '../../../../constants.storage.js';
import type { Source, Sources } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import type { SubscriptionChangeEvent } from '../../../../plus/gk/subscriptionService.js';
import { mcpRegistrationAllowed } from '../../../../plus/gk/utils/-webview/mcp.utils.js';
import { executeCoreCommand, registerCommand } from '../../../../system/-webview/command.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { setContext } from '../../../../system/-webview/context.js';
import { openUrl } from '../../../../system/-webview/vscode/uris.js';
import { getHostAppName, isHostVSCode } from '../../../../system/-webview/vscode.js';
import { gate } from '../../../../system/decorators/gate.js';
import { getCliPublishInfo } from '../../ipc/ipcService.js';
import { isWeb } from '../../platform.js';
import type { GkAgent } from '../../../../agents/agentService.js';
import { BinaryInstaller } from './binaryInstaller.js';
import { CliCommandHandlers } from './commands.js';
import { CLIInstallError, CLIInstallErrorReason } from './errors.js';
import { showMcpAgentPicker } from './mcpAgentPicker.js';
import {
	clearResolvedCLIExecutableCache,
	getDevCLILocalPath,
	isInsidersCLIEnabled,
	resolveCLIExecutable,
	runCLICommand,
	showManualMcpSetupPrompt,
	toMcpInstallProvider,
} from './utils.js';

const enum McpSetupErrorReason {
	WebUnsupported,
	VSCodeVersionUnsupported,
	CLIUnsupportedPlatform,
	CLILocalInstallFailed,
	CLIBinaryLocked,
	CLIUnknownError,
	InstallationFailed,
	UnsupportedHost,
	UnsupportedClient,
	UnexpectedOutput,
	Offline,
}

export interface CliCommandRequest {
	cwd?: string;
	args?: string[];
}
export type CliCommandResponse = { stdout?: string; stderr?: string } | void;

const CLIProxyMCPInstallOutputs = {
	checkingForUpdates: /checking for updates.../i,
	notASupportedClient: /is not a supported MCP client/i,
	installedSuccessfully: /GitKraken MCP Server Successfully Installed!/i,
} as const;

const maxAutoInstallAttempts = 5;

export class GkCliIntegrationProvider implements Disposable {
	private readonly _disposable: Disposable;
	private readonly installer: BinaryInstaller;
	private _runningDisposable: Disposable | undefined;

	constructor(private readonly container: Container) {
		this.installer = new BinaryInstaller(container);

		// Defer the `gk version` probe out of the first-render window so the 1.5–2 s
		// subprocess doesn't contend with Graph/Home webview bootstrap on slower filesystems
		// (e.g. WSL). Still fully async; just lands a couple of seconds later.
		let deferredUpdate: ReturnType<typeof setTimeout> | undefined;
		this._disposable = Disposable.from(
			this.installer,
			configuration.onDidChange(e => this.onConfigurationChanged(e)),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			...this.registerCommands(),
			this.container.onReady(() => {
				this.onConfigurationChanged();
				deferredUpdate = setTimeout(() => {
					deferredUpdate = undefined;
					void this.ensureUpdateOrInstall();
				}, 3000);
			}),
			new Disposable(() => {
				if (deferredUpdate != null) {
					clearTimeout(deferredUpdate);
					deferredUpdate = undefined;
				}
			}),
		);
	}

	dispose(): void {
		this.stop();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (
			e != null &&
			(configuration.changed(e, 'gitkraken.cli.localPath') ||
				configuration.changed(e, 'gitkraken.cli.insiders.enabled'))
		) {
			clearResolvedCLIExecutableCache();
		}

		if (e == null || configuration.changed(e, 'ai.enabled')) {
			if (!this.supportsCliIntegration()) {
				this.stop();
			} else {
				void this.start();
			}
		}

		// Reinstall CLI when insiders setting changes (skip when using local CLI)
		if (e != null && configuration.changed(e, 'gitkraken.cli.insiders.enabled') && getDevCLILocalPath() == null) {
			const cliInstall = this.container.storage.getScoped('gk:cli:install');
			if (cliInstall?.status === 'completed') {
				// Force reinstall to switch between production and insiders
				Logger.info(
					`${formatLoggableScopeBlock('CLI')} Forcing CLI reinstall on settings change (insiders = ${isInsidersCLIEnabled()})`,
				);
				if (mcpRegistrationAllowed(this.container)) {
					void this.setupMCPCore('settings', true, true).catch(() => {});
				} else if (this.container.ai.enabled) {
					void this.installer.install(true, 'settings', true).catch(() => {});
				}
			}
		}
	}

	private supportsCliIntegration(): boolean {
		return this.container.ai.enabled;
	}

	@gate()
	private async start() {
		this.stop();

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

		// Fire `gk:cli:ipc:started` whenever the IPC server is up — even if the discovery
		// file write failed — so MCP providers don't sit idle for the 30s ipcWaitTime.
		if (this.container.ipc.address != null) {
			this.container.events.fire('gk:cli:ipc:started', {
				discoveryFilePath: this.container.ipc.cliDiscoveryFilePath,
			});
		}

		this._runningDisposable = Disposable.from(handlers, {
			dispose: () => void this.container.ipc.unpublishCli(),
		});
	}

	private stop() {
		if (this._runningDisposable != null) {
			this._runningDisposable.dispose();
			this._runningDisposable = undefined;
			Logger.info(`${formatLoggableScopeBlock('IPC')} CLI handlers stopped`);
		}
	}

	private async ensureUpdateOrInstall() {
		if (getDevCLILocalPath() != null) {
			Logger.info(`${formatLoggableScopeBlock('CLI')} Using local CLI binary — skipping auto-install/update`);
			void setContext('gitlens:gk:cli:installed', true);
			return;
		}

		let forceInstall = false;
		const versionDidChange = this.container.version !== this.container.previousVersion;

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status === 'completed') {
			// Verify the binary exists before spawning `gk version`.
			if (!(await resolveCLIExecutable())) {
				Logger.warn(`${formatLoggableScopeBlock('CLI')} CLI binary missing at startup — forcing reinstall`);
				forceInstall = true;
			} else {
				const { needsUpdate, core, proxy } = await this.installer.checkUpdateRequired();
				let currentCoreVersion = core;
				if (needsUpdate !== undefined) {
					Logger.info(
						`${formatLoggableScopeBlock('CLI')} CLI ${needsUpdate} version ${(needsUpdate === 'core' ? currentCoreVersion : proxy) ?? 'unknown'} is outdated, forcing reinstall`,
					);
					forceInstall = true;
				} else {
					// Only update if GitLens extension version has changed since last check, to avoid unnecessary update checks
					if (versionDidChange) {
						const updateResult = await this.installer.updateCore();
						if (updateResult?.current != null) {
							currentCoreVersion = updateResult.current;
						}
					}

					if (currentCoreVersion != null) {
						Logger.info(`${formatLoggableScopeBlock('CLI')} CLI core version is ${currentCoreVersion}`);
						void setContext('gitlens:gk:cli:installed', true);
						return;
					}
				}
			}
		}

		let didReachMaxAttempts = reachedMaxAttempts(cliInstall);

		// Reset the attempts count if GitLens extension version has changed
		if (forceInstall || (didReachMaxAttempts && versionDidChange)) {
			void this.container.storage.storeScoped('gk:cli:install', undefined);
			didReachMaxAttempts = false;
		}

		const shouldAutoInstall = mcpRegistrationAllowed(this.container);
		if (!forceInstall && didReachMaxAttempts) {
			return;
		}
		if (!shouldAutoInstall) {
			// CLI still powers hooks and agent dispatch even when MCP can't auto-register.
			if (this.container.ai.enabled) {
				void this.installer.install(true, 'gk-cli-integration', forceInstall).catch(() => {});
			}
			return;
		}

		// Setup MCP, but handle errors silently
		void this.setupMCPCore('gk-cli-integration', forceInstall, shouldAutoInstall).catch(() => {});
	}

	/**
	 * User-initiated MCP setup: installs the CLI and registers MCP for the current host IDE,
	 * then offers the user the option to connect additional agents.
	 *
	 * The auto-install path ({@link setupMCPCore}) also runs silently on startup to ensure
	 * MCP "just works" for the current IDE. This method adds the interactive agent selection
	 * on top of that.
	 */
	@gate()
	@debug({ exit: true })
	private async setupMCP(source?: Sources, force = false): Promise<void> {
		const scope = getScopedLogger();

		await this.container.onboarding.dismiss('mcp:banner');

		try {
			const result = await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'Setting up the GitKraken MCP...',
					cancellable: false,
				},
				async () => this.setupMCPCore(source, force),
			);

			if (result.requiresUserCompletion) {
				await openUrl(result.url);
				return;
			}

			const connectMore = { title: 'Connect More Agents' };
			const learnMore = { title: 'Learn More' };
			const confirm = { title: 'OK', isCloseAffordance: true };
			void window
				.showInformationMessage(
					'GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. You can also connect MCP to other agents on your machine.',
					connectMore,
					learnMore,
					confirm,
				)
				.then(r => {
					if (r === connectMore) {
						void this.selectAndInstallAgents(source);
					} else if (r === learnMore) {
						void openUrl(urls.helpCenterMCP);
					}
				});
		} catch (ex) {
			scope?.error(ex, `Error during MCP setup: ${ex instanceof Error ? ex.message : 'Unknown error'}`);
			// setupMCPCore already normalizes errors and sends failure telemetry before re-throwing,
			// so McpSetupError instances just need to be shown — don't double-track telemetry
			if (ex instanceof McpSetupError) {
				this.showSetupError(ex);
			} else {
				const normalized = this.normalizeAndTrackSetupError(ex, source ?? 'commandPalette');
				this.showSetupError(normalized);
			}
		}
	}

	@debug({ exit: true })
	private async setupMCPCore(
		source?: Sources,
		force = false,
		autoInstall = false,
	): Promise<{
		cliVersion?: string;
		requiresUserCompletion?: boolean;
		usingExtensionRegistration?: boolean;
		url?: string;
	}> {
		const scope = getScopedLogger();
		const commandSource = source ?? 'commandPalette';

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('mcp/setup/started', { source: commandSource });
		}

		try {
			if (isWeb) {
				scope?.addExitInfo('GitKraken MCP setup is not supported on the web');
				throw new McpSetupError(
					McpSetupErrorReason.WebUnsupported,
					'GitKraken MCP setup is not supported on the web.',
					'web environment unsupported',
					commandSource,
				);
			}

			const hostAppName = await getHostAppName();
			const usingExtensionRegistration = mcpRegistrationAllowed(this.container);

			if (!usingExtensionRegistration && isHostVSCode(hostAppName) && compare(codeVersion, '1.102') < 0) {
				throw new McpSetupError(
					McpSetupErrorReason.VSCodeVersionUnsupported,
					'GitKraken MCP setup requires VS Code 1.102 or later.',
					'unsupported vscode version',
					commandSource,
				);
			}

			const {
				cliVersion: installedVersion,
				cliPath: installedPath,
				status,
			} = await this.installer.install(autoInstall, source, force);

			if (status === 'unsupported') {
				throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform);
			} else if (status === 'attempted') {
				throw new CLIInstallError(CLIInstallErrorReason.CoreInstall);
			}

			const cliVersion = installedVersion;
			const cliPath = installedPath;

			if (cliPath == null) {
				scope?.setFailed('GitKraken MCP setup failed; installation failed');
				throw new McpSetupError(
					McpSetupErrorReason.InstallationFailed,
					'Unable to setup the GitKraken MCP: installation failed. Please try again.',
					'unknown error',
					commandSource,
					cliVersion,
					'Unknown error',
				);
			}

			// If MCP extension registration is supported, don't proceed with manual setup
			if (usingExtensionRegistration) {
				scope?.addExitInfo('supports provider-based MCP registration');
				// Send success telemetry
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/completed', {
						requiresUserCompletion: false,
						source: commandSource,
						'cli.version': cliVersion,
					});
				}

				this.container.events.fire('gk:cli:mcp:setup:completed', undefined);

				return {
					cliVersion: cliVersion,
					usingExtensionRegistration: true,
				};
			}

			const mcpInstallAppName = toMcpInstallProvider(hostAppName);
			if (mcpInstallAppName == null) {
				scope?.setFailed(`GitKraken MCP setup failed; unsupported host: ${hostAppName}`);
				throw new McpSetupError(
					McpSetupErrorReason.UnsupportedHost,
					'Automatic setup of the GitKraken MCP is not currently supported in this IDE. You may be able to configure it by adding the GitKraken MCP to your configuration manually.',
					'no app name',
					commandSource,
					cliVersion,
				);
			}

			scope?.trace(`Running MCP install command for ${mcpInstallAppName}`);
			let output = await runCLICommand(
				['mcp', 'install', mcpInstallAppName, '--source=gitlens', `--scheme=${env.uriScheme}`],
				{
					cwd: cliPath,
				},
			);

			output = output.replace(CLIProxyMCPInstallOutputs.checkingForUpdates, '').trim();
			if (CLIProxyMCPInstallOutputs.installedSuccessfully.test(output)) {
				scope?.addExitInfo(`(version: ${cliVersion})`);
				// Send success telemetry
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/completed', {
						requiresUserCompletion: false,
						source: commandSource,
						'cli.version': cliVersion,
					});
				}
				return {
					cliVersion: cliVersion,
				};
			} else if (CLIProxyMCPInstallOutputs.notASupportedClient.test(output)) {
				scope?.setFailed(`GitKraken MCP setup failed; unsupported host: ${hostAppName}`);
				throw new McpSetupError(
					McpSetupErrorReason.UnsupportedClient,
					'Automatic setup of the GitKraken MCP is not currently supported in this IDE. You should be able to configure it by adding the GitKraken MCP to your configuration manually.',
					'unsupported app',
					commandSource,
					cliVersion,
					`Not a supported MCP client: ${hostAppName}`,
				);
			}

			// Check if the output is a valid url. If so, run it
			try {
				new URL(output);
			} catch {
				scope?.setFailed(`GitKraken MCP setup failed; unexpected output from mcp install`);
				scope?.error(undefined, `Unexpected output from mcp install command: ${output}`);
				throw new McpSetupError(
					McpSetupErrorReason.UnexpectedOutput,
					'Unable to setup the GitKraken MCP. If this issue persists, please try adding the GitKraken MCP to your configuration manually.',
					'unexpected output from mcp install command',
					commandSource,
					cliVersion,
					`Unexpected output from mcp install command: ${output}`,
				);
			}

			scope?.addExitInfo(`requires user action (version: ${cliVersion})`);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/completed', {
					requiresUserCompletion: true,
					source: commandSource,
					'cli.version': cliVersion,
				});
			}
			return {
				cliVersion: cliVersion,
				requiresUserCompletion: true,
				url: output,
			};
		} catch (ex) {
			scope?.error(ex, `Error during MCP installation: ${ex}`);
			throw this.normalizeAndTrackSetupError(ex, commandSource);
		}
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id != null && e.current.account.id !== e.previous?.account?.id) {
			await this.installer.authCLI();
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.ai.mcp.install', (src?: Source) => this.setupMCP(src?.source)),
			registerCommand('gitlens.ai.mcp.reinstall', (src?: Source) => this.setupMCP(src?.source, true)),
			registerCommand('gitlens.ai.mcp.selectAgents', (src?: Source) => this.selectAndInstallAgents(src?.source)),
			registerCommand('gitlens.ai.mcp.authCLI', () => this.installer.authCLI()),
		];
	}

	@gate()
	@debug({ exit: true })
	private async selectAndInstallAgents(source?: Sources): Promise<void> {
		const scope = getScopedLogger();
		const commandSource = source ?? 'commandPalette';

		try {
			// Ensure CLI is installed first
			const { cliPath, status } = await this.installer.install(false, source);
			if (status !== 'completed' || cliPath == null) {
				void window.showWarningMessage(
					'GitKraken MCP requires the CLI to be installed first. Please run "Install GitKraken MCP Server" first.',
				);
				return;
			}

			await this.pickAndInstallAgents(cliPath, commandSource, true);
		} catch (ex) {
			scope?.error(ex, 'Error selecting and installing agents');
			const normalized = this.normalizeAndTrackSetupError(ex, commandSource);
			this.showSetupError(normalized);
		}
	}

	/** Shared core: shows agent picker, installs for selected agents, reports results. */
	private async pickAndInstallAgents(cliPath: string, source: Sources, showEmptyState = false): Promise<void> {
		const agents = await showMcpAgentPicker(cliPath, { showEmptyState: showEmptyState });
		if (agents == null || agents.length === 0) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('mcp/agents/selected', {
				source: source,
				'agents.count': agents.length,
				'agents.ids': agents.map(a => a.name).join(','),
			});
		}

		const results = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Installing GitKraken MCP for ${agents.length} agent${agents.length > 1 ? 's' : ''}...`,
				cancellable: false,
			},
			() => this.installMCPForAgents(agents, cliPath),
		);

		const requiresUserAction = results.requiresUserAction.length > 0;

		if (results.succeeded.length > 0 || requiresUserAction) {
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/completed', {
					requiresUserCompletion: requiresUserAction,
					source: source,
					'agents.succeeded': results.succeeded.join(',') || undefined,
					'agents.failed': results.failed.map(f => f.agent).join(',') || undefined,
					'agents.userAction': results.requiresUserAction.map(r => r.agent).join(',') || undefined,
				});
			}
		} else if (results.failed.length > 0 && this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('mcp/setup/failed', {
				reason: 'agent install failed',
				source: source,
				'agents.failed': results.failed.map(f => f.agent).join(','),
			});
		}

		for (const item of results.requiresUserAction) {
			void openUrl(item.url);
		}

		this.showAgentInstallResults(results);
	}

	@debug()
	private async installMCPForAgents(
		agents: GkAgent[],
		cliPath: string,
	): Promise<{
		succeeded: string[];
		failed: { agent: string; error: string }[];
		requiresUserAction: { agent: string; url: string }[];
	}> {
		const scope = getScopedLogger();
		const succeeded: string[] = [];
		const failed: { agent: string; error: string }[] = [];
		const requiresUserAction: { agent: string; url: string }[] = [];

		// Every inner promise catches its own errors, so all resolve — Promise.all is safe here
		const results = await Promise.all(
			agents.map(async agent => {
				try {
					Logger.debug(scope, `Installing MCP for agent '${agent.name}'...`);
					const output = await runCLICommand(
						['mcp', 'install', agent.name, '--source=gitlens', `--scheme=${env.uriScheme}`],
						{ cwd: cliPath },
					);

					const cleanOutput = output.replace(CLIProxyMCPInstallOutputs.checkingForUpdates, '').trim();
					// Empty output means success — the CLI suppresses the success message when --source=gitlens
					if (!cleanOutput || CLIProxyMCPInstallOutputs.installedSuccessfully.test(cleanOutput)) {
						Logger.debug(scope, `MCP install succeeded for agent '${agent.name}'`);
						return { agent: agent, status: 'succeeded' as const };
					} else if (CLIProxyMCPInstallOutputs.notASupportedClient.test(cleanOutput)) {
						Logger.warn(scope, `MCP install failed for agent '${agent.name}': not a supported client`);
						return { agent: agent, status: 'failed' as const, error: 'Not a supported MCP client' };
					}

					// Check if output is a URL requiring user action
					if (URL.canParse(cleanOutput)) {
						Logger.debug(
							scope,
							`MCP install for agent '${agent.name}' requires user action: ${cleanOutput}`,
						);
						return { agent: agent, status: 'userAction' as const, url: cleanOutput };
					}

					Logger.warn(
						scope,
						`MCP install failed for agent '${agent.name}': unexpected output: ${cleanOutput}`,
					);
					return {
						agent: agent,
						status: 'failed' as const,
						error: `Unexpected output: ${cleanOutput}`,
					};
				} catch (ex) {
					Logger.error(ex, scope, `MCP install failed for agent '${agent.name}'`);
					return {
						agent: agent,
						status: 'failed' as const,
						error: ex instanceof Error ? ex.message : 'Unknown error',
					};
				}
			}),
		);

		for (const result of results) {
			switch (result.status) {
				case 'succeeded':
					succeeded.push(result.agent.displayName);
					break;
				case 'failed':
					failed.push({ agent: result.agent.displayName, error: result.error });
					break;
				case 'userAction':
					requiresUserAction.push({ agent: result.agent.displayName, url: result.url });
					break;
			}
		}

		Logger.debug(
			scope,
			`MCP install results — succeeded: ${succeeded.length}, failed: ${failed.length}, userAction: ${requiresUserAction.length}`,
		);
		return { succeeded: succeeded, failed: failed, requiresUserAction: requiresUserAction };
	}

	private showAgentInstallResults(results: {
		succeeded: string[];
		failed: { agent: string; error: string }[];
		requiresUserAction: { agent: string; url: string }[];
	}): void {
		const parts: string[] = [];

		if (results.succeeded.length > 0) {
			parts.push(`Installed for ${results.succeeded.join(', ')}`);
		}
		if (results.failed.length > 0) {
			parts.push(`Failed for ${results.failed.map(f => f.agent).join(', ')}`);
		}
		if (results.requiresUserAction.length > 0) {
			parts.push(
				`${results.requiresUserAction.map(r => r.agent).join(', ')} require${results.requiresUserAction.length === 1 ? 's' : ''} manual setup`,
			);
		}

		const message = `GitKraken MCP: ${parts.join('. ')}.`;

		if (results.failed.length > 0) {
			void window.showWarningMessage(message);
		} else {
			void window.showInformationMessage(message);
		}
	}

	/**
	 * Converts CLI/setup errors into user-friendly McpSetupError instances and sends failure telemetry.
	 * Shared by both {@link setupMCP} and {@link setupMCPCore}.
	 */
	private normalizeAndTrackSetupError(ex: unknown, source: Sources, cliVersion?: string): McpSetupError {
		let normalized: McpSetupError;

		if (ex instanceof McpSetupError) {
			normalized = ex;
		} else if (ex instanceof CLIInstallError) {
			let reason: McpSetupErrorReason;
			let message: string;
			let telemetryReason: string;

			switch (ex.reason) {
				case CLIInstallErrorReason.UnsupportedPlatform:
					reason = McpSetupErrorReason.CLIUnsupportedPlatform;
					message = 'GitKraken MCP setup is not supported on this platform.';
					telemetryReason = 'unsupported platform';
					break;
				case CLIInstallErrorReason.ProxyExtractLocked:
					reason = McpSetupErrorReason.CLIBinaryLocked;
					message =
						"The GitKraken MCP server is currently running and can't be replaced while in use. Reload the VS Code window to stop it, then try Reinstall again. Reloading will close any unsaved editors.";
					telemetryReason = 'cli binary locked';
					break;
				case CLIInstallErrorReason.ProxyUrlFetch:
				case CLIInstallErrorReason.ProxyUrlFormat:
				case CLIInstallErrorReason.ProxyFetch:
				case CLIInstallErrorReason.ProxyDownload:
				case CLIInstallErrorReason.ProxyExtract:
				case CLIInstallErrorReason.CoreInstall:
				case CLIInstallErrorReason.GlobalStorageDirectory:
					reason = McpSetupErrorReason.CLILocalInstallFailed;
					message = 'Unable to locally install the GitKraken MCP server. Please try again.';
					telemetryReason = 'local installation failed';
					break;
				case CLIInstallErrorReason.Offline:
					reason = McpSetupErrorReason.Offline;
					message =
						'Unable to setup the GitKraken MCP server when offline. Please try again when you are online.';
					telemetryReason = 'offline';
					break;
				default:
					reason = McpSetupErrorReason.CLIUnknownError;
					message = 'Unable to setup the GitKraken MCP: Unknown error.';
					telemetryReason = 'unknown error';
					break;
			}

			normalized = new McpSetupError(reason, message, telemetryReason, source, cliVersion);
		} else {
			normalized = new McpSetupError(
				McpSetupErrorReason.CLIUnknownError,
				`Unable to setup the GitKraken MCP: ${ex instanceof Error ? ex.message : 'Unknown error'}`,
				'unknown error',
				source,
				cliVersion,
			);
		}

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('mcp/setup/failed', {
				reason: normalized.telemetryReason,
				'error.message': normalized.telemetryMessage ?? normalized.message,
				source: source,
				'cli.version': normalized.cliVersion,
			});
		}

		return normalized;
	}

	private showSetupError(ex: McpSetupError): void {
		switch (ex.reason) {
			case McpSetupErrorReason.WebUnsupported:
			case McpSetupErrorReason.VSCodeVersionUnsupported:
			case McpSetupErrorReason.Offline:
				void window.showWarningMessage(ex.message);
				break;
			case McpSetupErrorReason.CLIBinaryLocked: {
				const reload = { title: 'Reload Window' };
				const cancel = { title: 'Cancel', isCloseAffordance: true };
				void window.showErrorMessage(ex.message, reload, cancel).then(r => {
					if (r === reload) {
						void executeCoreCommand('workbench.action.reloadWindow');
					}
				});
				break;
			}
			case McpSetupErrorReason.InstallationFailed:
			case McpSetupErrorReason.CLIUnsupportedPlatform:
			case McpSetupErrorReason.CLILocalInstallFailed:
			case McpSetupErrorReason.CLIUnknownError:
				void window.showErrorMessage(ex.message);
				break;
			case McpSetupErrorReason.UnsupportedHost:
			case McpSetupErrorReason.UnsupportedClient:
			case McpSetupErrorReason.UnexpectedOutput:
				void showManualMcpSetupPrompt(ex.message);
				break;
			default:
				void window.showErrorMessage(ex.message);
				break;
		}
	}
}

function reachedMaxAttempts(cliInstall?: StoredGkCLIInstallInfo): boolean {
	return cliInstall?.status === 'attempted' && (cliInstall.attempts ?? 0) >= maxAutoInstallAttempts;
}

class McpSetupError extends Error {
	readonly reason: McpSetupErrorReason;
	readonly telemetryReason: string;
	readonly source: string;
	readonly cliVersion?: string;
	readonly telemetryMessage?: string;

	constructor(
		reason: McpSetupErrorReason,
		message: string,
		telemetryReason: string,
		source: string,
		cliVersion?: string,
		telemetryMessage?: string,
	) {
		super(message);
		this.reason = reason;
		this.telemetryReason = telemetryReason;
		this.source = source;
		this.cliVersion = cliVersion;
		this.telemetryMessage = telemetryMessage;
		Error.captureStackTrace?.(this, new.target);
	}
}
