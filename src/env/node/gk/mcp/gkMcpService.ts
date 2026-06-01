import type { ConfigurationChangeEvent, Disposable, Event } from 'vscode';
import {
	version as codeVersion,
	commands,
	env,
	EventEmitter,
	ProgressLocation,
	Disposable as VsDisposable,
	window,
} from 'vscode';
import { RunError } from '@gitlens/git-cli/exec/exec.errors.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { compare } from '@gitlens/utils/version.js';
import { getIsOffline, isWeb } from '@env/platform.js';
import { urls } from '../../../../constants.js';
import type { Source, Sources } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { executeCoreCommand, registerCommand } from '../../../../system/-webview/command.js';
import type { StorageChangeEvent } from '../../../../system/-webview/storage.js';
import { openUrl } from '../../../../system/-webview/vscode/uris.js';
import { getHostAppName, isHostVSCode } from '../../../../system/-webview/vscode.js';
import { gate } from '../../../../system/decorators/gate.js';
import {
	supportsCursorMcpRegistration,
	supportsMcpExtensionRegistration,
} from '../../../../plus/gk/utils/-webview/mcp.utils.js';
import type { GkAgent } from '../../../../agents/agentService.js';
import { CLIInstallError, CLIInstallErrorReason } from '../cli/errors.js';
import type { CliInstallChangeEvent } from '../cli/gkCliService.js';
import { McpSetupError, McpSetupErrorReason } from './errors.js';
import { CursorMcpHostProvider } from './hostProviders/cursorMcpHostProvider.js';
import type { McpHostRegistrationProvider } from './hostProviders/types.js';
import { VSCodeMcpHostProvider } from './hostProviders/vscodeMcpHostProvider.js';
import { showMcpAgentPicker } from './mcpAgentPicker.js';
import { showManualMcpSetupPrompt, toMcpInstallProvider } from './utils.js';

const ipcWaitTime = 30000; // 30 seconds

const CLIProxyMCPInstallOutputs = {
	checkingForUpdates: /checking for updates.../i,
	notASupportedClient: /is not a supported MCP client/i,
	installedSuccessfully: /GitKraken MCP Server Successfully Installed!/i,
} as const;

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

interface McpServerConfig {
	name: string;
	type: string;
	command: string;
	args: string[];
	version?: string;
}

type McpInstallResult =
	| { kind: 'succeeded' }
	| { kind: 'unsupported' }
	| { kind: 'userAction'; url: string }
	| { kind: 'unexpected'; output: string };

/** Classifies the output of `gk mcp install ...`. Shared by host setup (`setupCore`) and per-agent
 *  install (`installMCPForAgents`) so the two paths interpret the CLI's output identically — notably
 *  that empty output means success (the CLI suppresses the success banner when `--source=gitlens`). */
function classifyMcpInstallOutput(output: string): McpInstallResult {
	const cleaned = output.replace(CLIProxyMCPInstallOutputs.checkingForUpdates, '').trim();
	if (!cleaned || CLIProxyMCPInstallOutputs.installedSuccessfully.test(cleaned)) {
		return { kind: 'succeeded' };
	}
	if (CLIProxyMCPInstallOutputs.notASupportedClient.test(cleaned)) {
		return { kind: 'unsupported' };
	}
	if (URL.canParse(cleaned)) {
		return { kind: 'userAction', url: cleaned };
	}
	return { kind: 'unexpected', output: cleaned };
}

export class GkMcpService implements Disposable {
	private readonly _disposable: VsDisposable;
	private _activeProvider: McpHostRegistrationProvider | undefined;

	private _mcpConfigPromise: Promise<McpServerConfig | undefined> | undefined;
	private _discoveryFilePath: string | undefined;
	private _ipcTimeoutId: NodeJS.Timeout | undefined;
	private _waitingForIPC = true;

	private _fireRefreshDebounced: Deferrable<() => void> | undefined;

