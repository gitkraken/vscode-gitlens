import type { ColorTheme, ConfigurationChangeEvent, Disposable, Event, StatusBarItem } from 'vscode';
import { EventEmitter, MarkdownString, StatusBarAlignment, ViewColumn, window } from 'vscode';
import { parseCommandContext } from '../../../commands/base';
import { GitActions } from '../../../commands/gitCommands.actions';
import type { GraphColumnConfig } from '../../../configuration';
import { configuration } from '../../../configuration';
import { Commands, ContextKeys } from '../../../constants';
import type { Container } from '../../../container';
import { setContext } from '../../../context';
import type { GitCommit } from '../../../git/models/commit';
import type { GitGraph } from '../../../git/models/graph';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { registerCommand } from '../../../system/command';
import { gate } from '../../../system/decorators/gate';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { updateRecordValue } from '../../../system/object';
import { isDarkTheme, isLightTheme } from '../../../system/utils';
import { RepositoryFolderNode } from '../../../views/nodes/viewNode';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import { WebviewBase } from '../../../webviews/webviewBase';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type { GraphCompositeConfig, GraphRepository, State } from './protocol';
import {
	DidChangeCommitsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DismissPreviewCommandType,
	GetMoreCommitsCommandType,
	UpdateColumnCommandType,
	UpdateSelectedRepositoryCommandType,
	UpdateSelectionCommandType,
} from './protocol';

export interface GraphSelectionChangeEvent {
	readonly selection: GitCommit[];
}

export class GraphWebview extends WebviewBase<State> {
	private _onDidChangeSelection = new EventEmitter<GraphSelectionChangeEvent>();
	get onDidChangeSelection(): Event<GraphSelectionChangeEvent> {
		return this._onDidChangeSelection.event;
	}

	private _repository?: Repository;
	get repository(): Repository | undefined {
		return this._repository;
	}

	set repository(value: Repository | undefined) {
		if (this._repository === value) return;

		this._repositoryEventsDisposable?.dispose();
		this._repository = value;
		this.resetRepositoryState();

		if (value != null) {
			this._repositoryEventsDisposable = value.onDidChange(this.onRepositoryChanged, this);
		}

		this.updateState();
	}

	private _selection: readonly GitCommit[] | undefined;
	get selection(): readonly GitCommit[] | undefined {
		return this._selection;
	}

	private _etagRepository?: number;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _repositoryGraph?: GitGraph;

	private _statusBarItem: StatusBarItem | undefined;
	private _theme: ColorTheme | undefined;

	private previewBanner?: boolean;

	constructor(container: Container) {
		super(
			container,
			'gitlens.graph',
			'graph.html',
			'images/gitlens-icon.png',
			'Commit Graph',
			'graphWebview',
			Commands.ShowGraphPage,
		);
		this.disposables.push(configuration.onDidChange(this.onConfigurationChanged, this), {
			dispose: () => {
				this._statusBarItem?.dispose();
				void this._repositoryEventsDisposable?.dispose();
			},
		});

		this.onConfigurationChanged();
	}

