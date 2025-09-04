import type { Event, McpServerDefinition, McpStdioServerDefinition } from 'vscode';
import { version as codeVersion, Disposable, EventEmitter, lm } from 'vscode';
import type { Container } from '../../../container';
import { satisfies } from '../../../system/version';

export class McpProvider implements Disposable {
	static #instance: McpProvider | undefined;

	static create(container: Container): McpProvider | undefined {
		if (!satisfies(codeVersion, '>= 1.101.0') || !lm.registerMcpServerDefinitionProvider) return undefined;

		if (this.#instance == null) {
			this.#instance = new McpProvider(container);
		}

		return this.#instance;
	}

	private readonly _disposable: Disposable;
	private readonly _onDidChangeMcpServerDefinitions = new EventEmitter<void>();
	get onDidChangeMcpServerDefinitions(): Event<void> {
		return this._onDidChangeMcpServerDefinitions.event;
	}

	private serverDefinitions: McpServerDefinition[] = [];

	private constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			lm.registerMcpServerDefinitionProvider('gitlens.mcpProvider', {
				onDidChangeMcpServerDefinitions: this._onDidChangeMcpServerDefinitions.event,
				provideMcpServerDefinitions: () => this.provideMcpServerDefinitions(),
			}),
		);
	}

	private provideMcpServerDefinitions(): Promise<McpServerDefinition[]> {
		return Promise.resolve([]);
	}

	registerMcpServer(): Promise<void> {
		return Promise.resolve();
	}

	dispose(): void {
		this._disposable.dispose();
	}
}
