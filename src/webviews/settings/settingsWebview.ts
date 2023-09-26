import type { ConfigurationChangeEvent, Disposable, ViewColumn } from 'vscode';
import { ConfigurationTarget, workspace } from 'vscode';
import type { CoreConfiguration } from '../../constants';
import { extensionPrefix } from '../../constants';
import type { Container } from '../../container';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { GitCommit, GitCommitIdentity } from '../../git/models/commit';
import { GitFileChange, GitFileIndexStatus } from '../../git/models/file';
import { PullRequest } from '../../git/models/pullRequest';
import type { ConfigPath } from '../../system/configuration';
import { configuration } from '../../system/configuration';
import { map } from '../../system/iterable';
import { Logger } from '../../system/logger';
import type { CustomConfigPath, IpcMessage } from '../protocol';
import {
	assertsConfigKeyValue,
	DidChangeConfigurationNotificationType,
	DidGenerateConfigurationPreviewNotificationType,
	DidOpenAnchorNotificationType,
	GenerateConfigurationPreviewCommandType,
	isCustomConfigKey,
	onIpc,
	UpdateConfigurationCommandType,
} from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { State } from './protocol';

export class SettingsWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;
	private _pendingJumpToAnchor: string | undefined;

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewController<State>,
	) {
		this._disposable = configuration.onDidChangeAny(this.onAnyConfigurationChanged, this);
	}

	dispose() {
		this._disposable.dispose();
	}

	includeBootstrap(): State {
		const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		return {
			webviewId: this.host.id,
			timestamp: Date.now(),
			version: this.container.version,
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
			scope: 'user',
			scopes: scopes,
		};
	}

	onReloaded(): void {
		void this.notifyDidChangeConfiguration();
	}

	onShowing?(
		loading: boolean,
		_options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: unknown[]
	): boolean | Promise<boolean> {
		const anchor = args[0];
		if (anchor && typeof anchor === 'string') {
			if (!loading && this.host.ready && this.host.visible) {
				queueMicrotask(
					() =>
						void this.host.notify(DidOpenAnchorNotificationType, {
							anchor: anchor,
							scrollBehavior: 'smooth',
						}),
				);
				return true;
			}

			this._pendingJumpToAnchor = anchor;
		}

		return true;
	}

	onActiveChanged(active: boolean): void {
		// Anytime the webview becomes active, make sure it has the most up-to-date config
		if (active) {
			void this.notifyDidChangeConfiguration();
		}
	}

	onReady() {
		if (this._pendingJumpToAnchor != null) {
			const anchor = this._pendingJumpToAnchor;
			this._pendingJumpToAnchor = undefined;

			void this.host.notify(DidOpenAnchorNotificationType, { anchor: anchor, scrollBehavior: 'auto' });
		}
	}

	onMessageReceived(e: IpcMessage): void {
		if (e == null) return;

		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				Logger.debug(`Webview(${this.host.id}).onMessageReceived: method=${e.method}`);

				onIpc(UpdateConfigurationCommandType, e, async params => {
					const target =
						params.scope === 'workspace' ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;

					let key: keyof typeof params.changes;
					for (key in params.changes) {
						let value = params.changes[key];

						if (isCustomConfigKey(key)) {
							const customSetting = this.customSettings.get(key);
							if (customSetting != null) {
								if (typeof value === 'boolean') {
									await customSetting.update(value);
								} else {
									debugger;
								}
							}

							continue;
						}

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
				});
				break;

			case GenerateConfigurationPreviewCommandType.method:
				Logger.debug(`Webview(${this.host.id}).onMessageReceived: method=${e.method}`);

				onIpc(GenerateConfigurationPreviewCommandType, e, async params => {
					switch (params.type) {
						case 'commit':
						case 'commit-uncommitted': {
							const commit = new GitCommit(
								this.container,
								'~/code/eamodio/vscode-gitlens-demo',
								'fe26af408293cba5b4bfd77306e1ac9ff7ccaef8',
								new GitCommitIdentity('You', 'eamodio@gmail.com', new Date('2016-11-12T20:41:00.000Z')),
								new GitCommitIdentity('You', 'eamodio@gmail.com', new Date('2020-11-01T06:57:21.000Z')),
								params.type === 'commit-uncommitted' ? 'Uncommitted changes' : 'Supercharged',
								['3ac1d3f51d7cf5f438cc69f25f6740536ad80fef'],
								params.type === 'commit-uncommitted' ? 'Uncommitted changes' : 'Supercharged',
								new GitFileChange(
									'~/code/eamodio/vscode-gitlens-demo',
									'code.ts',
									GitFileIndexStatus.Modified,
								),
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
										name: 'Eric Amodio',
										avatarUrl: 'https://avatars1.githubusercontent.com/u/641685?s=32&v=4',
										url: 'https://github.com/eamodio',
									},
									'1',
									'Supercharged',
									'https://github.com/gitkraken/vscode-gitlens/pulls/1',
									'merged',
									new Date('Sat, 12 Nov 2016 19:41:00 GMT'),
									undefined,
									new Date('Sat, 12 Nov 2016 20:41:00 GMT'),
								);
							}

							let preview;
							try {
								preview = CommitFormatter.fromTemplate(params.format, commit, {
									dateFormat: configuration.get('defaultDateFormat'),
									pullRequest: pr,
									messageTruncateAtNewLine: true,
								});
							} catch {
								preview = 'Invalid format';
							}

							await this.host.notify(
								DidGenerateConfigurationPreviewNotificationType,
								{ preview: preview },
								e.completionId,
							);
						}
					}
				});
				break;
		}
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changedAny(e, extensionPrefix)) {
			const notify = configuration.changedAny<CustomSetting['name']>(e, [
				...map(this.customSettings.values(), s => s.name),
			]);
			if (!notify) return;
		}

		void this.notifyDidChangeConfiguration();
	}

	private _customSettings: Map<CustomConfigPath, CustomSetting> | undefined;
	private get customSettings() {
		if (this._customSettings == null) {
			this._customSettings = new Map<CustomConfigPath, CustomSetting>([
				[
					'rebaseEditor.enabled',
					{
						name: 'workbench.editorAssociations',
						enabled: () => this.container.rebaseEditor.enabled,
						update: this.container.rebaseEditor.setEnabled,
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
								// eslint-disable-next-line no-template-curly-in-string
								enabled ? '✏️ ${ago}' : null,
							),
					},
				],
			]);
		}
		return this._customSettings;
	}

	protected getCustomSettings(): Record<string, boolean> {
		const customSettings: Record<string, boolean> = Object.create(null);
		for (const [key, setting] of this.customSettings) {
			customSettings[key] = setting.enabled();
		}
		return customSettings;
	}

	private notifyDidChangeConfiguration() {
		// Make sure to get the raw config, not from the container which has the modes mixed in
		return this.host.notify(DidChangeConfigurationNotificationType, {
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
		});
	}
}

interface CustomSetting {
	name: ConfigPath | CoreConfiguration;
	enabled: () => boolean;
	update: (enabled: boolean) => Promise<void>;
}
