import type { Event, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { Disposable, env, EventEmitter, lm, McpStdioServerDefinition, Uri, workspace } from 'vscode';
import type { Container } from '../../../../container';
import type { StorageChangeEvent } from '../../../../system/-webview/storage';
import { getHostAppName } from '../../../../system/-webview/vscode';
import { debug, log } from '../../../../system/decorators/log';
import type { Deferrable } from '../../../../system/function/debounce';
import { debounce } from '../../../../system/function/debounce';
import { Logger } from '../../../../system/logger';
import { runCLICommand, toMcpInstallProvider } from '../cli/utils';

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

type McpConfiguration = { name: string; type: string; command: string; args: string[]; version?: string };

export class GkMcpProvider implements McpServerDefinitionProvider, Disposable {
	private _cliVersion: string | undefined;
	private readonly _disposable: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	private _fireChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _getMcpConfigurationFromCLIPromise: Promise<McpConfiguration | undefined> | undefined;

	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this.container.storage.onDidChange(e => this.onStorageChanged(e)),
			lm.registerMcpServerDefinitionProvider('gitlens.gkMcpProvider', this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.workspace || !e.keys.includes('gk:cli:install')) return;

		// Only refresh if installation is completed
		const cliInstall = this.container.storage.get('gk:cli:install');
		if (cliInstall?.status !== 'completed') {
			return;
		}

		// Invalidate configuration promise if the version changed
		if (this._cliVersion !== cliInstall?.version) {
			this._getMcpConfigurationFromCLIPromise = undefined;
		}
		this._cliVersion = cliInstall?.version;

		this._fireChangeDebounced ??= debounce(() => {
			this._onDidChangeMcpServerDefinitions.fire();
		}, 500);
		this._fireChangeDebounced();
	}

	@log({ exit: true })
	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const config = await this.getMcpConfigurationFromCLI();
		if (config == null) return [];

		const serverDefinition = new McpStdioServerDefinition(
			`${config.name} (bundled with GitLens)`,
			config.command,
			config.args,
			{},
			config.version,
		);

		return [serverDefinition];
	}

	@log()
	private getMcpConfigurationFromCLI(): Promise<McpConfiguration | undefined> {
		this._getMcpConfigurationFromCLIPromise ??= this.getMcpConfigurationFromCLICore();
		return this._getMcpConfigurationFromCLIPromise;
	}

	@debug()
	private async getMcpConfigurationFromCLICore(): Promise<McpConfiguration | undefined> {
		const cliInstall = this.container.storage.get('gk:cli:install');
		const cliPath = this.container.storage.get('gk:cli:path');

		if (cliInstall?.status !== 'completed' || !cliPath) {
			return undefined;
		}

		const appName = toMcpInstallProvider(await getHostAppName());
		if (appName == null) {
			return undefined;
		}

		// Clean up any duplicate manual installations before registering the bundled version
		await this.removeDuplicateManualMcpConfigurations();

		let output = await runCLICommand(['mcp', 'config', appName, '--source=gitlens', `--scheme=${env.uriScheme}`], {
			cwd: cliPath,
		});
		output = output.replace(CLIProxyMCPConfigOutputs.checkingForUpdates, '').trim();

		try {
			const config: McpConfiguration = JSON.parse(output);

			this.onRegistrationCompleted(cliInstall.version);

			return {
				name: config.name,
				type: config.type,
				command: config.command,
				args: config.args,
				version: cliInstall.version,
			};
		} catch (ex) {
			Logger.error(`Error getting MCP configuration: ${ex}`);
			this.onRegistrationFailed('Error getting MCP configuration', undefined, cliInstall.version);
		}

		return undefined;
	}

	@debug()
	private async removeDuplicateManualMcpConfigurations(): Promise<void> {
		try {
			// Use globalStorageUri to locate the User folder where settings.json is stored
			// globalStorageUri points to: .../[AppName]/User/globalStorage/eamodio.gitlens
			// Going up 2 levels gets us to: .../[AppName]/User/
			const globalStorageUri = this.container.context.globalStorageUri;
			const userFolderUri = Uri.joinPath(globalStorageUri, '..', '..');
			const settingsUri = Uri.joinPath(userFolderUri, 'settings.json');
			
			// Check if settings file exists
			try {
				await workspace.fs.stat(settingsUri);
			} catch {
				// Settings file doesn't exist, nothing to clean up
				Logger.debug(`Settings file does not exist: ${settingsUri.fsPath}`);
				return;
			}

			// Read and parse settings file
			const settingsBytes = await workspace.fs.readFile(settingsUri);
			const settingsText = new TextDecoder().decode(settingsBytes);
			
			// Parse JSON with comments support (VS Code settings.json allows comments)
			const settings = this.parseJsonWithComments(settingsText);
			
			// Check for MCP server configurations
			const mcpServersKey = 'languageModels.chat.mcpServers';
			if (!settings[mcpServersKey] || typeof settings[mcpServersKey] !== 'object') {
				Logger.debug('No MCP server configurations found');
				return;
			}

			const mcpServers = settings[mcpServersKey] as Record<string, unknown>;
			let removedCount = 0;
			const serversToRemove: string[] = [];

			// Look for GitKraken MCP servers that were manually installed
			// These typically have names like "gitkraken" or "GitKraken" and contain
			// the GK CLI executable path
			for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
				if (this.isGitKrakenMcpServer(serverName, serverConfig)) {
					serversToRemove.push(serverName);
					Logger.log(`Found duplicate manual MCP configuration: ${serverName}`);
				}
			}

			// Remove the servers
			for (const serverName of serversToRemove) {
				mcpServers[serverName] = undefined;
				removedCount++;
			}

			if (removedCount === 0) {
				Logger.debug('No duplicate manual MCP configurations found');
				return;
			}

			// Save updated settings
			const updatedSettingsText = JSON.stringify(settings, null, '\t');
			await workspace.fs.writeFile(settingsUri, new TextEncoder().encode(updatedSettingsText));

			Logger.log(`Removed ${removedCount} duplicate manual MCP configuration(s) from ${settingsUri.fsPath}`);

			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('mcp/uninstall/duplicate', {
					app: settingsUri.fsPath,
					source: 'gk-mcp-provider',
				});
			}
		} catch (ex) {
			// Log error but don't fail the overall process
			Logger.error(`Error removing duplicate MCP configurations: ${ex}`);
		}
	}

	private parseJsonWithComments(text: string): Record<string, unknown> {
		// Simple JSON comment remover - removes // and /* */ comments
		// This is a simplified version; VS Code uses jsonc-parser for full support
		const withoutComments = text
			.replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ comments
			.replace(/\/\/.*/g, ''); // Remove // comments

		return JSON.parse(withoutComments) as Record<string, unknown>;
	}

	private isGitKrakenMcpServer(serverName: string, serverConfig: unknown): boolean {
		// Check if this is a GitKraken MCP server by looking for:
		// 1. Server name matches GitKraken variants
		// 2. Command contains 'gk' executable
		// 3. Args contain '--source=gitlens' or scheme parameter
		
		const nameMatches = /^git[_-]?kraken$/i.test(serverName);
		
		if (typeof serverConfig !== 'object' || serverConfig == null) {
			return false;
		}

		const config = serverConfig as Record<string, unknown>;
		const command = typeof config.command === 'string' ? config.command : '';
		const args = Array.isArray(config.args) ? config.args : [];
		
		// Check if command contains gk executable
		const commandMatches = command.includes('/gk') || command.includes('\\gk') || command.endsWith('gk.exe');
		
		// Check if args contain source=gitlens
		const argsMatch = args.some((arg: unknown) => 
			typeof arg === 'string' && arg.includes('--source=gitlens')
		);

		return nameMatches && commandMatches && argsMatch;
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
