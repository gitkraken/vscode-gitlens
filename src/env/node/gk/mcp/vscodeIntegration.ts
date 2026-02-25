import type { Disposable, Event, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { EventEmitter, lm, McpStdioServerDefinition } from 'vscode';
import type { Container } from '../../../../container.js';
import { debug } from '../../../../system/decorators/log.js';
import { GkMcpProviderBase } from './integrationBase.js';

export class VSCodeGkMcpProvider extends GkMcpProviderBase implements McpServerDefinitionProvider {
	private readonly _lmRegistration: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	private _hasProvidedDefinition: boolean = false;

	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(container: Container) {
		super(container);
		this._lmRegistration = lm.registerMcpServerDefinitionProvider('gitlens.gkMcpProvider', this);
	}

	protected override onDispose(): void {
		this._lmRegistration.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}

	protected override shouldFireOnTimeout(): boolean {
		return !this._hasProvidedDefinition;
	}

	protected override fireChangeCore(): void {
		this._onDidChangeMcpServerDefinitions.fire();
	}

	@debug({ exit: true })
	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const { environmentVariableCollection: envVars } = this.container.context;
		const discoveryFilePath = envVars.get('GK_GL_PATH')?.value;

		// Gives time for the IPC server to start and set the environment variables
		if (discoveryFilePath != null) {
			this.clearIpcTimeout();
		} else if (this._waitingForIPC) {
			return [];
		}

		const config = await this.getMcpConfigurationFromCLI();
		if (config == null) return [];

		void this.container.usage.track('action:gitlens.mcp.bundledMcpDefinitionProvided:happened');

		// Mark that we've provided a definition (either with or without GK_GL_PATH)
		this._hasProvidedDefinition = true;

		const serverEnv: McpStdioServerDefinition['env'] = {};
		if (discoveryFilePath != null) {
			serverEnv['GK_GL_PATH'] = discoveryFilePath;
		}

		const serverDefinition = new McpStdioServerDefinition(
			config.name,
			config.command,
			config.args,
			serverEnv,
			config.version,
		);

		return [serverDefinition];
	}
}
