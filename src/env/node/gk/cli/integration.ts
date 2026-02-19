import { mkdir, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { arch, ppid } from 'process';
import type { ConfigurationChangeEvent } from 'vscode';
import { version as codeVersion, Disposable, env, ProgressLocation, Uri, window, workspace } from 'vscode';
import { urls } from '../../../../constants.js';
import type { StoredGkCLIInstallInfo } from '../../../../constants.storage.js';
import type { Source, Sources } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import type { SubscriptionChangeEvent } from '../../../../plus/gk/subscriptionService.js';
import { mcpExtensionRegistrationAllowed } from '../../../../plus/gk/utils/-webview/mcp.utils.js';
import { registerCommand } from '../../../../system/-webview/command.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { setContext } from '../../../../system/-webview/context.js';
import { exists, openUrl } from '../../../../system/-webview/vscode/uris.js';
import { getHostAppName, isHostVSCode } from '../../../../system/-webview/vscode.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug, trace } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { formatLoggableScopeBlock, getScopedLogger } from '../../../../system/logger.scope.js';
import { compare, fromString, satisfies } from '../../../../system/version.js';
import { getPlatform, isOffline, isWeb } from '../../platform.js';
import { CliCommandHandlers } from './commands.js';
import type { IpcServer } from './ipcServer.js';
import { createIpcServer } from './ipcServer.js';
import {
	extractZipFile,
	getCLIVersions,
	runCLICommand,
	showManualMcpSetupPrompt,
	toMcpInstallProvider,
} from './utils.js';

const enum CLIInstallErrorReason {
	UnsupportedPlatform,
	ProxyUrlFetch,
	ProxyUrlFormat,
	ProxyDownload,
	ProxyExtract,
	ProxyFetch,
	GlobalStorageDirectory,
	CoreInstall,
	Offline,
}

const enum McpSetupErrorReason {
	WebUnsupported,
	VSCodeVersionUnsupported,
	CLIUnsupportedPlatform,
	CLILocalInstallFailed,
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
export type CliIpcServer = IpcServer<CliCommandRequest, CliCommandResponse>;

const CLIProxyMCPInstallOutputs = {
	checkingForUpdates: /checking for updates.../i,
	notASupportedClient: /is not a supported MCP client/i,
	installedSuccessfully: /GitKraken MCP Server Successfully Installed!/i,
} as const;

const maxAutoInstallAttempts = 5;

export class GkCliIntegrationProvider implements Disposable {
	private readonly _disposable: Disposable;
	private _runningDisposable: Disposable | undefined;
	private _discoveryFilePath: string | undefined;
	private _cliCoreVersion: string | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(e => this.onConfigurationChanged(e)),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			...this.registerCommands(),
			this.container.onReady(() => {
				this.onConfigurationChanged();
				void this.ensureUpdateOrInstall();
			}),
		);
	}

	dispose(): void {
		this.stop();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (e == null || configuration.changed(e, 'gitkraken.cli.integration.enabled')) {
			if (!this.supportsCliIntegration()) {
				this.stop();
			} else {
				void this.start();
			}
		}

		// Reinstall CLI when insiders setting changes
		if (e != null && configuration.changed(e, 'gitkraken.cli.insiders.enabled')) {
			const cliInstall = this.container.storage.getScoped('gk:cli:install');
			if (cliInstall?.status === 'completed') {
				// Force reinstall to switch between production and insiders
				Logger.info(
					`${formatLoggableScopeBlock('CLI')} Forcing CLI reinstall on settings change (insiders = ${configuration.get('gitkraken.cli.insiders.enabled')})`,
				);
				void this.setupMCPCore('settings', true, true).catch(() => {});
			}
		}
	}

	private supportsCliIntegration(): boolean {
		return (
			this.container.ai.enabled &&
			(configuration.get('gitkraken.mcp.autoEnabled') || configuration.get('gitkraken.cli.integration.enabled'))
		);
	}

	private async start() {
		const server = await createIpcServer<CliCommandRequest, CliCommandResponse>();

		server.registerHandler('ping', () =>
			Promise.resolve({ stdout: JSON.stringify({ version: this.container.version }) }),
		);

		const { environmentVariableCollection: envVars } = this.container.context;

		envVars.clear();
		envVars.persistent = false;
		envVars.replace('GK_GL_ADDR', server.ipcAddress);
		envVars.description = 'Enables GK CLI integration';

		// Create discovery file for external terminal support
		try {
			const workspaceFolders = workspace.workspaceFolders;
			if (workspaceFolders != null && workspaceFolders.length > 0) {
				const workspacePaths = workspaceFolders.map(folder => folder.uri.fsPath);
				this._discoveryFilePath = await createDiscoveryFile(server, workspacePaths);

				envVars.replace('GK_GL_PATH', this._discoveryFilePath);
			}
		} catch (error) {
			// Discovery file creation failure should not prevent IPC server startup
			Logger.warn(`${formatLoggableScopeBlock('IPC')} Failed to create discovery file: ${error}`);
		}

		this._runningDisposable = Disposable.from(new CliCommandHandlers(this.container, server), server);

		// Notify that the IPC server is ready so MCP providers can refresh
		this.container.events.fire('gk:cli:ipc:started', undefined);
		Logger.info(`${formatLoggableScopeBlock('IPC')} Server started on ${server.ipcAddress}`);
	}

	private stop() {
		// Cleanup discovery file
		if (this._discoveryFilePath) {
			void cleanupDiscoveryFile(this._discoveryFilePath);
			this._discoveryFilePath = undefined;
		}

		this.container.context.environmentVariableCollection.clear();
		if (this._runningDisposable != null) {
			this._runningDisposable.dispose();
			this._runningDisposable = undefined;
			Logger.info(`${formatLoggableScopeBlock('IPC')} Server stopped`);
		}
	}

	private async ensureUpdateOrInstall() {
		let forceInstall = false;
		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status === 'completed') {
			const { needsUpdate, core, proxy } = await this.checkCliUpdateRequired();
			let currentCoreVersion = core;
			if (needsUpdate !== undefined) {
				Logger.info(
					`${formatLoggableScopeBlock('CLI')} CLI ${needsUpdate} version ${(needsUpdate === 'core' ? currentCoreVersion : proxy) ?? 'unknown'} is outdated, forcing reinstall`,
				);
				forceInstall = true;
			} else {
				// Only update if GitLens extension version has changed since last check, to avoid unnecessary update checks
				if (this.container.version !== this.container.previousVersion) {
					const updateResult = await this.updateCliCore();
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

		// Reset the attempts count if GitLens extension version has changed
		if (
			forceInstall ||
			(reachedMaxAttempts(cliInstall) && this.container.version !== this.container.previousVersion)
		) {
			void this.container.storage.storeScoped('gk:cli:install', undefined);
		}

		const shouldAutoInstall = mcpExtensionRegistrationAllowed(this.container) && !reachedMaxAttempts(cliInstall);
		if (!forceInstall && !shouldAutoInstall) {
			return;
		}

		// Setup MCP, but handle errors silently
		void this.setupMCPCore('gk-cli-integration', forceInstall, shouldAutoInstall).catch(() => {});
	}

	@gate()
	@debug({ exit: true })
	private async setupMCP(source?: Sources, force = false): Promise<void> {
		const scope = getScopedLogger();

		await this.container.storage.store('mcp:banner:dismissed', true);

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
			}

			if (result.usingExtensionRegistration) {
				const learnMore = { title: 'Learn More' };
				const confirm = { title: 'OK', isCloseAffordance: true };
				window
					.showInformationMessage(
						'GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions.',
						learnMore,
						confirm,
					)
					.then(r => {
						if (r === learnMore) {
							void openUrl(urls.helpCenterMCP);
						}
					});
			}
		} catch (ex) {
			scope?.error(ex, `Error during MCP setup: ${ex instanceof Error ? ex.message : 'Unknown error'}`);
			if (ex instanceof McpSetupError) {
				switch (ex.reason) {
					case McpSetupErrorReason.WebUnsupported:
					case McpSetupErrorReason.VSCodeVersionUnsupported:
					case McpSetupErrorReason.Offline:
						void window.showWarningMessage(ex.message);
						break;
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
			} else {
				void window.showErrorMessage(
					`Unable to setup the GitKraken MCP: ${ex instanceof Error ? ex.message : 'Unknown error'}`,
				);
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
			const usingExtensionRegistration = mcpExtensionRegistrationAllowed(this.container);

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
			} = await this.installCLI(autoInstall, source, force);

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

			let telemetryReason: string;
			let telemetryErrorMessage: string | undefined = ex.message;
			let cliVersionForTelemetry: string | undefined;
			let errorToThrow: Error;

			// Normalize errors
			if (ex instanceof McpSetupError) {
				errorToThrow = ex;
				telemetryReason = ex.telemetryReason;
				cliVersionForTelemetry = ex.cliVersion;
				if (ex.telemetryMessage) {
					telemetryErrorMessage = ex.telemetryMessage;
				}
			} else if (ex instanceof CLIInstallError) {
				let reason: McpSetupErrorReason;
				let message: string;

				switch (ex.reason) {
					case CLIInstallErrorReason.UnsupportedPlatform:
						reason = McpSetupErrorReason.CLIUnsupportedPlatform;
						message = 'GitKraken MCP setup is not supported on this platform.';
						telemetryReason = 'unsupported platform';
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

				errorToThrow = new McpSetupError(reason, message, telemetryReason, commandSource);
			} else {
				errorToThrow = ex instanceof Error ? ex : new Error('Unknown error');
				telemetryReason = 'unknown error';
			}

			// Send failure telemetry
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/failed', {
					reason: telemetryReason ?? 'unknown error',
					'error.message': telemetryErrorMessage ?? 'Unknown error',
					source: commandSource,
					'cli.version': cliVersionForTelemetry,
				});
			}

			// Now throw the error
			throw errorToThrow;
		}
	}

	@gate()
	@debug({ exit: true })
	private async installCLI(
		autoInstall?: boolean,
		source?: Sources,
		force = false,
	): Promise<{ cliVersion?: string; cliPath?: string; status: 'completed' | 'unsupported' | 'attempted' }> {
		const scope = getScopedLogger();

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		let cliInstallAttempts = force ? 0 : (cliInstall?.attempts ?? 0);
		let cliInstallStatus = cliInstall?.status ?? 'attempted';
		let cliVersion = cliInstall?.version;
		let cliPath = this.container.storage.getScoped('gk:cli:path');
		const platform = getPlatform();

		if (!force) {
			if (cliInstallStatus === 'completed') {
				if (cliPath != null) {
					cliVersion = cliInstall?.version;
					const cliExecutable = Uri.joinPath(Uri.file(cliPath), platform === 'windows' ? 'gk.exe' : 'gk');
					if (await exists(cliExecutable)) {
						return { cliVersion: cliVersion, cliPath: cliPath, status: 'completed' };
					}
					scope?.warn(`CLI binary not found at expected path: ${cliExecutable.fsPath}`);
				}

				cliInstallStatus = 'attempted';
				cliVersion = undefined;
			} else if (cliInstallStatus === 'unsupported') {
				return { cliVersion: undefined, cliPath: undefined, status: 'unsupported' };
			} else if (autoInstall && reachedMaxAttempts({ status: cliInstallStatus, attempts: cliInstallAttempts })) {
				scope?.warn(`Skipping auto-install, reached max attempts (${cliInstallAttempts})`);
				return { cliVersion: undefined, cliPath: undefined, status: 'attempted' };
			}
		}

		const insidersEnabled = configuration.get('gitkraken.cli.insiders.enabled');

		try {
			if (isWeb) {
				void this.container.storage
					.storeScoped('gk:cli:install', {
						status: 'unsupported',
						attempts: cliInstallAttempts,
					})
					.catch();

				throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform, undefined, 'web');
			}

			if (isOffline) {
				throw new CLIInstallError(CLIInstallErrorReason.Offline);
			}
			cliInstallAttempts += 1;
			scope?.info(`Starting CLI installation (attempt ${cliInstallAttempts}/${maxAutoInstallAttempts})`);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/install/started', {
					source: source,
					autoInstall: autoInstall ?? false,
					attempts: cliInstallAttempts,
					insiders: insidersEnabled,
				});
			}
			void this.container.storage
				.storeScoped('gk:cli:install', {
					status: 'attempted',
					attempts: cliInstallAttempts,
				})
				.catch();

			// Map platform names for the API and get architecture
			let platformName: string;
			let architecture: string;

			switch (arch) {
				case 'x64':
					architecture = 'x64';
					break;
				case 'arm64':
					architecture = 'arm64';
					break;
				default:
					architecture = 'x86'; // Default to x86 for other architectures
					break;
			}

			switch (platform) {
				case 'windows':
					platformName = 'windows';
					break;
				case 'macOS':
					platformName = 'darwin';
					break;
				case 'linux':
					platformName = 'linux';
					break;
				default: {
					void this.container.storage
						.storeScoped('gk:cli:install', {
							status: 'unsupported',
							attempts: cliInstallAttempts,
						})
						.catch();

					throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform, undefined, platform);
				}
			}

			let cliProxyZipFilePath: Uri | undefined;
			let cliExtractedProxyFilePath: Uri | undefined;
			const { globalStorageUri } = this.container.context;

			try {
				// Download the MCP proxy installer
				// TODO: Switch to getGkApiUrl once we support other environments
				const proxyUrl = Uri.joinPath(
					Uri.parse('https://api.gitkraken.dev'),
					'releases',
					'gkcli-proxy',
					'production',
					platformName,
					architecture,
					'active',
				).toString();
				/* const proxyUrl = this.container.urls.getGkApiUrl(
					'releases',
					'gkcli-proxy',
					'production',
					platformName,
					architecture,
					'active',
				); */

				scope?.trace(`Fetching CLI proxy: platform=${platformName}, arch=${architecture}`);
				let response = await fetch(proxyUrl);
				if (!response.ok) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyUrlFetch,
						undefined,
						`${response.status} ${response.statusText}`,
					);
				}

				let downloadUrl: string | undefined;
				try {
					const cliZipArchiveDownloadInfo: { version?: string; packages?: { zip?: string } } | undefined =
						(await response.json()) as any;
					downloadUrl = cliZipArchiveDownloadInfo?.packages?.zip;
					cliVersion = cliZipArchiveDownloadInfo?.version;
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyUrlFormat,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : undefined,
					);
				}

				if (downloadUrl == null) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyUrlFormat,
						undefined,
						'No download URL found for CLI proxy archive',
					);
				}

				scope?.trace(`Downloading CLI proxy (version: ${cliVersion})`);
				response = await fetch(downloadUrl);
				if (!response.ok) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyFetch,
						undefined,
						`${response.status} ${response.statusText}`,
					);
				}

				const cliProxyZipFileDownloadData = await response.arrayBuffer();
				if (cliProxyZipFileDownloadData.byteLength === 0) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyDownload,
						undefined,
						'Downloaded proxy archive data is empty',
					);
				}
				// installer file name is the last part of the download URL
				const cliProxyZipFileName = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1);
				cliProxyZipFilePath = Uri.joinPath(globalStorageUri, cliProxyZipFileName);

				// Ensure the global storage directory exists
				try {
					await workspace.fs.createDirectory(globalStorageUri);
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.GlobalStorageDirectory,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : undefined,
					);
				}

				// Write the installer to the extension storage
				try {
					await workspace.fs.writeFile(cliProxyZipFilePath, new Uint8Array(cliProxyZipFileDownloadData));
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyDownload,
						ex instanceof Error ? ex : undefined,
						'Failed to write proxy archive to global storage',
					);
				}

				try {
					// Extract only the gk binary from the zip file using the fflate library (cross-platform)
					const expectedBinary = platform === 'windows' ? 'gk.exe' : 'gk';
					await extractZipFile(cliProxyZipFilePath.fsPath, globalStorageUri.fsPath, {
						filter: filename => filename === expectedBinary || filename.endsWith(`/${expectedBinary}`),
					});

					// Check using stat to make sure the newly extracted file exists.
					cliExtractedProxyFilePath = Uri.joinPath(globalStorageUri, expectedBinary);

					// This will throw if the file doesn't exist
					await workspace.fs.stat(cliExtractedProxyFilePath);
					void this.container.storage.storeScoped('gk:cli:path', globalStorageUri.fsPath).catch();
					cliPath = globalStorageUri.fsPath;
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyExtract,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : '',
					);
				}

				try {
					const installArgs = ['install'];
					if (insidersEnabled && canSupportCliInsiders(cliVersion)) {
						installArgs.push('--insiders');
					}
					const coreInstallOutput = await runCLICommand(installArgs, { cwd: globalStorageUri.fsPath });
					const directory = coreInstallOutput.match(/Directory: (.*)/);
					let directoryPath;
					if (directory != null && directory.length > 1) {
						directoryPath = directory[1];
						void this.container.storage.storeScoped('gk:cli:corePath', directoryPath).catch();
					} else {
						throw new Error(`Failed to find core directory in install output: ${coreInstallOutput}`);
					}

					scope?.info(`CLI installed (version: ${cliVersion}, path: ${cliPath})`);
					cliInstallStatus = 'completed';
					void this.container.storage
						.storeScoped('gk:cli:install', {
							status: cliInstallStatus,
							attempts: cliInstallAttempts,
							version: cliVersion,
						})
						.catch();
					void setContext('gitlens:gk:cli:installed', true);

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent('cli/install/succeeded', {
							autoInstall: autoInstall ?? false,
							attempts: cliInstallAttempts,
							source: source,
							version: cliVersion,
							insiders: insidersEnabled,
						});
					}

					await this.authCLI();
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.CoreInstall,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : '',
					);
				}
			} finally {
				// Clean up the installer zip file
				if (cliProxyZipFilePath != null) {
					try {
						await workspace.fs.delete(cliProxyZipFilePath);
					} catch (ex) {
						scope?.warn('Failed to delete CLI proxy archive', String(ex));
					}
				}
			}
		} catch (ex) {
			scope?.error(
				ex,
				`Failed to ${autoInstall ? 'auto-install' : 'install'} CLI: ${ex instanceof Error ? ex.message : 'Unknown error during installation'}`,
			);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/install/failed', {
					autoInstall: autoInstall ?? false,
					attempts: cliInstallAttempts,
					'error.message': ex instanceof Error ? ex.message : 'Unknown error',
					source: source,
					insiders: insidersEnabled,
				});
			}

			if (CLIInstallError.is(ex, CLIInstallErrorReason.UnsupportedPlatform)) {
				cliInstallStatus = 'unsupported';
			} else if (!autoInstall) {
				throw ex;
			}
		}

		return { cliVersion: cliVersion, cliPath: cliPath, status: cliInstallStatus };
	}

	@trace()
	private async authCLI(): Promise<void> {
		const scope = getScopedLogger();

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		const cliPath = this.container.storage.getScoped('gk:cli:path');
		if (cliInstall?.status !== 'completed' || cliPath == null) return;

		const currentSessionToken = (await this.container.subscription.getAuthenticationSession())?.accessToken;
		if (currentSessionToken == null) return;

		try {
			await runCLICommand(['auth', 'login', '-t', currentSessionToken]);
		} catch (ex) {
			debugger;
			scope?.error(ex, 'Failed to authenticate CLI');
		}
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id != null && e.current.account.id !== e.previous?.account?.id) {
			await this.authCLI();
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.ai.mcp.install', (src?: Source) => this.setupMCP(src?.source)),
			registerCommand('gitlens.ai.mcp.reinstall', (src?: Source) => this.setupMCP(src?.source, true)),
			registerCommand('gitlens.ai.mcp.authCLI', () => this.authCLI()),
		];
	}

	@debug()
	private async updateCliCore(): Promise<{ previous: string | undefined; current: string | undefined } | undefined> {
		const scope = getScopedLogger();

		try {
			const previousVersion = await getCLIVersions();
			await runCLICommand(['update']);
			const currentVersion = await getCLIVersions();
			this._cliCoreVersion = currentVersion?.core;

			scope?.debug(`CLI core update (previous: ${previousVersion?.core}, current: ${currentVersion?.core})`);

			return {
				previous: previousVersion?.core,
				current: currentVersion?.core,
			};
		} catch (ex) {
			scope?.error(ex, 'Failed to update CLI');
		}

		return undefined;
	}

	@debug()
	private async checkCliUpdateRequired(): Promise<{
		needsUpdate: 'core' | 'proxy' | undefined;
		core: string | undefined;
		proxy: string | undefined;
	}> {
		const scope = getScopedLogger();

		try {
			const currentVersions = await getCLIVersions();
			if (currentVersions == null) {
				this._cliCoreVersion = undefined;
				return {
					needsUpdate: 'proxy',
					core: undefined,
					proxy: undefined,
				};
			}

			const { core: currentCoreVersion, proxy: currentProxyVersion } = currentVersions;
			this._cliCoreVersion = currentCoreVersion;

			const { core: minimumCoreVersion, proxy: minimumProxyVersion } =
				await this.container.productConfig.getCliMinimumVersions();

			if (satisfies(fromString(currentProxyVersion), `< ${minimumProxyVersion}`)) {
				return {
					needsUpdate: 'proxy',
					core: currentCoreVersion,
					proxy: currentProxyVersion,
				};
			}

			if (satisfies(fromString(currentCoreVersion), `< ${minimumCoreVersion}`)) {
				return {
					needsUpdate: 'core',
					core: currentCoreVersion,
					proxy: currentProxyVersion,
				};
			}

			return {
				needsUpdate: undefined,
				core: currentCoreVersion,
				proxy: currentProxyVersion,
			};
		} catch (ex) {
			scope?.error(ex, 'Failed to get CLI version');
			this._cliCoreVersion = undefined;
		}

		return {
			needsUpdate: 'proxy',
			core: undefined,
			proxy: undefined,
		};
	}
}

