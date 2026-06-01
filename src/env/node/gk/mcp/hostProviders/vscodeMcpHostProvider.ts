import type { Disposable, Event, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { EventEmitter, lm, McpStdioServerDefinition } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import type { Container } from '../../../../../container.js';
import type { GkMcpService } from '../gkMcpService.js';
import type { McpHostRegistrationProvider } from './types.js';

export class VSCodeMcpHostProvider implements McpHostRegistrationProvider, McpServerDefinitionProvider {
	private readonly _lmRegistration: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	private _hasProvidedDefinition = false;

	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	constructor(
		private readonly container: Container,
		private readonly service: GkMcpService,
	) {
		this._lmRegistration = lm.registerMcpServerDefinitionProvider('gitlens.gkMcpProvider', this);
	}

	dispose(): void {
		this._lmRegistration.dispose();
		this._onDidChangeMcpServerDefinitions.dispose();
	}

	refresh(): void {
		this._onDidChangeMcpServerDefinitions.fire();
	}

	/** True if VS Code has pulled definitions from us — used by the service to decide
	 *  whether to fire after the 30s IPC timeout (matches today's `shouldFireOnTimeout`). */
	get hasProvidedDefinition(): boolean {
		return this._hasProvidedDefinition;
	}

	@debug({ exit: true })
	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const discoveryFilePath = this.service.discoveryFilePath;

		if (discoveryFilePath != null) {
			this.service.clearIpcTimeout();
		} else if (this.service.isWaitingForIpc) {
			return [];
		}

		const config = await this.service.getMcpConfig();
		if (config == null) return [];

		void this.container.usage.track('action:gitlens.mcp.bundledMcpDefinitionProvided:happened');

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
		serverDefinition.cwd = this.container.context.globalStorageUri;

		return [serverDefinition];
	}
}
