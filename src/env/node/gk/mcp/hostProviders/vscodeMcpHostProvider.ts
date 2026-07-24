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

	/** VS Code suppresses a timeout-driven refresh once it has pulled a definition (avoids a spurious
	 *  pull); see `GkMcpService.onIpcTimeoutExpired`. */
	shouldFireOnTimeout(): boolean {
		return !this._hasProvidedDefinition;
	}

	@debug({ exit: true })
	async provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		const config = await this.service.resolveMcpConfig();
		if (config == null) return [];

		void this.container.usage.track('action:gitlens.mcp.bundledMcpDefinitionProvided:happened');

		this._hasProvidedDefinition = true;

		const serverDefinition = new McpStdioServerDefinition(
			config.name,
			config.command,
			config.args,
			undefined,
			config.version,
		);
		serverDefinition.cwd = this.container.context.globalStorageUri;

		return [serverDefinition];
	}
}
