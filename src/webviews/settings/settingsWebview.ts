import type { ConfigurationChangeEvent, ViewColumn } from 'vscode';
import { ConfigurationTarget, Disposable, EventEmitter, workspace } from 'vscode';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { map } from '@gitlens/utils/iterable.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';
import { extensionPrefix } from '../../constants.js';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import type { ConfigPath, CoreConfigPath } from '../../system/-webview/configuration.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { CustomConfigPath } from '../protocol.js';
import { assertsConfigKeyValue, isCustomConfigKey } from '../protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../rpc/eventVisibilityBuffer.js';
import { createSharedServices, proxyServices } from '../rpc/services/common.js';
import type { WebviewHost, WebviewProvider } from '../webviewProvider.js';
import type { State } from './protocol.js';
import type { SettingsWebviewShowingArgs } from './registration.js';
import type {
	AnchorRequestedEvent,
	GenerateFormatPreviewParams,
	SettingsConfigSnapshot,
	SettingsInitialContext,
	SettingsScope,
	SettingsServices,
	SettingsUpdateParams,
} from './settingsService.js';

export class SettingsWebviewProvider implements WebviewProvider<State, State, SettingsWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _pendingAnchor: string | undefined;
	private _telemetryContext: Record<`context.${string}`, string | number | boolean | undefined> | undefined;

	private readonly _onAnchorRequested = new EventEmitter<AnchorRequestedEvent>();
	private readonly _onDidChangeConfig = new EventEmitter<SettingsConfigSnapshot>();

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.settings'>,
	) {
		this._disposable = Disposable.from(
			this._onAnchorRequested,
			this._onDidChangeConfig,
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			...this._telemetryContext,
		};
	}

	includeBootstrap(): State {
		// Webview fetches all data via RPC — bootstrap only provides metadata
		return this.host.baseWebviewState;
	}

	onShowing(
		loading: boolean,
		_options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: SettingsWebviewShowingArgs
	): [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined] {
		const anchor = args[0];
		if (anchor && typeof anchor === 'string') {
			if (!loading && this.host.ready && this.host.visible) {
				this._onAnchorRequested.fire({ anchor: anchor });
			} else {
				this._pendingAnchor = anchor;
			}
		}

		return [true, undefined];
	}

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): SettingsServices {
		const shared = createSharedServices(
			this.container,
			this.host,
			context => {
				this._telemetryContext = context;
			},
			buffer,
			tracker,
		);

		return proxyServices({
			...shared,

			settings: {
				// ── Events ──

				onAnchorRequested: createRpcEventSubscription<AnchorRequestedEvent>(
					buffer,
					'anchorRequested',
					'save-last',
					buffered => this._onAnchorRequested.event(buffered),
					undefined,
					tracker,
				),

				onConfigChanged: createRpcEventSubscription<SettingsConfigSnapshot>(
					buffer,
					'configChanged',
					'save-last',
					buffered => this._onDidChangeConfig.event(buffered),
					undefined,
					tracker,
				),

				// ── Initialization ──

				getInitialContext: () => Promise.resolve(this.getInitialContext()),

				// ── Mutations ──

				update: params => this.updateConfiguration(params),

				// ── Queries ──

				generateFormatPreview: params => Promise.resolve(this.generateFormatPreview(params)),
			},
		} satisfies SettingsServices);
	}

	private getInitialContext(): SettingsInitialContext {
		const scopes: SettingsScope[] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		const anchor = this._pendingAnchor;
		this._pendingAnchor = undefined;

		return {
			...this.getConfigSnapshot(),
			version: this.container.version,
			scopes: scopes,
			anchor: anchor,
		};
	}

	private getConfigSnapshot(): SettingsConfigSnapshot {
		return {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
		};
	}

	private async updateConfiguration(params: SettingsUpdateParams): Promise<void> {
		const target = params.scope === 'workspace' ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;

		for (const key of Object.keys(params.changes) as (ConfigPath | CustomConfigPath)[]) {
			if (isCustomConfigKey(key)) {
				const value = params.changes[key];
				const customSetting = this.customSettings.get(key);
				if (customSetting != null && typeof value === 'boolean') {
					await customSetting.update(value);
				}

				continue;
			}

			let value = params.changes[key];
			assertsConfigKeyValue(key, value);

			const inspect = configuration.inspect(key)!;

			if (value != null) {
				if (params.scope === 'workspace') {
					if (value === inspect.workspaceValue) continue;
				} else {
					if (value === inspect.globalValue && value !== inspect.defaultValue) continue;

					if (value === inspect.defaultValue) {
						value = undefined;
					}
				}
			}

			await configuration.update(key, value, target);
		}

		for (const key of params.removes) {
			await configuration.update(key as ConfigPath, undefined, target);
		}
	}

	private generateFormatPreview(params: GenerateFormatPreviewParams): string {
		const commit = new GitCommit(
			'~/code/eamodio/vscode-gitlens-demo',
			'fe26af408293cba5b4bfd77306e1ac9ff7ccaef8',
			new GitCommitIdentity(
				'Eric Amodio',
				'eamodio@gmail.com',
				new Date('2016-11-12T20:41:00.000Z'),
				undefined,
				true,
			),
			new GitCommitIdentity(
				'Eric Amodio',
				'eamodio@gmail.com',
				new Date('2020-11-01T06:57:21.000Z'),
				undefined,
				true,
			),
			params.type === 'commit-uncommitted' ? 'Uncommitted changes' : 'Supercharged',
			['3ac1d3f51d7cf5f438cc69f25f6740536ad80fef'],
			params.type === 'commit-uncommitted' ? 'Uncommitted changes' : 'Supercharged',
			{
				files: undefined,
				filtered: {
					files: [
						new GitFileChange(
							'~/code/eamodio/vscode-gitlens-demo',
							'code.ts',
							GitFileIndexStatus.Modified,
							joinUriPath(fileUri('/code/eamodio/vscode-gitlens-demo'), 'code.ts'),
						),
					],
					pathspec: 'code.ts',
				},
			},
			undefined,
			[],
		);

		let includePullRequest = false;
		switch (params.key) {
			case configuration.name('currentLine.format'):
				includePullRequest = configuration.get('currentLine.pullRequests.enabled');
				break;
			case configuration.name('statusBar.format'):
				includePullRequest = configuration.get('statusBar.pullRequests.enabled');
				break;
		}

		let pr: PullRequest | undefined;
		if (includePullRequest) {
			pr = new PullRequest(
				{ id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
				{
					id: 'eamodio',
					name: 'Eric Amodio',
					avatarUrl: 'https://avatars1.githubusercontent.com/u/641685?s=32&v=4',
					url: 'https://github.com/eamodio',
				},
				'1',
				undefined,
				'Supercharged',
				'https://github.com/gitkraken/vscode-gitlens/pulls/1',
				{ owner: 'gitkraken', repo: 'vscode-gitlens' },
				'merged',
				new Date('Sat, 12 Nov 2016 19:41:00 GMT'),
				new Date('Sat, 12 Nov 2016 19:41:00 GMT'),
				undefined,
				new Date('Sat, 12 Nov 2016 20:41:00 GMT'),
			);
		}

		try {
			return CommitFormatter.fromTemplate(params.format, commit, {
				dateFormat: configuration.get('defaultDateFormat'),
				pullRequest: pr,
				messageTruncateAtNewLine: true,
			});
		} catch {
			return 'Invalid format';
		}
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changedAny(e, extensionPrefix)) {
			const notify = configuration.changedAny<CustomSetting['name']>(e, [
				...map(this.customSettings.values(), s => s.name),
			]);
			if (!notify) return;
		}

		this._onDidChangeConfig.fire(this.getConfigSnapshot());
	}

	private _customSettings: Map<CustomConfigPath, CustomSetting> | undefined;
	private get customSettings() {
		this._customSettings ??= new Map<CustomConfigPath, CustomSetting>([
			[
				'rebaseEditor.enabled',
				{
					name: 'workbench.editorAssociations',
					enabled: () => this.container.rebaseEditor.enabled,
					update: enabled => this.container.rebaseEditor.setEnabled(enabled),
				},
			],
			[
				'currentLine.useUncommittedChangesFormat',
				{
					name: 'currentLine.uncommittedChangesFormat',
					enabled: () => configuration.get('currentLine.uncommittedChangesFormat') != null,
					update: async enabled =>
						configuration.updateEffective(
							'currentLine.uncommittedChangesFormat',
							// oxlint-disable-next-line no-template-curly-in-string
							enabled ? '\u270F\ufe0f ${ago}' : null,
						),
				},
			],
		]);
		return this._customSettings;
	}

	private getCustomSettings(): Record<string, boolean> {
		const customSettings: Record<string, boolean> = Object.create(null);
		for (const [key, setting] of this.customSettings) {
			customSettings[key] = setting.enabled();
		}
		return customSettings;
	}
}

interface CustomSetting {
	name: ConfigPath | CoreConfigPath;
	enabled: () => boolean;
	update: (enabled: boolean) => Promise<void>;
}
