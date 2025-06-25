import { arch } from 'process';
import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, ProgressLocation, Uri, window, workspace } from 'vscode';
import type { Container } from '../../../../container';
import { registerCommand } from '../../../../system/-webview/command';
import { configuration } from '../../../../system/-webview/configuration';
import { getContext } from '../../../../system/-webview/context';
import { Logger } from '../../../../system/logger';
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
			...this.registerCommands(),
		);

		this.onConfigurationChanged();
		setTimeout(() => {
			void this.installMCPIfNeeded(true);
		}, 10000 + Math.floor(Math.random() * 20000));
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

	private async installMCPIfNeeded(silent?: boolean): Promise<void> {
		try {
			if (silent && this.container.storage.get('ai:mcp:attemptInstall', false)) {
				return;
			}

			// Store the flag to indicate that we have made the attempt
			await this.container.storage.store('ai:mcp:attemptInstall', true);

			if (configuration.get('ai.enabled') === false) {
				const message = 'Cannot install MCP: AI is disabled in settings';
				Logger.log(message);
				if (silent !== true) {
					void window.showErrorMessage(message);
				}
				return;
			}

			if ( getContext('gitlens:gk:organization:ai:enabled', true) !== true) {
				const message = 'Cannot install MCP: AI is disabled by your organization';
				Logger.log(message);
				if (silent !== true) {
					void window.showErrorMessage(message);
				}
				return;
			}

			if (isWeb) {
				const message = 'Cannot install MCP: web environment is not supported';
				Logger.log(message);
				if (silent !== true) {
					void window.showErrorMessage(message);
				}
				return;
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
					const message = `Skipping MCP installation: unsupported platform ${platform}`;
					Logger.log(message);
					if (silent !== true) {
						void window.showErrorMessage(`Cannot install MCP integration: unsupported platform ${platform}`);
					}
					return;
				}
			}

			// Wrap the main installation process with progress indicator if not silent
			const installationTask = async () => {
				let mcpInstallerPath: Uri | undefined;
				let mcpExtractedFolderPath: Uri | undefined;
				let mcpExtractedPath: Uri | undefined;

				try {
					// Download the MCP proxy installer
					const proxyUrl = `https://api.gitkraken.dev/releases/gkcli-proxy/production/${platformName}/${architecture}/active`;

					let response = await fetch(proxyUrl);
					if (!response.ok) {
						const errorMsg = `Failed to get MCP installer proxy: ${response.status} ${response.statusText}`;
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}

					let downloadUrl: string | undefined;
					try {
						const mcpInstallerInfo: { version?: string; packages?: { zip?: string } } | undefined = await response.json() as any;
						downloadUrl = mcpInstallerInfo?.packages?.zip;
					} catch (ex) {
						const errorMsg = `Failed to parse MCP installer info: ${ex}`;
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}

					if (downloadUrl == null) {
						const errorMsg = 'Failed to find download URL for MCP proxy installer';
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}

					response = await fetch(downloadUrl);
					if (!response.ok) {
						const errorMsg = `Failed to download MCP proxy installer: ${response.status} ${response.statusText}`;
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}

					const installerData = await response.arrayBuffer();
					if (installerData.byteLength === 0) {
						const errorMsg = 'Downloaded installer is empty';
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}
					// installer file name is the last part of the download URL
					const installerFileName = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1);
					mcpInstallerPath = Uri.joinPath(this.container.context.globalStorageUri, installerFileName);

					// Ensure the global storage directory exists
					await workspace.fs.createDirectory(this.container.context.globalStorageUri);

					// Write the installer to the extension storage
					await workspace.fs.writeFile(mcpInstallerPath, new Uint8Array(installerData));
					Logger.log(`Downloaded MCP proxy installer successfully`);

					try {
						// Use the run function to extract the installer file from the installer zip
						if (platform === 'windows') {
							// On Windows, use PowerShell to extract the zip file
							await run(
								'powershell.exe',
								['-Command', `Expand-Archive -Path "${mcpInstallerPath.fsPath}" -DestinationPath "${this.container.context.globalStorageUri.fsPath}"`],
								'utf8',
							);
						} else {
							// On Unix-like systems, use the unzip command to extract the zip file
							await run(
								'unzip',
								['-o', mcpInstallerPath.fsPath, '-d', this.container.context.globalStorageUri.fsPath],
								'utf8',
							);
						}
						// The gk.exe file should be in a subfolder named after the installer file name
						const extractedFolderName = installerFileName.replace(/\.zip$/, '');
						mcpExtractedFolderPath = Uri.joinPath(this.container.context.globalStorageUri, extractedFolderName);
						mcpExtractedPath = Uri.joinPath(mcpExtractedFolderPath, 'gk.exe');

						// Check using stat to make sure the newly extracted file exists.
						await workspace.fs.stat(mcpExtractedPath);
					} catch (error) {
						const errorMsg = `Failed to extract MCP installer: ${error}`;
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}

					// Get the VS Code settings.json file path
					// TODO: Make this path point to the current vscode profile's settings.json once the API supports it
					const settingsPath = `${this.container.context.globalStorageUri.fsPath}\\..\\..\\settings.json`;

					// Configure the MCP server in settings.json
					try {
						await run(mcpExtractedPath.fsPath, ['mcp', 'install', 'vscode', '--file-path', settingsPath], 'utf8');
					} catch {
						// Try alternative execution methods based on platform
						try {
							Logger.log('Attempting alternative execution method for MCP install...');
							if (platform === 'windows') {
								// On Windows, try running with cmd.exe
								await run(
									'cmd.exe',
									[
										'/c',
										`"${mcpExtractedPath.fsPath}"`,
										'mcp',
										'install',
										'vscode',
										'--file-path',
										`"${settingsPath}"`,
									],
									'utf8',
								);
							} else {
								// On Unix-like systems, try running with sh
								await run(
									'/bin/sh',
									['-c', `"${mcpExtractedPath.fsPath}" mcp install vscode --file-path "${settingsPath}"`],
									'utf8',
								);
							}
						} catch (altError) {
							const errorMsg = `MCP server configuration failed: ${altError}`;
							Logger.error(errorMsg);
							throw new Error(errorMsg);
						}
					}

					// Verify that the MCP server was actually configured in settings.json
					try {
						const settingsUri = Uri.file(settingsPath);
						const settingsData = await workspace.fs.readFile(settingsUri);
						const settingsJson = JSON.parse(settingsData.toString());

						if (!settingsJson?.['mcp']?.['servers']?.['GitKraken']) {
							const errorMsg = 'MCP server configuration verification failed: Unable to update MCP settings';
							Logger.error(errorMsg);
							throw new Error(errorMsg);
						}

						Logger.log('MCP configured successfully - GitKraken server verified in settings.json');
					} catch (verifyError) {
						if (verifyError instanceof Error && verifyError.message.includes('verification failed')) {
							// Re-throw verification errors as-is
							throw verifyError;
						}
						// Handle file read/parse errors
						const errorMsg = `Failed to verify MCP configuration in settings.json: ${verifyError}`;
						Logger.error(errorMsg);
						throw new Error(errorMsg);
					}
				} finally {
					// Always clean up downloaded/extracted files, even if something failed
					if (mcpInstallerPath != null) {
						try {
							await workspace.fs.delete(mcpInstallerPath);
						} catch (error) {
							Logger.warn(`Failed to delete MCP installer zip file: ${error}`);
						}
					}

					if (mcpExtractedPath != null) {
						try {
							await workspace.fs.delete(mcpExtractedPath);
						} catch (error) {
							Logger.warn(`Failed to delete MCP extracted executable: ${error}`);
						}
					}

					if (mcpExtractedFolderPath != null) {
						try {
							await workspace.fs.delete(Uri.joinPath(mcpExtractedFolderPath, 'README.md'));
							await workspace.fs.delete(mcpExtractedFolderPath);
						} catch (error) {
							Logger.warn(`Failed to delete MCP extracted folder: ${error}`);
						}
					}
				}
			};

			// Execute the installation task with or without progress indicator
			if (silent !== true) {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: 'Installing MCP integration...',
						cancellable: false,
					},
					async () => {
						await installationTask();
					}
				);

				// Show success notification if not silent
				void window.showInformationMessage('MCP integration installed successfully');
			} else {
				await installationTask();
			}

		} catch (error) {
			Logger.error(`Error during MCP installation: ${error}`);

			// Show error notification if not silent
			if (silent !== true) {
				void window.showErrorMessage(`Failed to install MCP integration: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

		private registerCommands(): Disposable[] {
			return [registerCommand('gitlens.ai.mcp.install', () => this.installMCPIfNeeded())];
		}
}
