import type { Event, McpServerDefinition } from 'vscode';
import { Disposable, env, EventEmitter, lm, McpStdioServerDefinition, window } from 'vscode';
import type { Container } from '../../../../container';
import type { StorageChangeEvent } from '../../../../system/-webview/storage';
import { getHostAppName } from '../../../../system/-webview/vscode';
import { debounce } from '../../../../system/function/debounce';
import { Logger } from '../../../../system/logger';
import { runCLICommand, toMcpInstallProvider } from '../cli/utils';

const CLIProxyMCPConfigOutputs = {
	checkingForUpdates: /checking for updates.../i,
} as const;

export class McpProvider implements Disposable {
	private readonly _disposable: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this.container.storage.onDidChange(e => this.checkStorage(e)),
			lm.registerMcpServerDefinitionProvider('gitlens.mcpProvider', {
				onDidChangeMcpServerDefinitions: this._onDidChangeMcpServerDefinitions.event,
				provideMcpServerDefinitions: () => this.provideMcpServerDefinitions(),
			}),
		);

		this.checkStorage();
	}

	private checkStorage(e?: StorageChangeEvent): void {
		if (e != null && !(e.keys as string[]).includes('gk:cli:install')) return;
		this._onDidChangeMcpServerDefinitions.fire();
	}

	private async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const config = await this.getMcpConfigurationFromCLI();
		if (config == null) {
			return [];
		}

		const serverDefinition = new McpStdioServerDefinition(
			config.name,
			config.command,
			config.args,
			{},
			config.version,
		);

		this.notifyServerProvided();

		return [serverDefinition];
	}

	// private async getMcpConfiguration(): Promise<
	// 	{ name: string; type: string; command: string; args: string[]; version?: string } | undefined
	// > {
	// 	const cliInstall = this.container.storage.get('gk:cli:install');
	// 	const cliPath = this.container.storage.get('gk:cli:path');

	// 	if (cliInstall?.status !== 'completed' || !cliPath) {
	// 		return undefined;
	// 	}

	// 	const platform = getPlatform();
	// 	const executable = platform === 'windows' ? 'gk.exe' : 'gk';
	// 	const command = Uri.joinPath(Uri.file(cliPath), executable);

	// 	const appName = toMcpInstallProvider(await getHostAppName());
	// 	const args = ['mcp', `--host=${appName}`, '--source=gitlens', `--scheme=${env.uriScheme}`];
	// 	return {
	// 		name: 'GitKraken MCP Server',
	// 		type: 'stdio',
	// 		command: command.fsPath,
	// 		args: args,
	// 		version: cliInstall.version,
	// 	};
	// }

	private async getMcpConfigurationFromCLI(): Promise<
		{ name: string; type: string; command: string; args: string[]; version?: string } | undefined
	> {
		const cliInstall = this.container.storage.get('gk:cli:install');
		const cliPath = this.container.storage.get('gk:cli:path');

		if (cliInstall?.status !== 'completed' || !cliPath) {
			return undefined;
		}

		const appName = toMcpInstallProvider(await getHostAppName());
		if (appName == null) {
			return undefined;
		}

		let output = await runCLICommand(['mcp', 'config', appName, '--source=gitlens', `--scheme=${env.uriScheme}`], {
			cwd: cliPath,
		});
		output = output.replace(CLIProxyMCPConfigOutputs.checkingForUpdates, '').trim();
		console.log(output);

		try {
			const configuration = JSON.parse(output) as { name: string; type: string; command: string; args: string[] };

			return {
				name: configuration.name,
				type: configuration.type,
				command: configuration.command,
				args: configuration.args,
				version: cliInstall.version,
			};
		} catch (ex) {
			Logger.error(`Error getting MCP configuration: ${ex}`);
		}

		return undefined;
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}

	private _notifyServerProvided = false;
	private notifyServerProvided = debounce(() => {
		if (this._notifyServerProvided) return;

		void window.showInformationMessage('GitLens can now automatically configure the GitKraken MCP server for you');
		this._notifyServerProvided = true;
	}, 250);
}
