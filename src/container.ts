import type { ConfigurationChangeEvent, Event, ExtensionContext } from 'vscode';
import { EventEmitter, ExtensionMode } from 'vscode';
import { getSupportedGitProviders } from '@env/providers';
import { Autolinks } from './annotations/autolinks';
import { FileAnnotationController } from './annotations/fileAnnotationController';
import { LineAnnotationController } from './annotations/lineAnnotationController';
import { ActionRunners } from './api/actionRunners';
import { setDefaultGravatarsStyle } from './avatars';
import { GitCodeLensController } from './codelens/codeLensController';
import type { ToggleFileAnnotationCommandArgs } from './commands';
import type { FileAnnotationType, ModeConfig } from './config';
import { AnnotationsToggleMode, DateSource, DateStyle, fromOutputLevel } from './config';
import { Commands } from './constants';
import { EventBus } from './eventBus';
import { GitFileSystemProvider } from './git/fsProvider';
import { GitProviderService } from './git/gitProviderService';
import { GitHubAuthenticationProvider } from './git/remotes/github';
import { GitLabAuthenticationProvider } from './git/remotes/gitlab';
import { RichRemoteProviderService } from './git/remotes/remoteProviderService';
import { LineHoverController } from './hovers/lineHoverController';
import { IntegrationAuthenticationService } from './plus/integrationAuthentication';
import { SubscriptionAuthenticationProvider } from './plus/subscription/authenticationProvider';
import { ServerConnection } from './plus/subscription/serverConnection';
import { SubscriptionService } from './plus/subscription/subscriptionService';
import { registerFocusWebviewPanel } from './plus/webviews/focus/registration';
import {
	registerGraphWebviewCommands,
	registerGraphWebviewPanel,
	registerGraphWebviewView,
} from './plus/webviews/graph/registration';
import { GraphStatusBarController } from './plus/webviews/graph/statusbar';
import { registerTimelineWebviewPanel, registerTimelineWebviewView } from './plus/webviews/timeline/registration';
import { StatusBarController } from './statusbar/statusBarController';
import type { Storage } from './storage';
import { executeCommand } from './system/command';
import { configuration } from './system/configuration';
import { log } from './system/decorators/log';
import { memoize } from './system/decorators/memoize';
import { Keyboard } from './system/keyboard';
import { Logger } from './system/logger';
import { TelemetryService } from './telemetry/telemetry';
import { UsageTracker } from './telemetry/usageTracker';
import { GitTerminalLinkProvider } from './terminal/linkProvider';
import { GitDocumentTracker } from './trackers/gitDocumentTracker';
import { GitLineTracker } from './trackers/gitLineTracker';
import { DeepLinkService } from './uris/deepLinks/deepLinkService';
import { UriService } from './uris/uriService';
import { BranchesView } from './views/branchesView';
import { CommitsView } from './views/commitsView';
import { ContributorsView } from './views/contributorsView';
import { FileHistoryView } from './views/fileHistoryView';
import { LineHistoryView } from './views/lineHistoryView';
import { RemotesView } from './views/remotesView';
import { RepositoriesView } from './views/repositoriesView';
import { SearchAndCompareView } from './views/searchAndCompareView';
import { StashesView } from './views/stashesView';
import { TagsView } from './views/tagsView';
import { ViewCommands } from './views/viewCommands';
import { ViewFileDecorationProvider } from './views/viewDecorationProvider';
import { WorktreesView } from './views/worktreesView';
import { VslsController } from './vsls/vsls';
import { registerCommitDetailsWebviewView } from './webviews/commitDetails/registration';
import { registerHomeWebviewView } from './webviews/home/registration';
import { RebaseEditorProvider } from './webviews/rebase/rebaseEditor';
import { registerSettingsWebviewCommands, registerSettingsWebviewPanel } from './webviews/settings/registration';
import type { WebviewViewProxy } from './webviews/webviewsController';
import { WebviewsController } from './webviews/webviewsController';
import { registerWelcomeWebviewPanel } from './webviews/welcome/registration';

export type Environment = 'dev' | 'staging' | 'production';