	private readonly _onDidCompleteSetup = new EventEmitter<{ source: Sources; cliVersion?: string }>();
	get onDidCompleteSetup(): Event<{ source: Sources; cliVersion?: string }> {
		return this._onDidCompleteSetup.event;
	}

	constructor(private readonly container: Container) {
		// Construction order contract: `container.gkCli` MUST be constructed before `container.gkMcp`
		// (enforced today by the eager-construct order in container.ts). MCP subscribes to CLI events
		// here; a lazy/reorder of those getters would silently break startup install reactions.
		// GkMcpService is only constructed in Node — container.gkCli is always defined here.
		// The non-null assertion satisfies the typed union (`GkCliService | undefined`) for browser builds.
		const cliService = container.gkCli!;

		this._disposable = VsDisposable.from(
			this._onDidCompleteSetup,
			cliService.onDidChangeInstall(e => this.onCliInstallChanged(e)),
			cliService.onDidStartIpc(e => this.onIpcServerStarted(e)),
			container.storage.onDidChange(e => this.onStorageChanged(e)),
			configuration.onDidChange(e => this.onConfigurationChanged(e)),
			// Register the host adapter (and start the 30s IPC-wait timer) only once the container is
			// ready AND the user/admin has opted in — never at eager construction. This gates
			// registration on `isRegistrationAllowed` (so a `gitkraken.mcp.autoEnabled=false` opt-out is
			// honored) and keeps the IPC timer aligned with the old ready()-time start.
			container.onReady(() => this.ensureRegistration()),
			...this.registerCommands(),
		);
	}

	dispose(): void {
		this.disposeActiveProvider();
		this._disposable.dispose();
	}

	/** GkMcpService is only constructed in Node — container.gkCli is always defined here.
	 *  This narrowing helper avoids `!` assertions at every call site. */
	private get gkCli(): NonNullable<Container['gkCli']> {
		return this.container.gkCli!;
	}

	// === Public API ===

	/** True iff the running host can register MCP via an extension API AND the user/admin enabled it. */
	get isRegistrationAllowed(): boolean {
		if (!this.isRegistrationEnabled) return false;
		return supportsMcpExtensionRegistration() || supportsCursorMcpRegistration();
	}

	/** True iff `gitkraken.mcp.autoEnabled` + `ai.enabled` are both on (and not web/offline). */
	get isRegistrationEnabled(): boolean {
		if (isWeb || getIsOffline()) return false;

		return this.container.ai.enabled && configuration.get('gitkraken.mcp.autoEnabled');
	}

	// === Internal API for host adapters ===

	get discoveryFilePath(): string | undefined {
		return this._discoveryFilePath;
	}

	get isWaitingForIpc(): boolean {
		return this._waitingForIPC;
	}

	clearIpcTimeout(): void {
		this._waitingForIPC = false;
		if (this._ipcTimeoutId == null) return;

		clearTimeout(this._ipcTimeoutId);
		this._ipcTimeoutId = undefined;
	}

	/** Fetches the MCP config from the CLI. Cached per-result, invalidated by storage / settings changes. */
	@debug()
	getMcpConfig(): Promise<McpServerConfig | undefined> {
		this._mcpConfigPromise ??= this.getMcpConfigCore().then(
			config => {
				if (config == null) {
					this._mcpConfigPromise = undefined;
				}
				return config;
			},
			(ex: unknown) => {
				this._mcpConfigPromise = undefined;
				throw ex;
			},
		);
		return this._mcpConfigPromise;
	}

	// === Private lifecycle / orchestration ===

	/**
	 * Creates or tears down the host registration adapter to match `isRegistrationAllowed`.
	 *
	 * Called at ready() and whenever `ai.enabled` / `gitkraken.mcp.autoEnabled` change. Toggling the
	 * opt-in off disposes the active provider (VS Code: unregisters the definition provider; Cursor:
	 * unregisters the server), and toggling it back on re-registers — so the setting takes effect
	 * without a window reload.
	 */
	private ensureRegistration(): void {
		if (this.isRegistrationAllowed) {
			if (this._activeProvider != null) return;

			// `isRegistrationAllowed` guarantees one of these host capabilities is present.
			this._activeProvider = supportsMcpExtensionRegistration()
				? new VSCodeMcpHostProvider(this.container, this)
				: new CursorMcpHostProvider(this.container, this);
			this.startIpcTimeout();
		} else {
			this.disposeActiveProvider();
		}
	}

