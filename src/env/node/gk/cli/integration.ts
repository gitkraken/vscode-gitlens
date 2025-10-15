import { arch } from 'process';
import type { ConfigurationChangeEvent } from 'vscode';
import { version as codeVersion, Disposable, env, ProgressLocation, Uri, window, workspace } from 'vscode';
import { urls } from '../../../../constants';
import type { StoredGkCLIInstallInfo } from '../../../../constants.storage';
import type { Source, Sources } from '../../../../constants.telemetry';
import type { Container } from '../../../../container';
import type { SubscriptionChangeEvent } from '../../../../plus/gk/subscriptionService';
import { mcpExtensionRegistrationAllowed } from '../../../../plus/gk/utils/-webview/mcp.utils';
import { registerCommand } from '../../../../system/-webview/command';
import { configuration } from '../../../../system/-webview/configuration';
import { setContext } from '../../../../system/-webview/context';
import { getHostAppName, isHostVSCode } from '../../../../system/-webview/vscode';
import { exists, openUrl } from '../../../../system/-webview/vscode/uris';
import { gate } from '../../../../system/decorators/gate';
import { debug, log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import { compare } from '../../../../system/version';
import { getPlatform, isOffline, isWeb } from '../../platform';
import { CliCommandHandlers } from './commands';
import type { IpcServer } from './ipcServer';
import { createIpcServer } from './ipcServer';
import { extractZipFile, runCLICommand, showManualMcpSetupPrompt, toMcpInstallProvider } from './utils';

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

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(e => this.onConfigurationChanged(e)),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			...this.registerCommands(),
		);

		this.onConfigurationChanged();

		this.ensureAutoInstall();
	}

	dispose(): void {
		this.stop();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (e == null || configuration.changed(e, 'gitkraken.cli.integration.enabled')) {
			if (!configuration.get('gitkraken.cli.integration.enabled')) {
				this.stop();
			} else {
				void this.start();
			}
		}
	}

	private async start() {
		const server = await createIpcServer<CliCommandRequest, CliCommandResponse>();

		const { environmentVariableCollection: envVars } = this.container.context;

		envVars.clear();
		envVars.persistent = false;
		envVars.replace('GK_GL_ADDR', server.ipcAddress);
		envVars.description = 'Enables GK CLI integration';

		this._runningDisposable = Disposable.from(new CliCommandHandlers(this.container, server), server);
	}

	private stop() {
		this.container.context.environmentVariableCollection.clear();
		this._runningDisposable?.dispose();
		this._runningDisposable = undefined;
	}

	private ensureAutoInstall() {
		const cliInstall = this.container.storage.get('gk:cli:install');
		if (cliInstall?.status === 'completed') {
			void setContext('gitlens:gk:cli:installed', true);
			return;
		}

		// Reset the attempts count if GitLens extension version has changed
		if (reachedMaxAttempts(cliInstall) && this.container.version !== this.container.previousVersion) {
			void this.container.storage.store('gk:cli:install', undefined);
		}

		if (!mcpExtensionRegistrationAllowed() || reachedMaxAttempts(cliInstall)) {
			return;
		}

		// Setup MCP, but handle errors silently
		void this.setupMCPCore('gk-cli-integration', false, true).catch(() => {});
	}

	@gate()
	@log({ exit: true })
	private async setupMCP(source?: Sources, force = false): Promise<void> {
		await this.container.storage.store('mcp:banner:dismissed', true);

		try {
			const result = await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'Setting up the GitKraken MCP...',
					cancellable: false,
				},
				async () => {
					return this.setupMCPCore(source, force);
				},
			);

			if (result.requiresUserCompletion) {
				await openUrl(result.url);
			}

			if (result.usingExtensionRegistration) {
				const learnMore = { title: 'Learn More' };
				const confirm = { title: 'OK', isCloseAffordance: true };
				const userResult = await window.showInformationMessage(
					'GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions.',
					learnMore,
					confirm,
				);
				if (userResult === learnMore) {
					void openUrl(urls.helpCenterMCP);
				}
			}
		} catch (ex) {
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

	@log({ exit: true })
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
		const scope = getLogScope();
		const commandSource = source ?? 'commandPalette';

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('mcp/setup/started', { source: commandSource });
		}

		try {
			if (isWeb) {
				setLogScopeExit(scope, 'GitKraken MCP setup is not supported on the web');
				throw new McpSetupError(
					McpSetupErrorReason.WebUnsupported,
					'GitKraken MCP setup is not supported on the web.',
					'web environment unsupported',
					commandSource,
				);
			}

			const hostAppName = await getHostAppName();
			const usingExtensionRegistration = mcpExtensionRegistrationAllowed();

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
				setLogScopeExit(scope, undefined, 'GitKraken MCP setup failed; installation failed');
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
				setLogScopeExit(scope, 'supports provider-based MCP registration');
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
				setLogScopeExit(scope, undefined, `GitKraken MCP setup failed; unsupported host: ${hostAppName}`);
				throw new McpSetupError(
					McpSetupErrorReason.UnsupportedHost,
					'Automatic setup of the GitKraken MCP is not currently supported in this IDE. You may be able to configure it by adding the GitKraken MCP to your configuration manually.',
					'no app name',
					commandSource,
					cliVersion,
				);
			}

			let output = await runCLICommand(
				['mcp', 'install', mcpInstallAppName, '--source=gitlens', `--scheme=${env.uriScheme}`],
				{
					cwd: cliPath,
				},
			);

			output = output.replace(CLIProxyMCPInstallOutputs.checkingForUpdates, '').trim();
			if (CLIProxyMCPInstallOutputs.installedSuccessfully.test(output)) {
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
				setLogScopeExit(scope, undefined, `GitKraken MCP setup failed; unsupported host: ${hostAppName}`);
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
				setLogScopeExit(scope, undefined, `GitKraken MCP setup failed; unexpected output from mcp install`);
				Logger.error(undefined, scope, `Unexpected output from mcp install command: ${output}`);
				throw new McpSetupError(
					McpSetupErrorReason.UnexpectedOutput,
					'Unable to setup the GitKraken MCP. If this issue persists, please try adding the GitKraken MCP to your configuration manually.',
					'unexpected output from mcp install command',
					commandSource,
					cliVersion,
					`Unexpected output from mcp install command: ${output}`,
				);
			}

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
			Logger.error(ex, scope, `Error during MCP installation: ${ex}`);

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
	@log({ exit: true })
	private async installCLI(
		autoInstall?: boolean,
		source?: Sources,
		force = false,
	): Promise<{ cliVersion?: string; cliPath?: string; status: 'completed' | 'unsupported' | 'attempted' }> {
		const scope = getLogScope();

		const cliInstall = this.container.storage.get('gk:cli:install');
		let cliInstallAttempts = force ? 0 : (cliInstall?.attempts ?? 0);
		let cliInstallStatus = cliInstall?.status ?? 'attempted';
		let cliVersion = cliInstall?.version;
		let cliPath = this.container.storage.get('gk:cli:path');
		const platform = getPlatform();

		if (!force) {
			if (cliInstallStatus === 'completed') {
				if (cliPath != null) {
					cliVersion = cliInstall?.version;
					if (await exists(Uri.joinPath(Uri.file(cliPath), platform === 'windows' ? 'gk.exe' : 'gk'))) {
						return { cliVersion: cliVersion, cliPath: cliPath, status: 'completed' };
					}
				}

				cliInstallStatus = 'attempted';
				cliVersion = undefined;
			} else if (cliInstallStatus === 'unsupported') {
				return { cliVersion: undefined, cliPath: undefined, status: 'unsupported' };
			} else if (autoInstall && reachedMaxAttempts({ status: cliInstallStatus, attempts: cliInstallAttempts })) {
				return { cliVersion: undefined, cliPath: undefined, status: 'attempted' };
			}
		}

		try {
			if (isWeb) {
				void this.container.storage
					.store('gk:cli:install', {
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
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/install/started', {
					source: source,
					autoInstall: autoInstall ?? false,
					attempts: cliInstallAttempts,
				});
			}
			void this.container.storage
				.store('gk:cli:install', {
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
						.store('gk:cli:install', {
							status: 'unsupported',
							attempts: cliInstallAttempts,
						})
						.catch();

					throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform, undefined, platform);
				}
			}

			let cliProxyZipFilePath: Uri | undefined;
			let cliExtractedProxyFilePath: Uri | undefined;
			const globalStoragePath = this.container.context.globalStorageUri;

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
				cliProxyZipFilePath = Uri.joinPath(globalStoragePath, cliProxyZipFileName);

				// Ensure the global storage directory exists
				try {
					await workspace.fs.createDirectory(globalStoragePath);
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
					await extractZipFile(cliProxyZipFilePath.fsPath, globalStoragePath.fsPath, {
						filter: filename => filename === expectedBinary || filename.endsWith(`/${expectedBinary}`),
					});

					// Check using stat to make sure the newly extracted file exists.
					cliExtractedProxyFilePath = Uri.joinPath(globalStoragePath, expectedBinary);

					// This will throw if the file doesn't exist
					await workspace.fs.stat(cliExtractedProxyFilePath);
					void this.container.storage.store('gk:cli:path', globalStoragePath.fsPath).catch();
					cliPath = globalStoragePath.fsPath;
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyExtract,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : '',
					);
				}

				// Set up the local MCP server files
				try {
					const coreInstallOutput = await runCLICommand(['install'], {
						cwd: globalStoragePath.fsPath,
					});
					const directory = coreInstallOutput.match(/Directory: (.*)/);
					let directoryPath;
					if (directory != null && directory.length > 1) {
						directoryPath = directory[1];
						void this.container.storage.store('gk:cli:corePath', directoryPath).catch();
					} else {
						throw new Error(`Failed to find core directory in install output: ${coreInstallOutput}`);
					}

					Logger.log('CLI install completed.');
					cliInstallStatus = 'completed';
					void this.container.storage
						.store('gk:cli:install', {
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
						Logger.warn(`Failed to delete CLI proxy archive: ${ex}`);
					}
				}

				try {
					const readmePath = Uri.joinPath(globalStoragePath, 'README.md');
					await workspace.fs.delete(readmePath);
				} catch (ex) {
					Logger.warn(`Failed to delete CLI proxy README: ${ex}`);
				}
			}
		} catch (ex) {
			Logger.error(
				ex,
				scope,
				`Failed to ${autoInstall ? 'auto-install' : 'install'} CLI: ${ex instanceof Error ? ex.message : 'Unknown error during installation'}`,
			);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/install/failed', {
					autoInstall: autoInstall ?? false,
					attempts: cliInstallAttempts,
					'error.message': ex instanceof Error ? ex.message : 'Unknown error',
					source: source,
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

	@debug()
	private async authCLI(): Promise<void> {
		const scope = getLogScope();

		const cliInstall = this.container.storage.get('gk:cli:install');
		const cliPath = this.container.storage.get('gk:cli:path');
		if (cliInstall?.status !== 'completed' || cliPath == null) {
			return;
		}

		const currentSessionToken = (await this.container.subscription.getAuthenticationSession())?.accessToken;
		if (currentSessionToken == null) {
			return;
		}

		try {
			await runCLICommand(['auth', 'login', '-t', currentSessionToken]);
		} catch (ex) {
			Logger.error(ex, scope);
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
		Error.captureStackTrace?.(this, CLIInstallError);
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
		Error.captureStackTrace?.(this, McpSetupError);
	}
}
