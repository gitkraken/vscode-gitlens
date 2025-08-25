import { arch } from 'process';
import type { ConfigurationChangeEvent } from 'vscode';
import { version as codeVersion, Disposable, env, ProgressLocation, Uri, window, workspace } from 'vscode';
import type { Container } from '../../../../container';
import type { SubscriptionChangeEvent } from '../../../../plus/gk/subscriptionService';
import { registerCommand } from '../../../../system/-webview/command';
import { configuration } from '../../../../system/-webview/configuration';
import { getContext } from '../../../../system/-webview/context';
import { openUrl } from '../../../../system/-webview/vscode/uris';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { compare } from '../../../../system/version';
import { run } from '../../git/shell';
import { getPlatform, isWeb } from '../../platform';
import { CliCommandHandlers } from './commands';
import type { IpcServer } from './ipcServer';
import { createIpcServer } from './ipcServer';

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

		const mcpInstallStatus = this.container.storage.get('ai:mcp:install');
		if (!mcpInstallStatus) {
			setTimeout(() => this.setupMCPInstallation(true), 10000 + Math.floor(Math.random() * 20000));
		}
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

	private async installMCP(): Promise<void> {
		const scope = getLogScope();
		try {
			if (
				(env.appName === 'Visual Studio Code' || env.appName === 'Visual Studio Code - Insiders') &&
				compare(codeVersion, '1.102') < 0
			) {
				void window.showInformationMessage('Use of this command requires VS Code 1.102 or later.');
				return;
			}

			let appName = 'vscode';
			let isInsiders = false;
			switch (env.appName) {
				case 'Visual Studio Code':
					break;
				case 'Visual Studio Code - Insiders':
					isInsiders = true;
					break;
				case 'Cursor':
					appName = 'cursor';
					break;
				case 'Windsurf':
					appName = 'windsurf';
					break;
				default: {
					void window.showInformationMessage(`MCP installation is not supported for app: ${env.appName}`);
					return;
				}
			}

			let autoInstallProgress = this.container.storage.get('ai:mcp:install');
			let mcpPath = this.container.storage.get('ai:mcp:installPath');
			let mcpFileExists = true;
			if (mcpPath != null) {
				try {
					await workspace.fs.stat(
						Uri.joinPath(Uri.file(mcpPath), getPlatform() === 'windows' ? 'gk.exe' : 'gk'),
					);
				} catch {
					mcpFileExists = false;
				}
			}
			if (autoInstallProgress !== 'completed' || mcpPath == null || !mcpFileExists) {
				await this.setupMCPInstallation();
			}

			autoInstallProgress = this.container.storage.get('ai:mcp:install');
			mcpPath = this.container.storage.get('ai:mcp:installPath');
			if (autoInstallProgress !== 'completed' || mcpPath == null) {
				void window.showErrorMessage('Failed to install MCP integration: setup failed to complete.');
				return;
			}

			// TODO: REMOVE THIS ONCE VSCODE-INSIDERS IS ADDED AS AN OFFICIAL PROVIDER TO MCP INSTALL COMMAND
			if (appName === 'vscode' && isInsiders) {
				const mcpFileName = getPlatform() === 'windows' ? 'gk.exe' : 'gk';
				const mcpProxyPath = Uri.joinPath(Uri.file(mcpPath), mcpFileName);
				const config = {
					name: 'GitKraken',
					command: mcpProxyPath.fsPath,
					args: ['mcp'],
					type: 'stdio',
				};
				const installDeepLinkUrl = `vscode-insiders:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
				await openUrl(installDeepLinkUrl);
			} else {
				if (appName !== 'cursor' && appName !== 'vscode') {
					const confirmation = await window.showInformationMessage(
						`MCP configured successfully. Click 'Finish' to add it to your MCP server list and complete the installation.`,
						{ modal: true },
						{ title: 'Finish' },
						{ title: 'Cancel', isCloseAffordance: true },
					);
					if (confirmation == null || confirmation.title === 'Cancel') return;
				}

				const _output = await this.runMcpCommand(['mcp', 'install', appName, '--source=gitlens'], {
					cwd: mcpPath,
				});
				// TODO: GET THE INSTALL LINK FROM THE OUTPUT IF IT EXISTS AND OPEN IT.
				// CURRENTLY THE CLI TRIES TO DO SO BUT THE LINK DOES NOT WORK SINCE IT IS IN THE CHILD PROCESS.
			}
		} catch (ex) {
			Logger.error(`Error during MCP installation: ${ex}`, scope);

			void window.showErrorMessage(
				`Failed to install MCP integration: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
		}
	}

	private async setupMCPInstallation(autoInstall?: boolean): Promise<void> {
		try {
			if (
				(env.appName === 'Visual Studio Code' || env.appName === 'Visual Studio Code - Insiders') &&
				compare(codeVersion, '1.102') < 0
			) {
				return;
			}

			// Kick out early if we already attempted an auto-install
			if (autoInstall && this.container.storage.get('ai:mcp:install')) {
				return;
			}

			void this.container.storage.store('ai:mcp:install', 'attempted').catch();

			if (configuration.get('ai.enabled') === false) {
				throw new Error('AI is disabled in settings');
			}

			if (getContext('gitlens:gk:organization:ai:enabled', true) !== true) {
				throw new Error('AI is disabled by your organization');
			}

			if (isWeb) {
				throw new Error('Web environment is not supported');
			}

			// Detect platform and architecture
			const platform = getPlatform();

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
					throw new Error(`Unsupported platform ${platform}`);
				}
			}

			// Wrap the main installation process with progress indicator if not silent
			const installationTask = async () => {
				let mcpInstallerPath: Uri | undefined;
				let mcpExtractedFilePath: Uri | undefined;
				const mcpFolderPath = this.container.context.globalStorageUri;

				try {
					// Download the MCP proxy installer
					const proxyUrl = this.container.urls.getGkApiUrl(
						'releases',
						'gkcli-proxy',
						'production',
						platformName,
						architecture,
						'active',
					);

					let response = await fetch(proxyUrl);
					if (!response.ok) {
						throw new Error(`Failed to get MCP installer info: ${response.status} ${response.statusText}`);
					}

					let downloadUrl: string | undefined;
					try {
						const mcpInstallerInfo: { version?: string; packages?: { zip?: string } } | undefined =
							(await response.json()) as any;
						downloadUrl = mcpInstallerInfo?.packages?.zip;
					} catch (ex) {
						throw new Error(`Failed to parse MCP installer info: ${ex}`);
					}

					if (downloadUrl == null) {
						throw new Error('Failed to find download URL for MCP proxy installer');
					}

					response = await fetch(downloadUrl);
					if (!response.ok) {
						throw new Error(
							`Failed to fetch MCP proxy installer: ${response.status} ${response.statusText}`,
						);
					}

					const installerData = await response.arrayBuffer();
					if (installerData.byteLength === 0) {
						throw new Error('Fetched MCP installer is empty');
					}
					// installer file name is the last part of the download URL
					const installerFileName = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1);
					mcpInstallerPath = Uri.joinPath(mcpFolderPath, installerFileName);

					// Ensure the global storage directory exists
					try {
						await workspace.fs.createDirectory(mcpFolderPath);
					} catch (ex) {
						throw new Error(`Failed to create global storage directory for MCP: ${ex}`);
					}

					// Write the installer to the extension storage
					try {
						await workspace.fs.writeFile(mcpInstallerPath, new Uint8Array(installerData));
					} catch (ex) {
						throw new Error(`Failed to download MCP installer: ${ex}`);
					}

					try {
						// Use the run function to extract the installer file from the installer zip
						if (platform === 'windows') {
							// On Windows, use PowerShell to extract the zip file.
							// Force overwrite if the file already exists and the force param is true
							await run(
								'powershell.exe',
								[
									'-Command',
									`Expand-Archive -Path "${mcpInstallerPath.fsPath}" -DestinationPath "${mcpFolderPath.fsPath}" -Force`,
								],
								'utf8',
							);
						} else {
							// On Unix-like systems, use the unzip command to extract the zip file
							await run('unzip', ['-o', mcpInstallerPath.fsPath, '-d', mcpFolderPath.fsPath], 'utf8');
						}

						// Check using stat to make sure the newly extracted file exists.
						mcpExtractedFilePath = Uri.joinPath(mcpFolderPath, platform === 'windows' ? 'gk.exe' : 'gk');
						await workspace.fs.stat(mcpExtractedFilePath);
						void this.container.storage.store('ai:mcp:installPath', mcpFolderPath.fsPath).catch();
					} catch (ex) {
						throw new Error(`Failed to extract MCP installer: ${ex}`);
					}

					// Set up the local MCP server files
					try {
						const installOutput = await this.runMcpCommand(['install'], {
							cwd: mcpFolderPath.fsPath,
						});
						const directory = installOutput.match(/Directory: (.*)/);
						let directoryPath;
						if (directory != null && directory.length > 1) {
							directoryPath = directory[1];
							void this.container.storage.store('gk:cli:installedPath', directoryPath).catch();
						} else {
							throw new Error('Failed to find directory in CLI install output');
						}

						Logger.log('MCP setup completed.');
						void this.container.storage.store('ai:mcp:install', 'completed').catch();
						await this.authMCPServer();
					} catch (ex) {
						throw new Error(`MCP server configuration failed: ${ex}`);
					}
				} finally {
					// Clean up the installer zip file
					if (mcpInstallerPath != null) {
						try {
							await workspace.fs.delete(mcpInstallerPath);
						} catch (ex) {
							Logger.warn(`Failed to delete MCP installer zip file: ${ex}`);
						}
					}

					try {
						const readmePath = Uri.joinPath(mcpFolderPath, 'README.md');
						await workspace.fs.delete(readmePath);
					} catch {}
				}
			};

			// Execute the installation task with or without progress indicator
			if (!autoInstall) {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: 'Setting up MCP integration...',
						cancellable: false,
					},
					async () => {
						await installationTask();
					},
				);
			} else {
				await installationTask();
			}
		} catch (ex) {
			const errorMsg = `Failed to configure MCP: ${ex instanceof Error ? ex.message : String(ex)}`;
			if (!autoInstall) {
				throw new Error(errorMsg);
			} else {
				Logger.error(errorMsg);
			}
		}
	}

	private async runMcpCommand(
		args: string[],
		options?: {
			cwd?: string;
		},
	): Promise<string> {
		const platform = getPlatform();
		const cwd = options?.cwd ?? this.container.storage.get('ai:mcp:installPath');
		if (cwd == null) {
			throw new Error('MCP is not installed');
		}

		return run(platform === 'windows' ? 'gk.exe' : './gk', args, 'utf8', { cwd: cwd });
	}

	private async authMCPServer(): Promise<void> {
		const mcpInstallStatus = this.container.storage.get('ai:mcp:install');
		const mcpInstallPath = this.container.storage.get('ai:mcp:installPath');
		if (mcpInstallStatus !== 'completed' || mcpInstallPath == null) {
			return;
		}

		const currentSessionToken = (await this.container.subscription.getAuthenticationSession())?.accessToken;
		if (currentSessionToken == null) {
			return;
		}

		try {
			await this.runMcpCommand(['auth', 'login', '-t', currentSessionToken]);
		} catch (ex) {
			Logger.error(`Failed to auth MCP server: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id != null && e.current.account.id !== e.previous?.account?.id) {
			await this.authMCPServer();
		}
	}

	private registerCommands(): Disposable[] {
		return [registerCommand('gitlens.ai.mcp.install', () => this.installMCP())];
	}
}