export class Container {
	static #instance: Container | undefined;
	static #proxy = new Proxy<Container>({} as Container, {
		get: function (target, prop) {
			// In case anyone has cached this instance
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			if (Container.#instance != null) return (Container.#instance as any)[prop];

			// Allow access to config before we are initialized
			if (prop === 'config') return configuration.getAll();

			// debugger;
			throw new Error('Container is not initialized');
		},
	});

	static create(
		context: ExtensionContext,
		storage: Storage,
		prerelease: boolean,
		version: string,
		previousVersion: string | undefined,
	) {
		if (Container.#instance != null) throw new Error('Container is already initialized');

		Container.#instance = new Container(context, storage, prerelease, version, previousVersion);
		return Container.#instance;
	}

	static get instance(): Container {
		return Container.#instance ?? Container.#proxy;
	}

	private _onReady: EventEmitter<void> = new EventEmitter<void>();
	get onReady(): Event<void> {
		return this._onReady.event;
	}

	readonly BranchDateFormatting = {
		dateFormat: undefined! as string | null,
		dateStyle: undefined! as DateStyle,

		reset: () => {
			this.BranchDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.BranchDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly CommitDateFormatting = {
		dateFormat: null as string | null,
		dateSource: DateSource.Authored,
		dateStyle: DateStyle.Relative,

		reset: () => {
			this.CommitDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.CommitDateFormatting.dateSource = configuration.get('defaultDateSource');
			this.CommitDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly CommitShaFormatting = {
		length: 7,

		reset: () => {
			// Don't allow shas to be shortened to less than 5 characters
			this.CommitShaFormatting.length = Math.max(5, configuration.get('advanced.abbreviatedShaLength'));
		},
	};

	readonly PullRequestDateFormatting = {
		dateFormat: null as string | null,
		dateStyle: DateStyle.Relative,

		reset: () => {
			this.PullRequestDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.PullRequestDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly TagDateFormatting = {
		dateFormat: null as string | null,
		dateStyle: DateStyle.Relative,

		reset: () => {
			this.TagDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.TagDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	private _configAffectedByModeRegex: RegExp | undefined;
	private _terminalLinks: GitTerminalLinkProvider | undefined;

	private _webviews: WebviewsController;

	private constructor(
		context: ExtensionContext,
		storage: Storage,
		prerelease: boolean,
		version: string,
		previousVersion: string | undefined,
	) {
		this._context = context;
		this._prerelease = prerelease;
		this._version = version;
		this.ensureModeApplied();

		context.subscriptions.unshift((this._storage = storage));
		context.subscriptions.unshift((this._telemetry = new TelemetryService(this)));
		context.subscriptions.unshift((this._usage = new UsageTracker(this, storage)));

		context.subscriptions.unshift(configuration.onWillChange(this.onConfigurationChanging, this));

		this._richRemoteProviders = new RichRemoteProviderService(this);

		const server = new ServerConnection(this);
		context.subscriptions.unshift(server);
		context.subscriptions.unshift(
			(this._subscriptionAuthentication = new SubscriptionAuthenticationProvider(this, server)),
		);
		context.subscriptions.unshift((this._subscription = new SubscriptionService(this, previousVersion)));

		context.subscriptions.unshift((this._git = new GitProviderService(this)));
		context.subscriptions.unshift(new GitFileSystemProvider(this));

		context.subscriptions.unshift((this._uri = new UriService(this)));

		context.subscriptions.unshift((this._deepLinks = new DeepLinkService(this)));

		context.subscriptions.unshift((this._actionRunners = new ActionRunners(this)));
		context.subscriptions.unshift((this._tracker = new GitDocumentTracker(this)));
		context.subscriptions.unshift((this._lineTracker = new GitLineTracker(this)));
		context.subscriptions.unshift((this._keyboard = new Keyboard()));
		context.subscriptions.unshift((this._vsls = new VslsController(this)));
		context.subscriptions.unshift((this._eventBus = new EventBus()));

		context.subscriptions.unshift((this._fileAnnotationController = new FileAnnotationController(this)));
		context.subscriptions.unshift((this._lineAnnotationController = new LineAnnotationController(this)));
		context.subscriptions.unshift((this._lineHoverController = new LineHoverController(this)));
		context.subscriptions.unshift((this._statusBarController = new StatusBarController(this)));
		context.subscriptions.unshift((this._codeLensController = new GitCodeLensController(this)));

		context.subscriptions.unshift((this._webviews = new WebviewsController(this)));
		context.subscriptions.unshift(registerTimelineWebviewPanel(this._webviews));
		context.subscriptions.unshift((this._timelineView = registerTimelineWebviewView(this._webviews)));

		const graphWebviewPanel = registerGraphWebviewPanel(this._webviews);
		context.subscriptions.unshift(graphWebviewPanel);
		context.subscriptions.unshift(registerGraphWebviewCommands(this, graphWebviewPanel));
		if (configuration.get('graph.experimental.location') === 'view') {
			context.subscriptions.unshift((this._graphView = registerGraphWebviewView(this._webviews)));
		}
		context.subscriptions.unshift(new GraphStatusBarController(this));

		const settingsWebviewPanel = registerSettingsWebviewPanel(this._webviews);
		context.subscriptions.unshift(settingsWebviewPanel);
		context.subscriptions.unshift(registerSettingsWebviewCommands(settingsWebviewPanel));
		context.subscriptions.unshift(registerWelcomeWebviewPanel(this._webviews));
		context.subscriptions.unshift((this._rebaseEditor = new RebaseEditorProvider(this)));
		context.subscriptions.unshift(registerFocusWebviewPanel(this._webviews));

		context.subscriptions.unshift(new ViewFileDecorationProvider());

		context.subscriptions.unshift((this._repositoriesView = new RepositoriesView(this)));
		context.subscriptions.unshift((this._commitDetailsView = registerCommitDetailsWebviewView(this._webviews)));
		context.subscriptions.unshift((this._commitsView = new CommitsView(this)));
		context.subscriptions.unshift((this._fileHistoryView = new FileHistoryView(this)));
		context.subscriptions.unshift((this._lineHistoryView = new LineHistoryView(this)));
		context.subscriptions.unshift((this._branchesView = new BranchesView(this)));
		context.subscriptions.unshift((this._remotesView = new RemotesView(this)));
		context.subscriptions.unshift((this._stashesView = new StashesView(this)));
		context.subscriptions.unshift((this._tagsView = new TagsView(this)));
		context.subscriptions.unshift((this._worktreesView = new WorktreesView(this)));
		context.subscriptions.unshift((this._contributorsView = new ContributorsView(this)));
		context.subscriptions.unshift((this._searchAndCompareView = new SearchAndCompareView(this)));

		context.subscriptions.unshift((this._homeView = registerHomeWebviewView(this._webviews)));

		if (configuration.get('terminalLinks.enabled')) {
			context.subscriptions.unshift((this._terminalLinks = new GitTerminalLinkProvider(this)));
		}

		context.subscriptions.unshift(
			configuration.onDidChange(e => {
				if (!configuration.changed(e, 'terminalLinks.enabled')) return;

				this._terminalLinks?.dispose();
				if (configuration.get('terminalLinks.enabled')) {
					context.subscriptions.unshift((this._terminalLinks = new GitTerminalLinkProvider(this)));
				}
			}),
		);
	}

	deactivate() {
		this._deactivating = true;
	}

	private _deactivating: boolean = false;
	get deactivating() {
		return this._deactivating;
	}

	private _ready: boolean = false;

	async ready() {
		if (this._ready) throw new Error('Container is already ready');

		this._ready = true;
		await this.registerGitProviders();
		queueMicrotask(() => this._onReady.fire());
	}

	@log()
	private async registerGitProviders() {
		const providers = await getSupportedGitProviders(this);
		for (const provider of providers) {
			this._context.subscriptions.unshift(this._git.register(provider.descriptor.id, provider));
		}

		this._git.registrationComplete();
	}

	private onConfigurationChanging(e: ConfigurationChangeEvent) {
		this._mode = undefined;

		if (configuration.changed(e, 'outputLevel')) {
			Logger.logLevel = fromOutputLevel(configuration.get('outputLevel'));
		}

		if (configuration.changed(e, 'defaultGravatarsStyle')) {
			setDefaultGravatarsStyle(configuration.get('defaultGravatarsStyle'));
		}

		if (configuration.changed(e, 'mode')) {
			this.ensureModeApplied();
		}
	}

	private readonly _actionRunners: ActionRunners;
	get actionRunners() {
		return this._actionRunners;
	}

	private _autolinks: Autolinks | undefined;
	get autolinks() {
		if (this._autolinks == null) {
			this._context.subscriptions.unshift((this._autolinks = new Autolinks(this)));
		}

		return this._autolinks;
	}

	private readonly _codeLensController: GitCodeLensController;
	get codeLens() {
		return this._codeLensController;
	}

	private readonly _branchesView: BranchesView;
	get branchesView() {
		return this._branchesView;
	}

	private readonly _commitsView: CommitsView;
	get commitsView() {
		return this._commitsView;
	}

	private readonly _commitDetailsView: WebviewViewProxy;
	get commitDetailsView() {
		return this._commitDetailsView;
	}

	private readonly _context: ExtensionContext;
	get context() {
		return this._context;
	}

	private readonly _contributorsView: ContributorsView;
	get contributorsView() {
		return this._contributorsView;
	}

	@memoize()
	get debugging() {
		return this._context.extensionMode === ExtensionMode.Development;
	}

	@memoize()
	get env(): Environment {
		if (this.prereleaseOrDebugging) {
			const env = configuration.getAny('gitkraken.env');
			if (env === 'dev') return 'dev';
			if (env === 'staging') return 'staging';
		}

		return 'production';
	}

	private readonly _eventBus: EventBus;
	get events() {
		return this._eventBus;
	}

	private readonly _fileAnnotationController: FileAnnotationController;
	get fileAnnotations() {
		return this._fileAnnotationController;
	}

	private readonly _fileHistoryView: FileHistoryView;
	get fileHistoryView() {
		return this._fileHistoryView;
	}

	private readonly _git: GitProviderService;
	get git() {
		return this._git;
	}

	private readonly _uri: UriService;
	get uri() {
		return this._uri;
	}

	private readonly _deepLinks: DeepLinkService;
	get deepLinks() {
		return this._deepLinks;
	}

	private _github: Promise<import('./plus/github/github').GitHubApi | undefined> | undefined;
	get github() {
		if (this._github == null) {
			this._github = this._loadGitHubApi();
		}

		return this._github;
	}

	private async _loadGitHubApi() {
		try {
			const github = new (await import(/* webpackChunkName: "github" */ './plus/github/github')).GitHubApi(this);
			this._context.subscriptions.unshift(github);
			return github;
		} catch (ex) {
			Logger.error(ex);
			return undefined;
		}
	}

	private _gitlab: Promise<import('./plus/gitlab/gitlab').GitLabApi | undefined> | undefined;
	get gitlab() {
		if (this._gitlab == null) {
			this._gitlab = this._loadGitLabApi();
		}

		return this._gitlab;
	}

	private async _loadGitLabApi() {
		try {
			const gitlab = new (await import(/* webpackChunkName: "gitlab" */ './plus/gitlab/gitlab')).GitLabApi(this);
			this._context.subscriptions.unshift(gitlab);
			return gitlab;
		} catch (ex) {
			Logger.error(ex);
			return undefined;
		}
	}

	private _graphView: WebviewViewProxy | undefined;
	get graphView() {
		if (this._graphView == null) {
			this.context.subscriptions.unshift((this._graphView = registerGraphWebviewView(this._webviews)));
		}

		return this._graphView;
	}

	private readonly _homeView: WebviewViewProxy;
	get homeView() {
		return this._homeView;
	}

	@memoize()
	get id() {
		return this._context.extension.id;
	}

	private _integrationAuthentication: IntegrationAuthenticationService | undefined;
	get integrationAuthentication() {
		if (this._integrationAuthentication == null) {
			this._context.subscriptions.unshift(
				(this._integrationAuthentication = new IntegrationAuthenticationService(this)),
				// Register any integration authentication providers
				new GitHubAuthenticationProvider(this),
				new GitLabAuthenticationProvider(this),
			);
		}

		return this._integrationAuthentication;
	}

	private readonly _keyboard: Keyboard;
	get keyboard() {
		return this._keyboard;
	}

	private readonly _lineAnnotationController: LineAnnotationController;
	get lineAnnotations() {
		return this._lineAnnotationController;
	}

	private readonly _lineHistoryView: LineHistoryView;
	get lineHistoryView() {
		return this._lineHistoryView;
	}

	private readonly _lineHoverController: LineHoverController;
	get lineHovers() {
		return this._lineHoverController;
	}

	private readonly _lineTracker: GitLineTracker;
	get lineTracker() {
		return this._lineTracker;
	}

	private readonly _prerelease;
	get prerelease() {
		return this._prerelease;
	}

	@memoize()
	get prereleaseOrDebugging() {
		return this._prerelease || this.debugging;
	}

	private readonly _rebaseEditor: RebaseEditorProvider;
	get rebaseEditor() {
		return this._rebaseEditor;
	}

	private readonly _remotesView: RemotesView;
	get remotesView() {
		return this._remotesView;
	}

	private readonly _repositoriesView: RepositoriesView;
	get repositoriesView(): RepositoriesView {
		return this._repositoriesView;
	}

	private readonly _searchAndCompareView: SearchAndCompareView;
	get searchAndCompareView() {
		return this._searchAndCompareView;
	}

	private _subscription: SubscriptionService;
	get subscription() {
		return this._subscription;
	}

	private _subscriptionAuthentication: SubscriptionAuthenticationProvider;
	get subscriptionAuthentication() {
		return this._subscriptionAuthentication;
	}

	private readonly _richRemoteProviders: RichRemoteProviderService;
	get richRemoteProviders(): RichRemoteProviderService {
		return this._richRemoteProviders;
	}

	private readonly _stashesView: StashesView;
	get stashesView() {
		return this._stashesView;
	}

	private readonly _statusBarController: StatusBarController;
	get statusBar() {
		return this._statusBarController;
	}

	private readonly _storage: Storage;
	get storage(): Storage {
		return this._storage;
	}

	private readonly _tagsView: TagsView;
	get tagsView() {
		return this._tagsView;
	}

	private readonly _telemetry: TelemetryService;
	get telemetry(): TelemetryService {
		return this._telemetry;
	}

	private readonly _timelineView: WebviewViewProxy;
	get timelineView() {
		return this._timelineView;
	}

	private readonly _tracker: GitDocumentTracker;
	get tracker() {
		return this._tracker;
	}

	private readonly _usage: UsageTracker;
	get usage(): UsageTracker {
		return this._usage;
	}

	private readonly _version: string;
	get version(): string {
		return this._version;
	}

	private _viewCommands: ViewCommands | undefined;
	get viewCommands() {
		if (this._viewCommands == null) {
			this._viewCommands = new ViewCommands(this);
		}
		return this._viewCommands;
	}

	private readonly _vsls: VslsController;
	get vsls() {
		return this._vsls;
	}

	private readonly _worktreesView: WorktreesView;
	get worktreesView() {
		return this._worktreesView;
	}

	private _mode: ModeConfig | undefined;
	get mode() {
		if (this._mode == null) {
			this._mode = configuration.get('modes')?.[configuration.get('mode.active')];
		}
		return this._mode;
	}

	private ensureModeApplied() {
		const mode = this.mode;
		if (mode == null) {
			configuration.clearOverrides();

			return;
		}

		if (mode.annotations != null) {
			let command: Commands | undefined;
			switch (mode.annotations) {
				case 'blame':
					command = Commands.ToggleFileBlame;
					break;
				case 'changes':
					command = Commands.ToggleFileChanges;
					break;
				case 'heatmap':
					command = Commands.ToggleFileHeatmap;
					break;
			}

			if (command != null) {
				const commandArgs: ToggleFileAnnotationCommandArgs = {
					type: mode.annotations as FileAnnotationType,
					on: true,
				};
				// Make sure to delay the execution by a bit so that the configuration changes get propagated first
				setTimeout(executeCommand, 50, command, commandArgs);
			}
		}

		// Apply any required configuration overrides
		configuration.applyOverrides({
			get: (section, value) => {
				if (mode.annotations != null) {
					if (configuration.matches(`${mode.annotations}.toggleMode`, section, value)) {
						value = AnnotationsToggleMode.Window as typeof value;
						return value;
					}

					if (configuration.matches(mode.annotations, section, value)) {
						value.toggleMode = AnnotationsToggleMode.Window;
						return value;
					}
				}

				for (const key of ['codeLens', 'currentLine', 'hovers', 'statusBar'] as const) {
					if (mode[key] != null) {
						if (configuration.matches(`${key}.enabled`, section, value)) {
							value = mode[key] as NonNullable<typeof value>;
							return value;
						} else if (configuration.matches(key, section, value)) {
							value.enabled = mode[key]!;
							return value;
						}
					}
				}

				return value;
			},
			getAll: cfg => {
				if (mode.annotations != null) {
					cfg[mode.annotations].toggleMode = AnnotationsToggleMode.Window;
				}

				if (mode.codeLens != null) {
					cfg.codeLens.enabled = mode.codeLens;
				}

				if (mode.currentLine != null) {
					cfg.currentLine.enabled = mode.currentLine;
				}

				if (mode.hovers != null) {
					cfg.hovers.enabled = mode.hovers;
				}

				if (mode.statusBar != null) {
					cfg.statusBar.enabled = mode.statusBar;
				}

				return cfg;
			},
			onChange: e => {
				// When the mode or modes change, we will simulate that all the affected configuration also changed
				if (configuration.changed(e, ['mode', 'modes'])) {
					if (this._configAffectedByModeRegex == null) {
						this._configAffectedByModeRegex = new RegExp(
							`^gitlens\\.(?:${configuration.name('mode')}|${configuration.name(
								'modes',
							)}|${configuration.name('blame')}|${configuration.name('changes')}|${configuration.name(
								'heatmap',
							)}|${configuration.name('codeLens')}|${configuration.name(
								'currentLine',
							)}|${configuration.name('hovers')}|${configuration.name('statusBar')})\\b`,
						);
					}

					const original = e.affectsConfiguration;
					e = {
						...e,
						affectsConfiguration: (section, scope) =>
							this._configAffectedByModeRegex!.test(section) ? true : original(section, scope),
					};
				}
				return e;
			},
		});
	}
}

export function isContainer(container: any): container is Container {
	return container instanceof Container;
}
