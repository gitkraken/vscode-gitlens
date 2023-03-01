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
import { FocusWebview } from './plus/webviews/focus/focusWebview';
import { GraphWebview } from './plus/webviews/graph/graphWebview';
import { TimelineWebview } from './plus/webviews/timeline/timelineWebview';
import { TimelineWebviewView } from './plus/webviews/timeline/timelineWebviewView';
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
import { CommitDetailsWebviewView } from './webviews/commitDetails/commitDetailsWebviewView';
import { HomeWebviewView } from './webviews/home/homeWebviewView';
import { RebaseEditorProvider } from './webviews/rebase/rebaseEditor';
import { SettingsWebview } from './webviews/settings/settingsWebview';
import { WelcomeWebview } from './webviews/welcome/welcomeWebview';

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

		context.subscriptions.splice(0, 0, (this._storage = storage));
		context.subscriptions.splice(0, 0, (this._telemetry = new TelemetryService(this)));
		context.subscriptions.splice(0, 0, (this._usage = new UsageTracker(this, storage)));

		context.subscriptions.splice(0, 0, configuration.onWillChange(this.onConfigurationChanging, this));

		this._richRemoteProviders = new RichRemoteProviderService(this);

		const server = new ServerConnection(this);
		context.subscriptions.splice(0, 0, server);
		context.subscriptions.splice(
			0,
			0,
			(this._subscriptionAuthentication = new SubscriptionAuthenticationProvider(this, server)),
		);
		context.subscriptions.splice(0, 0, (this._subscription = new SubscriptionService(this, previousVersion)));

		context.subscriptions.splice(0, 0, (this._git = new GitProviderService(this)));
		context.subscriptions.splice(0, 0, new GitFileSystemProvider(this));

		context.subscriptions.splice(0, 0, (this._uri = new UriService(this)));

		context.subscriptions.splice(0, 0, (this._deepLinks = new DeepLinkService(this)));

		context.subscriptions.splice(0, 0, (this._actionRunners = new ActionRunners(this)));
		context.subscriptions.splice(0, 0, (this._tracker = new GitDocumentTracker(this)));
		context.subscriptions.splice(0, 0, (this._lineTracker = new GitLineTracker(this)));
		context.subscriptions.splice(0, 0, (this._keyboard = new Keyboard()));
		context.subscriptions.splice(0, 0, (this._vsls = new VslsController(this)));
		context.subscriptions.splice(0, 0, (this._eventBus = new EventBus()));

		context.subscriptions.splice(0, 0, (this._fileAnnotationController = new FileAnnotationController(this)));
		context.subscriptions.splice(0, 0, (this._lineAnnotationController = new LineAnnotationController(this)));
		context.subscriptions.splice(0, 0, (this._lineHoverController = new LineHoverController(this)));
		context.subscriptions.splice(0, 0, (this._statusBarController = new StatusBarController(this)));
		context.subscriptions.splice(0, 0, (this._codeLensController = new GitCodeLensController(this)));

		context.subscriptions.splice(0, 0, (this._settingsWebview = new SettingsWebview(this)));
		context.subscriptions.splice(0, 0, (this._timelineWebview = new TimelineWebview(this)));
		context.subscriptions.splice(0, 0, (this._welcomeWebview = new WelcomeWebview(this)));
		context.subscriptions.splice(0, 0, (this._rebaseEditor = new RebaseEditorProvider(this)));
		context.subscriptions.splice(0, 0, (this._graphWebview = new GraphWebview(this)));
		context.subscriptions.splice(0, 0, (this._focusWebview = new FocusWebview(this)));

		context.subscriptions.splice(0, 0, new ViewFileDecorationProvider());

		context.subscriptions.splice(0, 0, (this._repositoriesView = new RepositoriesView(this)));
		context.subscriptions.splice(0, 0, (this._commitDetailsView = new CommitDetailsWebviewView(this)));
		context.subscriptions.splice(0, 0, (this._commitsView = new CommitsView(this)));
		context.subscriptions.splice(0, 0, (this._fileHistoryView = new FileHistoryView(this)));
		context.subscriptions.splice(0, 0, (this._lineHistoryView = new LineHistoryView(this)));
		context.subscriptions.splice(0, 0, (this._branchesView = new BranchesView(this)));
		context.subscriptions.splice(0, 0, (this._remotesView = new RemotesView(this)));
		context.subscriptions.splice(0, 0, (this._stashesView = new StashesView(this)));
		context.subscriptions.splice(0, 0, (this._tagsView = new TagsView(this)));
		context.subscriptions.splice(0, 0, (this._worktreesView = new WorktreesView(this)));
		context.subscriptions.splice(0, 0, (this._contributorsView = new ContributorsView(this)));
		context.subscriptions.splice(0, 0, (this._searchAndCompareView = new SearchAndCompareView(this)));

		context.subscriptions.splice(0, 0, (this._homeView = new HomeWebviewView(this)));
		context.subscriptions.splice(0, 0, (this._timelineView = new TimelineWebviewView(this)));

		if (configuration.get('terminalLinks.enabled')) {
			context.subscriptions.splice(0, 0, (this._terminalLinks = new GitTerminalLinkProvider(this)));
		}

		context.subscriptions.splice(
			0,
			0,
			configuration.onDidChange(e => {
				if (!configuration.changed(e, 'terminalLinks.enabled')) return;

				this._terminalLinks?.dispose();
				if (configuration.get('terminalLinks.enabled')) {
					context.subscriptions.splice(0, 0, (this._terminalLinks = new GitTerminalLinkProvider(this)));
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
			this._context.subscriptions.splice(0, 0, this._git.register(provider.descriptor.id, provider));
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

	private _actionRunners: ActionRunners;
	get actionRunners() {
		if (this._actionRunners == null) {
			this._context.subscriptions.splice(0, 0, (this._actionRunners = new ActionRunners(this)));
		}

		return this._actionRunners;
	}

	private _autolinks: Autolinks | undefined;
	get autolinks() {
		if (this._autolinks == null) {
			this._context.subscriptions.splice(0, 0, (this._autolinks = new Autolinks(this)));
		}

		return this._autolinks;
	}

	private _codeLensController: GitCodeLensController;
	get codeLens() {
		return this._codeLensController;
	}

	private _branchesView: BranchesView | undefined;
	get branchesView() {
		if (this._branchesView == null) {
			this._context.subscriptions.splice(0, 0, (this._branchesView = new BranchesView(this)));
		}

		return this._branchesView;
	}

	private _commitsView: CommitsView | undefined;
	get commitsView() {
		if (this._commitsView == null) {
			this._context.subscriptions.splice(0, 0, (this._commitsView = new CommitsView(this)));
		}

		return this._commitsView;
	}

	private _commitDetailsView: CommitDetailsWebviewView | undefined;
	get commitDetailsView() {
		if (this._commitDetailsView == null) {
			this._context.subscriptions.splice(0, 0, (this._commitDetailsView = new CommitDetailsWebviewView(this)));
		}

		return this._commitDetailsView;
	}

	private readonly _context: ExtensionContext;
	get context() {
		return this._context;
	}

	private _contributorsView: ContributorsView | undefined;
	get contributorsView() {
		if (this._contributorsView == null) {
			this._context.subscriptions.splice(0, 0, (this._contributorsView = new ContributorsView(this)));
		}

		return this._contributorsView;
	}

	@memoize()
	get debugging() {
		return this._context.extensionMode === ExtensionMode.Development;
	}

	@memoize()
	get env(): 'dev' | 'staging' | 'production' {
		if (this.prereleaseOrDebugging) {
			const env = configuration.getAny('gitkraken.env');
			if (env === 'dev') return 'dev';
			if (env === 'staging') return 'staging';
		}

		return 'production';
	}

	private _eventBus: EventBus;
	get events() {
		return this._eventBus;
	}

	private _fileAnnotationController: FileAnnotationController;
	get fileAnnotations() {
		return this._fileAnnotationController;
	}

	private _fileHistoryView: FileHistoryView | undefined;
	get fileHistoryView() {
		if (this._fileHistoryView == null) {
			this._context.subscriptions.splice(0, 0, (this._fileHistoryView = new FileHistoryView(this)));
		}

		return this._fileHistoryView;
	}

	private _git: GitProviderService;
	get git() {
		return this._git;
	}

	private _uri: UriService;
	get uri() {
		return this._uri;
	}

	private _deepLinks: DeepLinkService;
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
			this._context.subscriptions.splice(0, 0, github);
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
			this._context.subscriptions.splice(0, 0, gitlab);
			return gitlab;
		} catch (ex) {
			Logger.error(ex);
			return undefined;
		}
	}

	private _homeView: HomeWebviewView | undefined;
	get homeView() {
		if (this._homeView == null) {
			this._context.subscriptions.splice(0, 0, (this._homeView = new HomeWebviewView(this)));
		}

		return this._homeView;
	}

	@memoize()
	get id() {
		return this._context.extension.id;
	}

	private _integrationAuthentication: IntegrationAuthenticationService | undefined;
	get integrationAuthentication() {
		if (this._integrationAuthentication == null) {
			this._context.subscriptions.splice(
				0,
				0,
				(this._integrationAuthentication = new IntegrationAuthenticationService(this)),
				// Register any integration authentication providers
				new GitHubAuthenticationProvider(this),
				new GitLabAuthenticationProvider(this),
			);
		}

		return this._integrationAuthentication;
	}

	private _keyboard: Keyboard;
	get keyboard() {
		return this._keyboard;
	}

	private _lineAnnotationController: LineAnnotationController;
	get lineAnnotations() {
		return this._lineAnnotationController;
	}

	private _lineHistoryView: LineHistoryView | undefined;
	get lineHistoryView() {
		if (this._lineHistoryView == null) {
			this._context.subscriptions.splice(0, 0, (this._lineHistoryView = new LineHistoryView(this)));
		}

		return this._lineHistoryView;
	}

	private _lineHoverController: LineHoverController;
	get lineHovers() {
		return this._lineHoverController;
	}

	private _lineTracker: GitLineTracker;
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

	private _rebaseEditor: RebaseEditorProvider | undefined;
	get rebaseEditor() {
		if (this._rebaseEditor == null) {
			this._context.subscriptions.splice(0, 0, (this._rebaseEditor = new RebaseEditorProvider(this)));
		}

		return this._rebaseEditor;
	}

	private _remotesView: RemotesView | undefined;
	get remotesView() {
		if (this._remotesView == null) {
			this._context.subscriptions.splice(0, 0, (this._remotesView = new RemotesView(this)));
		}

		return this._remotesView;
	}

	private _repositoriesView: RepositoriesView | undefined;
	get repositoriesView(): RepositoriesView {
		if (this._repositoriesView == null) {
			this._context.subscriptions.splice(0, 0, (this._repositoriesView = new RepositoriesView(this)));
		}

		return this._repositoriesView;
	}

	private _searchAndCompareView: SearchAndCompareView | undefined;
	get searchAndCompareView() {
		if (this._searchAndCompareView == null) {
			this._context.subscriptions.splice(0, 0, (this._searchAndCompareView = new SearchAndCompareView(this)));
		}

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

	private _settingsWebview: SettingsWebview;
	get settingsWebview() {
		return this._settingsWebview;
	}

	private _graphWebview: GraphWebview;
	get graphWebview() {
		return this._graphWebview;
	}

	private _focusWebview: FocusWebview;
	get focusWebview() {
		return this._focusWebview;
	}

	private readonly _richRemoteProviders: RichRemoteProviderService;
	get richRemoteProviders(): RichRemoteProviderService {
		return this._richRemoteProviders;
	}

	private _stashesView: StashesView | undefined;
	get stashesView() {
		if (this._stashesView == null) {
			this._context.subscriptions.splice(0, 0, (this._stashesView = new StashesView(this)));
		}

		return this._stashesView;
	}

	private _statusBarController: StatusBarController;
	get statusBar() {
		return this._statusBarController;
	}

	private readonly _storage: Storage;
	get storage(): Storage {
		return this._storage;
	}

	private _tagsView: TagsView | undefined;
	get tagsView() {
		if (this._tagsView == null) {
			this._context.subscriptions.splice(0, 0, (this._tagsView = new TagsView(this)));
		}

		return this._tagsView;
	}

	private readonly _telemetry: TelemetryService;
	get telemetry(): TelemetryService {
		return this._telemetry;
	}

	private _timelineView: TimelineWebviewView;
	get timelineView() {
		return this._timelineView;
	}

	private _timelineWebview: TimelineWebview;
	get timelineWebview() {
		return this._timelineWebview;
	}

	private _tracker: GitDocumentTracker;
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

	private _vsls: VslsController;
	get vsls() {
		return this._vsls;
	}

	private _welcomeWebview: WelcomeWebview;
	get welcomeWebview() {
		return this._welcomeWebview;
	}

	private _worktreesView: WorktreesView | undefined;
	get worktreesView() {
		if (this._worktreesView == null) {
			this._context.subscriptions.splice(0, 0, (this._worktreesView = new WorktreesView(this)));
		}

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