	private startIpcTimeout(): void {
		// Only wait if IPC hasn't already started (e.g. on a re-registration after the IPC server is up).
		if (!this._waitingForIPC || this._ipcTimeoutId != null) return;

		this._ipcTimeoutId = setTimeout(() => this.onIpcTimeoutExpired(), ipcWaitTime);
	}

	private disposeActiveProvider(): void {
		// Clear the timer handle without resetting `_waitingForIPC` — a later re-registration should
		// resume waiting if IPC still hasn't started.
		if (this._ipcTimeoutId != null) {
			clearTimeout(this._ipcTimeoutId);
			this._ipcTimeoutId = undefined;
		}
		this._activeProvider?.dispose();
		this._activeProvider = undefined;
	}

	private async getMcpConfigCore(): Promise<McpServerConfig | undefined> {
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
			if (configuration.get('gitkraken.mcp.experimental.enabled')) {
				args.push('--experimental');
			}
			let output = await this.gkCli.run(args);
			output = output.replace(CLIProxyMCPConfigOutputs.checkingForUpdates, '').trim();

			const config = this.parseMcpConfigOutput(output, cliInstall.version, scope);

			this.onRegistrationCompleted();

			return config;
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

	private parseMcpConfigOutput(
		output: string,
		cliVersion: string | undefined,
		scope: ReturnType<typeof getScopedLogger>,
	): McpServerConfig {
		let parsed: McpServerConfig;
		try {
			parsed = JSON.parse(output) as McpServerConfig;
		} catch (parseEx) {
			const outputToLog = output.slice(0, 500);
			// Log the raw (truncated) non-JSON output with the parse error before rethrowing, so field
			// diagnosis of CLI-output regressions isn't reduced to a wrapped message.
			scope?.error(parseEx, `MCP config command returned non-JSON output (CLI ${cliVersion}): ${outputToLog}`);
			throw new Error(`Invalid MCP config output from CLI ${cliVersion}: ${outputToLog}`, { cause: parseEx });
		}

		if (!parsed.type || !parsed.command || !Array.isArray(parsed.args)) {
			throw new Error(`Invalid MCP configuration: missing required properties (${output})`);
		}

		return {
			name: parsed.name ?? 'GitKraken',
			type: parsed.type,
			command: parsed.command,
			args: parsed.args,
			version: cliVersion,
		};
	}

	private onRegistrationCompleted(): void {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.setGlobalAttribute('gk.mcp.registrationCompleted', true);
	}

	private onRegistrationFailed(reason: string, message?: string | undefined, cliVersion?: string | undefined): void {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent('mcp/registration/failed', {
			reason: reason,
			'error.message': message,
			source: 'gk-mcp-provider',
			'cli.version': cliVersion,
		});
	}

	private onCliInstallChanged(e: CliInstallChangeEvent): void {
		if (e.status !== 'completed') return;

		this._mcpConfigPromise = undefined;

		if (this.isRegistrationAllowed) {
			// Self-heal: if registration was skipped at ready() (e.g. transiently offline) but is now
			// allowed, create the provider before pushing setup.
			this.ensureRegistration();
			void this.setupCore(e.source ?? 'gk-cli-integration', false, true).catch(() => undefined);
		}
	}

	private onIpcServerStarted(e: { discoveryFilePath: string | undefined }): void {
		this._discoveryFilePath = e.discoveryFilePath;
		this.clearIpcTimeout();
		this.fireRefresh(false);
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.type !== 'scoped' || !e.keys.includes('gk:cli:install')) return;

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status !== 'completed') return;