	override async show(column: ViewColumn = ViewColumn.Active, ...args: any[]): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.git.repositoryCount > 1) {
			const [contexts] = parseCommandContext(Commands.ShowGraphPage, undefined, ...args);
			const context = Array.isArray(contexts) ? contexts[0] : contexts;

			if (context.type === 'scm' && context.scm.rootUri != null) {
				const repository = this.container.git.getRepository(context.scm.rootUri);
				if (repository != null) {
					this.repository = repository;
				}
			} else if (context.type === 'viewItem' && context.node instanceof RepositoryFolderNode) {
				this.repository = context.node.repo;
			}

			if (this.repository != null) {
				this.resetRepositoryState();
				this.updateState();
			}
		}

		return super.show(column, ...args);
	}

	protected override refresh(force?: boolean): Promise<void> {
		this.resetRepositoryState();
		return super.refresh(force);
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState();
	}

	protected override registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshGraphPage, () => this.refresh(true))];
	}

	protected override onInitializing(): Disposable[] | undefined {
		this._theme = window.activeColorTheme;
		return [window.onDidChangeActiveColorTheme(this.onThemeChanged, this)];
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case DismissPreviewCommandType.method:
				onIpc(DismissPreviewCommandType, e, () => this.dismissPreview());
				break;
			case GetMoreCommitsCommandType.method:
				onIpc(GetMoreCommitsCommandType, e, params => this.onGetMoreCommits(params.limit));
				break;
			case UpdateColumnCommandType.method:
				onIpc(UpdateColumnCommandType, e, params => this.onColumnUpdated(params.name, params.config));
				break;
			case UpdateSelectedRepositoryCommandType.method:
				onIpc(UpdateSelectedRepositoryCommandType, e, params => this.onRepositorySelectionChanged(params.path));
				break;
			case UpdateSelectionCommandType.method:
				onIpc(UpdateSelectionCommandType, e, params => this.onSelectionChanged(params.selection));
				break;
		}
	}

	protected override onFocusChanged(focused: boolean): void {
		if (focused) {
			// If we are becoming focused, delay it a bit to give the UI time to update
			setTimeout(() => void setContext(ContextKeys.GraphPageFocused, focused), 0);

			if (this.selection != null) {
				void GitActions.Commit.showDetailsView(this.selection[0], { pin: true, preserveFocus: true });
			}

			return;
		}

		void setContext(ContextKeys.GraphPageFocused, focused);
	}

	protected override onVisibilityChanged(visible: boolean): void {
		if (visible && this.repository != null && this.repository.etag !== this._etagRepository) {
			this.updateState(true);
		}
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'graph.statusBar.enabled') || configuration.changed(e, 'plusFeatures.enabled')) {
			const enabled = configuration.get('graph.statusBar.enabled') && configuration.get('plusFeatures.enabled');
			if (enabled) {
				if (this._statusBarItem == null) {
					this._statusBarItem = window.createStatusBarItem(
						'gitlens.graph',
						StatusBarAlignment.Left,
						10000 - 3,
					);
					this._statusBarItem.name = 'GitLens Commit Graph';
					this._statusBarItem.command = Commands.ShowGraphPage;
					this._statusBarItem.text = '$(gitlens-graph)';
					this._statusBarItem.tooltip = new MarkdownString(
						'Visualize commits on the all-new Commit Graph ✨',
					);
					this._statusBarItem.accessibilityInformation = {
						label: `Show the GitLens Commit Graph`,
					};
				}
				this._statusBarItem.show();
			} else {
				this._statusBarItem?.dispose();
				this._statusBarItem = undefined;
			}
		}
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			!e.changed(
				RepositoryChange.Config,
				RepositoryChange.Heads,
				// RepositoryChange.Index,
				RepositoryChange.Remotes,
				// RepositoryChange.RemoteProviders,
				RepositoryChange.Stash,
				RepositoryChange.Status,
				RepositoryChange.Tags,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			this._etagRepository = e.repository.etag;
			return;
		}

		this.updateState();
	}

	private onThemeChanged(theme: ColorTheme) {
		if (this._theme != null) {
			if (
				(isDarkTheme(theme) && isDarkTheme(this._theme)) ||
				(isLightTheme(theme) && isLightTheme(this._theme))
			) {
				return;
			}
		}

		this._theme = theme;
		this.updateState();
	}

	private dismissPreview() {
		this.previewBanner = false;

		let banners = this.container.storage.getWorkspace('graph:banners:dismissed');
		banners = updateRecordValue(banners, 'preview', true);
		void this.container.storage.storeWorkspace('graph:banners:dismissed', banners);
	}

	private onColumnUpdated(name: string, config: GraphColumnConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		columns = updateRecordValue(columns, name, config);
		void this.container.storage.storeWorkspace('graph:columns', columns);

		void this.notifyDidChangeGraphConfiguration();
	}

	@gate()
	private async onGetMoreCommits(limit?: number) {
		if (this._repositoryGraph?.more == null || this._repository?.etag !== this._etagRepository) {
			this.updateState(true);

			return;
		}

		const { defaultItemLimit, pageItemLimit } = this.getConfig();
		const newGraph = await this._repositoryGraph.more(limit ?? pageItemLimit ?? defaultItemLimit);
		if (newGraph != null) {
			this._repositoryGraph = newGraph;
		} else {
			debugger;
		}

		void this.notifyDidChangeCommits();
	}

	private onRepositorySelectionChanged(path: string) {
		this.repository = this.container.git.getRepository(path);
	}

	private async onSelectionChanged(selection: string[]) {
		const ref = selection[0];

		let commits: GitCommit[] | undefined;
		if (ref != null) {
			const commit = await this.repository?.getCommit(ref);
			if (commit != null) {
				commits = [commit];
			}
		}

		this._selection = commits;
		this._onDidChangeSelection.fire({ selection: commits ?? [] });

		if (commits == null) return;

		void GitActions.Commit.showDetailsView(commits[0], { pin: true, preserveFocus: true });
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateState(immediate: boolean = false) {
		if (!this.isReady || !this.visible) return;

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 500);
		}

		this._notifyDidChangeStateDebounced();
	}

	@debug()
	private async notifyDidChangeState() {
		if (!this.isReady || !this.visible) return false;

		return this.notify(DidChangeNotificationType, {
			state: await this.getState(),
		});
	}

	@debug()
	private async notifyDidChangeGraphConfiguration() {
		if (!this.isReady || !this.visible) return false;

		return this.notify(DidChangeGraphConfigurationNotificationType, {
			config: this.getConfig(),
		});
	}

	@debug()
	private async notifyDidChangeCommits() {
		if (!this.isReady || !this.visible) return false;

		const data = this._repositoryGraph!;
		return this.notify(DidChangeCommitsNotificationType, {
			rows: data.rows,
			paging: {
				startingCursor: data.paging?.startingCursor,
				endingCursor: data.paging?.endingCursor,
				more: data.paging?.more ?? false,
			},
		});
	}

	private getConfig(): GraphCompositeConfig {
		const settings = configuration.get('graph');
		const config: GraphCompositeConfig = {
			...settings,
			columns: this.container.storage.getWorkspace('graph:columns'),
		};
		return config;
	}

	private async getState(): Promise<State> {
		if (this.container.git.repositoryCount === 0) return { repositories: [] };

		if (this.previewBanner == null) {
			const banners = this.container.storage.getWorkspace('graph:banners:dismissed');
			this.previewBanner = !banners?.['preview'];
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) return { repositories: [] };
		}

		this._etagRepository = this.repository?.etag;
		this.title = `${this.originalTitle}: ${this.repository.formattedName}`;

		const config = this.getConfig();

		// If we have a set of data refresh to the same set
		const limit = this._repositoryGraph?.paging?.limit ?? config.defaultItemLimit;

		const data = await this.container.git.getCommitsForGraph(
			this.repository.path,
			this._panel!.webview.asWebviewUri,
			{ limit: limit },
		);
		this._repositoryGraph = data;

		return {
			previewBanner: this.previewBanner,
			repositories: formatRepositories(this.container.git.openRepositories),
			selectedRepository: this.repository.path,
			rows: data.rows,
			paging: {
				startingCursor: data.paging?.startingCursor,
				endingCursor: data.paging?.endingCursor,
				more: data.paging?.more ?? false,
			},
			config: config,
			nonce: this.cspNonce,
		};
	}

	private resetRepositoryState() {
		this._repositoryGraph = undefined;
	}
}

function formatRepositories(repositories: Repository[]): GraphRepository[] {
	if (repositories.length === 0) return repositories;

	return repositories.map(r => ({
		formattedName: r.formattedName,
		id: r.id,
		name: r.name,
		path: r.path,
	}));
}