// The CLI insiders flag was added in 3.1.51, so check for that version before allowing it to be used
function canSupportCliInsiders(version: string | undefined): boolean {
	if (version == null) return false;
	return satisfies(fromString(version), '>= 3.1.51');
}

function reachedMaxAttempts(cliInstall?: StoredGkCLIInstallInfo): boolean {
	return cliInstall?.status === 'attempted' && cliInstall.attempts >= maxAutoInstallAttempts;
}

class CLIInstallError extends Error {
	readonly original?: Error;
	readonly reason: CLIInstallErrorReason;

	static is(ex: unknown, reason?: CLIInstallErrorReason): ex is CLIInstallError {
		return ex instanceof CLIInstallError && (reason == null || ex.reason === reason);
	}

	constructor(reason: CLIInstallErrorReason, original?: Error, details?: string) {
		const message = CLIInstallError.buildErrorMessage(reason, details);
		super(message);
		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, new.target);
	}

	private static buildErrorMessage(reason: CLIInstallErrorReason, details?: string): string {
		let message;
		switch (reason) {
			case CLIInstallErrorReason.UnsupportedPlatform:
				message = 'Unsupported platform';
				break;
			case CLIInstallErrorReason.ProxyUrlFetch:
				message = 'Failed to fetch proxy URL';
				break;
			case CLIInstallErrorReason.ProxyUrlFormat:
				message = 'Failed to parse proxy URL';
				break;
			case CLIInstallErrorReason.ProxyDownload:
				message = 'Failed to download proxy';
				break;
			case CLIInstallErrorReason.ProxyExtract:
				message = 'Failed to extract proxy';
				break;
			case CLIInstallErrorReason.ProxyFetch:
				message = 'Failed to fetch proxy';
				break;
			case CLIInstallErrorReason.CoreInstall:
				message = 'Failed to install core';
				break;
			case CLIInstallErrorReason.GlobalStorageDirectory:
				message = 'Failed to create global storage directory';
				break;
			case CLIInstallErrorReason.Offline:
				message = 'Offline';
				break;
			default:
				message = 'An unknown error occurred';
				break;
		}

		if (details != null) {
			message += `: ${details}`;
		}

		return message;
	}
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