		// Always invalidate on any completion (including same-version reinstall, where a prior
		// failed mcp config result would otherwise be served from cache forever)
		this._mcpConfigPromise = undefined;
		this.fireRefresh(false);
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent): void {
		if (configuration.changed(e, 'gitkraken.mcp.experimental.enabled')) {
			this._mcpConfigPromise = undefined;
			this.fireRefresh(true);
		}
		if (configuration.changed(e, 'gitkraken.mcp.autoEnabled') || configuration.changed(e, 'ai.enabled')) {
			// Register or unregister the host adapter to match the new opt-in state.
			this.ensureRegistration();
			if (this.isRegistrationAllowed) {
				void this.setupCore('settings', false, true).catch(() => undefined);
			}
		}
	}

	private onIpcTimeoutExpired(): void {
		this.clearIpcTimeout();
		// For VS Code: only fire if we haven't yet provided a definition (avoid spurious pulls)
		if (this._activeProvider instanceof VSCodeMcpHostProvider) {
			if (this._activeProvider.hasProvidedDefinition) return;
		}

		this.fireRefresh(true);
	}

	private fireRefresh(immediate: boolean): void {
		if (this._activeProvider == null) return;

		if (immediate) {
			// Drop any pending debounced refresh so the host adapter doesn't get hit twice
			// (e.g. when `onStorageChanged` schedules a debounced refresh and `setupCore`
			// then fires an immediate one on the same install completion).
			this._fireRefreshDebounced?.cancel();
			void this._activeProvider.refresh();
			return;
		}

		this._fireRefreshDebounced ??= debounce(() => void this._activeProvider?.refresh(), 500);
		this._fireRefreshDebounced();
	}

	/**
	 * Core setup orchestrator. Installs the CLI, then either registers MCP via the active host
	 * adapter (extension registration path) or returns a manual-setup URL.
	 *
	 * Called from:
	 * - the `gitlens.ai.mcp.install` / `reinstall` command handlers (interactive)
	 * - the `onCliInstallChanged` reactive listener (silent: true)
	 * - the `gitkraken.mcp.autoEnabled` configuration change handler (silent: true)
	 */
	@gate()
	@debug({ exit: true })
	private async setupCore(
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
			const usingExtensionRegistration = this.isRegistrationAllowed;

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
			} = await this.gkCli.install(autoInstall, source, force);

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

				// Push the new registration to the host adapter so it takes effect.
				// We do NOT invalidate `_mcpConfigPromise` here — `onStorageChanged` already
				// invalidates it on a real install transition. `fireRefresh(true)` below also
				// cancels any debounced refresh that storage event scheduled, avoiding a duplicate
				// host pull (and the redundant `gk mcp config` shell-out it would cost).
				this.fireRefresh(true);

				this._onDidCompleteSetup.fire({ source: commandSource, cliVersion: cliVersion });

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
			const output = await this.gkCli.run(
				['mcp', 'install', mcpInstallAppName, '--source=gitlens', `--scheme=${env.uriScheme}`],
				{ cwd: cliPath },
			);

			const classification = classifyMcpInstallOutput(output);
			switch (classification.kind) {
				case 'succeeded':
					scope?.addExitInfo(`(version: ${cliVersion})`);
					// Send success telemetry
					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent('mcp/setup/completed', {
							requiresUserCompletion: false,
							source: commandSource,
							'cli.version': cliVersion,
						});
					}
					return { cliVersion: cliVersion };
				case 'unsupported':
					scope?.setFailed(`GitKraken MCP setup failed; unsupported host: ${hostAppName}`);
					throw new McpSetupError(
						McpSetupErrorReason.UnsupportedClient,
						'Automatic setup of the GitKraken MCP is not currently supported in this IDE. You should be able to configure it by adding the GitKraken MCP to your configuration manually.',
						'unsupported app',
						commandSource,
						cliVersion,
						`Not a supported MCP client: ${hostAppName}`,
					);
				case 'userAction':
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
						url: classification.url,
					};
				case 'unexpected':
					scope?.setFailed(`GitKraken MCP setup failed; unexpected output from mcp install`);
					scope?.error(undefined, `Unexpected output from mcp install command: ${classification.output}`);
					throw new McpSetupError(
						McpSetupErrorReason.UnexpectedOutput,
						'Unable to setup the GitKraken MCP. If this issue persists, please try adding the GitKraken MCP to your configuration manually.',
						'unexpected output from mcp install command',
						commandSource,
						cliVersion,
						`Unexpected output from mcp install command: ${classification.output}`,
					);
			}
		} catch (ex) {
			scope?.error(ex, `Error during MCP installation: ${ex}`);
			throw this.normalizeAndTrackSetupError(ex, commandSource);
		}
	}

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

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.ai.mcp.install', (src?: Source) => this.handleInstallCommand(src?.source)),
			registerCommand('gitlens.ai.mcp.reinstall', (src?: Source) => this.handleInstallCommand(src?.source, true)),
			registerCommand('gitlens.ai.mcp.selectAgents', (src?: Source) =>
				this.handleSelectAgentsCommand(src?.source),
			),
		];
	}

	/**
	 * User-initiated MCP setup: installs the CLI and registers MCP for the current host IDE,
	 * then offers the user the option to connect additional agents.
	 *
	 * The auto-install path (reactive on cliService.onDidChangeInstall) also runs silently on startup
	 * to ensure MCP "just works" for the current IDE. This handler adds the interactive agent
	 * selection on top of that.
	 */
	@gate()
	@debug({ exit: true })
	private async handleInstallCommand(source?: Sources, force = false): Promise<void> {
		const scope = getScopedLogger();

		await this.container.onboarding.dismiss('mcp:banner');

		try {
			const result = await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'Setting up the GitKraken MCP...',
					cancellable: false,
				},
				async () => this.setupCore(source, force),
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
						void this.handleSelectAgentsCommand(source);
					} else if (r === learnMore) {
						void openUrl(urls.helpCenterMCP);
					}
				});
		} catch (ex) {
			scope?.error(ex, `Error during MCP setup: ${ex instanceof Error ? ex.message : 'Unknown error'}`);
			// setupCore already normalizes errors and sends failure telemetry before re-throwing,
			// so McpSetupError instances just need to be shown — don't double-track telemetry
			if (ex instanceof McpSetupError) {
				this.showSetupError(ex);
			} else {
				const normalized = this.normalizeAndTrackSetupError(ex, source ?? 'commandPalette');
				this.showSetupError(normalized);
			}
		}
	}

	@gate()
	@debug({ exit: true })
	private async handleSelectAgentsCommand(source?: Sources): Promise<void> {
		const scope = getScopedLogger();
		const commandSource = source ?? 'commandPalette';

		try {
			// Ensure CLI is installed first
			const { cliPath, status } = await this.gkCli.install(false, source);
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
		const agents = await showMcpAgentPicker(this.container, { showEmptyState: showEmptyState });
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
					const output = await this.gkCli.run(
						['mcp', 'install', agent.name, '--source=gitlens', `--scheme=${env.uriScheme}`],
						{ cwd: cliPath },
					);

					const classification = classifyMcpInstallOutput(output);
					switch (classification.kind) {
						case 'succeeded':
							Logger.debug(scope, `MCP install succeeded for agent '${agent.name}'`);
							return { agent: agent, status: 'succeeded' as const };
						case 'unsupported':
							Logger.warn(scope, `MCP install failed for agent '${agent.name}': not a supported client`);
							return { agent: agent, status: 'failed' as const, error: 'Not a supported MCP client' };
						case 'userAction':
							Logger.debug(
								scope,
								`MCP install for agent '${agent.name}' requires user action: ${classification.url}`,
							);
							return { agent: agent, status: 'userAction' as const, url: classification.url };
						case 'unexpected':
							Logger.warn(
								scope,
								`MCP install failed for agent '${agent.name}': unexpected output: ${classification.output}`,
							);
							return {
								agent: agent,
								status: 'failed' as const,
								error: `Unexpected output: ${classification.output}`,
							};
					}
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
}
