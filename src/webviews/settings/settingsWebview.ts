import type { ConfigurationChangeEvent, ViewColumn } from 'vscode';
import { ConfigurationTarget, Disposable, workspace } from 'vscode';
import { extensionPrefix } from '../../constants';
import { IssueIntegrationId } from '../../constants.integrations';
import type { WebviewTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { GitCommit, GitCommitIdentity } from '../../git/models/commit';
import { GitFileChange, GitFileIndexStatus } from '../../git/models/file';
import { PullRequest } from '../../git/models/pullRequest';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import type { ConnectionStateChangeEvent } from '../../plus/integrations/integrationService';
import { map } from '../../system/iterable';
import type { ConfigPath, CoreConfigPath } from '../../system/vscode/configuration';
import { configuration } from '../../system/vscode/configuration';
import type { CustomConfigPath, IpcMessage } from '../protocol';
import {
	assertsConfigKeyValue,
	DidChangeConfigurationNotification,
	isCustomConfigKey,
	UpdateConfigurationCommand,
} from '../protocol';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { State } from './protocol';
import {
	DidChangeAccountNotification,
	DidChangeConnectedJiraNotification,
	DidOpenAnchorNotification,
	GenerateConfigurationPreviewRequest,
} from './protocol';
import type { SettingsWebviewShowingArgs } from './registration';

export class SettingsWebviewProvider implements WebviewProvider<State, State, SettingsWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _pendingJumpToAnchor: string | undefined;

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.settings'>,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
			container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionStateChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.host.notify(DidChangeAccountNotification, { hasAccount: e.current.account != null });
	}

	onIntegrationConnectionStateChanged(e: ConnectionStateChangeEvent) {
		if (e.key === 'jira') {
			void this.host.notify(DidChangeConnectedJiraNotification, { hasConnectedJira: e.reason === 'connected' });
		}
	}

	async getAccountState(): Promise<boolean> {
		return (await this.container.subscription.getSubscription()).account != null;
	}

	async getJiraConnected(): Promise<boolean> {
		const jira = await this.container.integrations.get(IssueIntegrationId.Jira);
		if (jira == null) return false;
		return jira.maybeConnected ?? jira.isConnected();
	}

	async includeBootstrap(): Promise<State> {
		const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		return {
			...this.host.baseWebviewState,
			version: this.container.version,
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
			scope: 'user',
			scopes: scopes,
			hasAccount: await this.getAccountState(),
			hasConnectedJira: await this.getJiraConnected(),
		};
	}

	onReloaded(): void {
		void this.notifyDidChangeConfiguration();
	}

	onShowing?(
		loading: boolean,
		_options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: SettingsWebviewShowingArgs
	): [boolean, Record<`context.${string}`, string | number | boolean> | undefined] {
		const anchor = args[0];
		if (anchor && typeof anchor === 'string') {
			if (!loading && this.host.ready && this.host.visible) {
				queueMicrotask(
					() =>
						void this.host.notify(DidOpenAnchorNotification, {
							anchor: anchor,
							scrollBehavior: 'smooth',
						}),
				);
				return [true, undefined];
			}

			this._pendingJumpToAnchor = anchor;
		}

		return [true, undefined];
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

			void this.host.notify(DidOpenAnchorNotification, { anchor: anchor, scrollBehavior: 'auto' });
		}
	}

	async onMessageReceived(e: IpcMessage) {
		if (e == null) return;

		switch (true) {
			case UpdateConfigurationCommand.is(e): {
				const { params } = e;
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
				break;
			}

			case GenerateConfigurationPreviewRequest.is(e):
				switch (e.params.type) {
					case 'commit':
					case 'commit-uncommitted': {
						const commit = new GitCommit(
							this.container,
							'~/code/eamodio/vscode-gitlens-demo',
							'fe26af408293cba5b4bfd77306e1ac9ff7ccaef8',
							new GitCommitIdentity('You', 'eamodio@gmail.com', new Date('2016-11-12T20:41:00.000Z')),
							new GitCommitIdentity('You', 'eamodio@gmail.com', new Date('2020-11-01T06:57:21.000Z')),
							e.params.type === 'commit-uncommitted' ? 'Uncommitted changes' : 'Supercharged',
							['3ac1d3f51d7cf5f438cc69f25f6740536ad80fef'],
							e.params.type === 'commit-uncommitted' ? 'Uncommitted changes' : 'Supercharged',
							new GitFileChange(
								'~/code/eamodio/vscode-gitlens-demo',
								'code.ts',
								GitFileIndexStatus.Modified,
							),
							undefined,
							[],
						);

						let includePullRequest = false;
						switch (e.params.key) {
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

						let preview;
						try {
							preview = CommitFormatter.fromTemplate(e.params.format, commit, {
								dateFormat: configuration.get('defaultDateFormat'),
								pullRequest: pr,
								messageTruncateAtNewLine: true,
							});
						} catch {
							preview = 'Invalid format';
						}

						await this.host.respond(GenerateConfigurationPreviewRequest, e, { preview: preview });
					}
				}
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
		return this.host.notify(DidChangeConfigurationNotification, {
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
		});
	}
}

interface CustomSetting {
	name: ConfigPath | CoreConfigPath;
	enabled: () => boolean;
	update: (enabled: boolean) => Promise<void>;
}
