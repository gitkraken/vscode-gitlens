import type { ConfigurationChangeEvent, WebviewPanelOnDidChangeViewStateEvent } from 'vscode';
import { ConfigurationTarget } from 'vscode';
import type { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import { GitCommit, GitCommitIdentity } from '../git/models/commit';
import { GitFileChange, GitFileIndexStatus } from '../git/models/file';
import { PullRequest, PullRequestState } from '../git/models/pullRequest';
import type { Path, PathValue } from '../system/configuration';
import { configuration } from '../system/configuration';
import { Logger } from '../system/logger';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import type { IpcMessage } from './protocol';
import {
	DidChangeConfigurationNotificationType,
	DidGenerateConfigurationPreviewNotificationType,
	GenerateConfigurationPreviewCommandType,
	onIpc,
	UpdateConfigurationCommandType,
} from './protocol';
import type { WebviewIds } from './webviewBase';
import { WebviewBase } from './webviewBase';

export abstract class WebviewWithConfigBase<State> extends WebviewBase<State> {
	constructor(
		container: Container,
		id: `gitlens.${WebviewIds}`,
		fileName: string,
		iconPath: string,
		title: string,
		contextKeyPrefix: `${ContextKeys.WebviewPrefix}${WebviewIds}`,
		trackingFeature: TrackedUsageFeatures,
		showCommand: Commands,
	) {
		super(container, id, fileName, iconPath, title, contextKeyPrefix, trackingFeature, showCommand);
		this.disposables.push(
			configuration.onDidChange(this.onConfigurationChanged, this),
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
		);
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		let notify = false;
		for (const setting of this.customSettings.values()) {
			if (e.affectsConfiguration(setting.name)) {
				notify = true;
				break;
			}
		}

		if (!notify) return;

		void this.notifyDidChangeConfiguration();
	}

	protected onConfigurationChanged(_e: ConfigurationChangeEvent) {
		void this.notifyDidChangeConfiguration();
	}

	protected override onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent): void {
		super.onViewStateChanged(e);

		// Anytime the webview becomes active, make sure it has the most up-to-date config
		if (e.webviewPanel.active) {
			void this.notifyDidChangeConfiguration();
		}
	}

	protected override onMessageReceivedCore(e: IpcMessage): void {
		if (e == null) return;

		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				Logger.debug(`Webview(${this.id}).onMessageReceived: method=${e.method}`);

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

						await configuration.update(key as any, value, target);
					}

					for (const key of params.removes) {
						await configuration.update(key as any, undefined, target);
					}
				});
				break;

			case GenerateConfigurationPreviewCommandType.method:
				Logger.debug(`Webview(${this.id}).onMessageReceived: method=${e.method}`);

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
									PullRequestState.Merged,
									new Date('Sat, 12 Nov 2016 19:41:00 GMT'),
									undefined,
									new Date('Sat, 12 Nov 2016 20:41:00 GMT'),
								);
							}

							let preview;
							try {
								preview = CommitFormatter.fromTemplate(params.format, commit, {
									dateFormat: configuration.get('defaultDateFormat'),
									pullRequestOrRemote: pr,
									messageTruncateAtNewLine: true,
								});
							} catch {
								preview = 'Invalid format';
							}

							await this.notify(
								DidGenerateConfigurationPreviewNotificationType,
								{ preview: preview },
								e.completionId,
							);
						}
					}
				});
				break;

			default:
				super.onMessageReceivedCore(e);
		}
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
						name: 'currentLine.useUncommittedChangesFormat',
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
		return this.notify(DidChangeConfigurationNotificationType, {
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
		});
	}
}

interface CustomSetting {
	name: string;
	enabled: () => boolean;
	update: (enabled: boolean) => Promise<void>;
}

interface CustomConfig {
	rebaseEditor: {
		enabled: boolean;
	};
	currentLine: {
		useUncommittedChangesFormat: boolean;
	};
}

export type CustomConfigPath = Path<CustomConfig>;
export type CustomConfigPathValue<P extends CustomConfigPath> = PathValue<CustomConfig, P>;

const customConfigKeys: readonly CustomConfigPath[] = [
	'rebaseEditor.enabled',
	'currentLine.useUncommittedChangesFormat',
];

export function isCustomConfigKey(key: string): key is CustomConfigPath {
	return customConfigKeys.includes(key as CustomConfigPath);
}