// Discovery file helper functions

/**
 * Gets the discovery file path for a given workspace
 */
function getDiscoveryFilePath(processId: number, port: number, discoveryDir?: string): string {
	discoveryDir ??= join(tmpdir(), 'gitkraken', 'gitlens');
	return join(discoveryDir, `gitlens-ipc-server-${processId}-${port}.json`);
}

/**
 * Creates a discovery file for the GitLens IPC server
 */
async function createDiscoveryFile(
	server: { ipcToken: string; ipcAddress: string; ipcPort: number },
	workspacePaths: string[],
): Promise<string> {
	const discoveryDir = join(tmpdir(), 'gitkraken', 'gitlens');
	const filePath = getDiscoveryFilePath(ppid, server.ipcPort, discoveryDir);

	// Create directory if it doesn't exist
	await mkdir(discoveryDir, { recursive: true });

	// Get host app information
	const ideName = await getHostAppName();
	const ideDisplayName = env.appName;

	// Prepare discovery file content
	const discoveryData = {
		token: server.ipcToken,
		address: server.ipcAddress,
		port: server.ipcPort,
		workspacePaths: workspacePaths,
		ideName: ideName,
		ideDisplayName: ideDisplayName,
		scheme: env.uriScheme,
		pid: ppid,
		createdAt: new Date().toISOString(),
	};

	// Write file with restricted permissions (owner read/write only)
	await writeFile(filePath, JSON.stringify(discoveryData, null, 2), { mode: 0o600 });

	return filePath;
}

/**
 * Cleans up the discovery file
 */
async function cleanupDiscoveryFile(filePath: string): Promise<void> {
	try {
		await unlink(filePath);
	} catch (ex) {
		Logger.warn(`${formatLoggableScopeBlock('IPC')} Failed to delete discovery file: ${ex}`);
	}
}
