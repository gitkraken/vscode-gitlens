import { arch } from 'process';
import type { ConfigurationChangeEvent } from 'vscode';
import { version as codeVersion, Disposable, env, ProgressLocation, Uri, window, workspace } from 'vscode';
import type { Source, Sources } from '../../../../constants.telemetry';
import type { Container } from '../../../../container';
import type { SubscriptionChangeEvent } from '../../../../plus/gk/subscriptionService';
import { registerCommand } from '../../../../system/-webview/command';
import { configuration } from '../../../../system/-webview/configuration';
import { getHostAppName } from '../../../../system/-webview/vscode';
import { openUrl } from '../../../../system/-webview/vscode/uris';
import { gate } from '../../../../system/decorators/gate';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { compare } from '../../../../system/version';
import { run } from '../../git/shell';
import { getPlatform, isWeb } from '../../platform';
import { CliCommandHandlers } from './commands';
import type { IpcServer } from './ipcServer';
import { createIpcServer } from './ipcServer';

const enum CLIInstallErrorReason {
	UnsupportedPlatform,
	ProxyUrlFetch,
	ProxyUrlFormat,
	ProxyDownload,
	ProxyExtract,
	ProxyFetch,
	CoreDirectory,
	CoreInstall,
}

export interface CliCommandRequest {
	cwd?: string;
	args?: string[];
}
export type CliCommandResponse = { stdout?: string; stderr?: string } | void;
export type CliIpcServer = IpcServer<CliCommandRequest, CliCommandResponse>;

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

		// TODO: Uncomment this once we feel confident enough that the install process is stable cross-platform
		/* const cliInstall = this.container.storage.get('gk:cli:install');
		if (!cliInstall || (cliInstall.status === 'attempted' && cliInstall.attempts < 5)) {
			setTimeout(() => this.installCLI(true), 10000 + Math.floor(Math.random() * 20000));
		} */
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

	@gate()
	private async setupMCP(source?: Sources): Promise<void> {
		const commandSource = source ?? 'commandPalette';
		const scope = getLogScope();
		let cliVersion: string | undefined;
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('mcp/setup/started', { source: commandSource });
		}

		if (isWeb) {
			void window.showErrorMessage('GitKraken MCP setup is not supported on this platform.');
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/failed', {
					reason: 'web environment unsupported',
					source: commandSource,
				});
			}
			return;
		}

		const appName = toMcpInstallProvider(await getHostAppName());
		if (appName == null) {
			void window.showInformationMessage(`Failed to setup the GitKraken MCP: Could not determine app name`);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/failed', {
					reason: 'no app name',
					source: commandSource,
				});
			}
			return;
		}

		try {
			if (
				(appName === 'vscode' || appName === 'vscode-insiders' || appName === 'vscode-exploration') &&
				compare(codeVersion, '1.102') < 0
			) {
				void window.showInformationMessage('Use of this command requires VS Code 1.102 or later.');
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/failed', {
						reason: 'unsupported vscode version',
						source: commandSource,
					});
				}
				return;
			}

			let cliVersion: string | undefined;
			let cliPath: string | undefined;
			try {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: 'Setting up the GitKraken MCP...',
						cancellable: false,
					},
					async () => {
						const {
							cliVersion: installedVersion,
							cliPath: installedPath,
							status,
						} = await this.installCLI(false, source);
						if (status === 'unsupported') {
							throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform);
						} else if (status === 'attempted') {
							throw new CLIInstallError(CLIInstallErrorReason.CoreInstall);
						}
						cliVersion = installedVersion;
						cliPath = installedPath;
					},
				);
			} catch (ex) {
				let failureReason = 'unknown error';
				if (ex instanceof CLIInstallError) {
					switch (ex.reason) {
						case CLIInstallErrorReason.UnsupportedPlatform:
							void window.showErrorMessage('GitKraken MCP setup is not supported on this platform.');
							failureReason = 'unsupported platform';
							break;
						case CLIInstallErrorReason.ProxyUrlFetch:
						case CLIInstallErrorReason.ProxyUrlFormat:
						case CLIInstallErrorReason.ProxyFetch:
						case CLIInstallErrorReason.ProxyDownload:
						case CLIInstallErrorReason.ProxyExtract:
						case CLIInstallErrorReason.CoreDirectory:
						case CLIInstallErrorReason.CoreInstall:
							void window.showErrorMessage('Failed to install the GitKraken MCP server locally.');
							failureReason = 'local installation failed';
							break;
						default:
							void window.showErrorMessage(
								`Failed to setup the GitKraken MCP: ${ex instanceof Error ? ex.message : 'Unknown error.'}`,
							);
							break;
					}
				}

				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/failed', {
						reason: failureReason,
						'error.message': ex instanceof Error ? ex.message : 'Unknown error',
						source: commandSource,
					});
				}
				return;
			}

			if (cliPath == null) {
				void window.showErrorMessage('Failed to setup the GitKraken MCP: Unknown error.');
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/failed', {
						reason: 'unknown error',
						'error.message': 'Unknown error',
						source: commandSource,
						'cli.version': cliVersion,
					});
				}
				return;
			}

			if (appName !== 'cursor' && appName !== 'vscode' && appName !== 'vscode-insiders') {
				const confirmation = await window.showInformationMessage(
					`GitKraken MCP installed successfully. Click 'Finish' to add it to your MCP server list and complete the setup.`,
					{ modal: true },
					{ title: 'Finish' },
					{ title: 'Cancel', isCloseAffordance: true },
				);
				if (confirmation == null || confirmation.title === 'Cancel') {
					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent('mcp/setup/failed', {
							reason: 'user cancelled',
							source: commandSource,
							'cli.version': cliVersion,
						});
					}
					return;
				}
			}

			let output = await this.runCLICommand(
				['mcp', 'install', appName, '--source=gitlens', `--scheme=${env.uriScheme}`],
				{
					cwd: cliPath,
				},
			);

			output = output.trim();
			if (output === 'GitKraken MCP Server Successfully Installed!') {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/completed', {
						requiresUserCompletion: false,
						source: commandSource,
						'cli.version': cliVersion,
					});
				}
				return;
			} else if (output.includes('not a supported MCP client')) {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/failed', {
						reason: 'unsupported app',
						'error.message': `Not a supported MCP client: ${appName}`,
						source: commandSource,
						'cli.version': cliVersion,
					});
				}
				return;
			}

			// Check if the output is a valid url. If so, run it
			try {
				new URL(output);
			} catch {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent('mcp/setup/failed', {
						reason: 'unexpected output from mcp install command',
						'error.message': `Unexpected output from mcp install command: ${output}`,
						source: commandSource,
						'cli.version': cliVersion,
					});
				}
				Logger.error(`Unexpected output from mcp install command: ${output}`, scope);
				void window.showErrorMessage(`Failed to setup the GitKraken MCP: unknown error`);
				return;
			}

			await openUrl(output);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/completed', {
					requiresUserCompletion: true,
					source: commandSource,
					'cli.version': cliVersion,
				});
			}
		} catch (ex) {
			Logger.error(`Error during MCP installation: ${ex}`, scope);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/setup/failed', {
					reason: 'unknown error',
					'error.message': ex instanceof Error ? ex.message : 'Unknown error',
					source: commandSource,
					'cli.version': cliVersion,
				});
			}

			void window.showErrorMessage(
				`Failed to setup the GitKraken MCP: ${ex instanceof Error ? ex.message : 'Unknown error'}`,
			);
		}
	}

	@gate()
	private async installCLI(
		autoInstall?: boolean,
		source?: Sources,
	): Promise<{ cliVersion?: string; cliPath?: string; status: 'completed' | 'unsupported' | 'attempted' }> {
		const cliInstall = this.container.storage.get('gk:cli:install');
		let cliInstallAttempts = cliInstall?.attempts ?? 0;
		let cliInstallStatus = cliInstall?.status ?? 'attempted';
		let cliVersion = cliInstall?.version;
		let cliPath = this.container.storage.get('gk:cli:path');
		const platform = getPlatform();

		if (cliInstallStatus === 'completed') {
			if (cliPath == null) {
				cliInstallStatus = 'attempted';
				cliVersion = undefined;
			} else {
				cliVersion = cliInstall?.version;
				try {
					await workspace.fs.stat(Uri.joinPath(Uri.file(cliPath), platform === 'windows' ? 'gk.exe' : 'gk'));
					return { cliVersion: cliVersion, cliPath: cliPath, status: 'completed' };
				} catch {
					cliInstallStatus = 'attempted';
					cliVersion = undefined;
				}
			}
		} else if (cliInstallStatus === 'unsupported') {
			return { cliVersion: undefined, cliPath: undefined, status: 'unsupported' };
		} else if (autoInstall && cliInstallStatus === 'attempted' && cliInstallAttempts >= 5) {
			return { cliVersion: undefined, cliPath: undefined, status: 'attempted' };
		}

		try {
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

			if (isWeb) {
				void this.container.storage
					.store('gk:cli:install', {
						status: 'unsupported',
						attempts: cliInstallAttempts,
					})
					.catch();

				throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform, undefined, 'web');
			}

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
						CLIInstallErrorReason.CoreDirectory,
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
					// Use the run function to extract the installer file from the installer zip
					if (platform === 'windows') {
						// On Windows, use PowerShell to extract the zip file.
						// Force overwrite if the file already exists with -Force
						await run(
							'powershell.exe',
							[
								'-Command',
								`Expand-Archive -Path "${cliProxyZipFilePath.fsPath}" -DestinationPath "${globalStoragePath.fsPath}" -Force`,
							],
							'utf8',
						);
					} else {
						// On Unix-like systems, use the unzip command to extract the zip file, forcing overwrite with -o
						await run('unzip', ['-o', cliProxyZipFilePath.fsPath, '-d', globalStoragePath.fsPath], 'utf8');
					}

					// Check using stat to make sure the newly extracted file exists.
					cliExtractedProxyFilePath = Uri.joinPath(
						globalStoragePath,
						platform === 'windows' ? 'gk.exe' : 'gk',
					);

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
					const coreInstallOutput = await this.runCLICommand(['install'], {
						cwd: globalStoragePath.fsPath,
					});
					const directory = coreInstallOutput.match(/Directory: (.*)/);
					let directoryPath;
					if (directory != null && directory.length > 1) {
						directoryPath = directory[1];
						void this.container.storage.store('gk:cli:corePath', directoryPath).catch();
					} else {
						throw new CLIInstallError(CLIInstallErrorReason.CoreDirectory);
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

	private async runCLICommand(
		args: string[],
		options?: {
			cwd?: string;
		},
	): Promise<string> {
		const platform = getPlatform();
		const cwd = options?.cwd ?? this.container.storage.get('gk:cli:path');
		if (cwd == null) {
			throw new Error('CLI is not installed');
		}

		return run(platform === 'windows' ? 'gk.exe' : './gk', args, 'utf8', { cwd: cwd });
	}

	private async authCLI(): Promise<void> {
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
			await this.runCLICommand(['auth', 'login', '-t', currentSessionToken]);
		} catch (ex) {
			Logger.error(`Failed to auth CLI: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id != null && e.current.account.id !== e.previous?.account?.id) {
			await this.authCLI();
		}
	}

	private registerCommands(): Disposable[] {
		return [registerCommand('gitlens.ai.mcp.install', (src?: Source) => this.setupMCP(src?.source))];
	}
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
			case CLIInstallErrorReason.CoreDirectory:
				message = 'Failed to find core directory in proxy output';
				break;
			case CLIInstallErrorReason.CoreInstall:
				message = 'Failed to install core';
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

function toMcpInstallProvider(appHostName: string | undefined): string | undefined {
	switch (appHostName) {
		case 'code':
			return 'vscode';
		case 'code-insiders':
			return 'vscode-insiders';
		case 'code-exploration':
			return 'vscode-exploration';
		default:
			return appHostName;
	}
}
