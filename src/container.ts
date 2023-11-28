import type { ConfigurationChangeEvent, Disposable, Event, ExtensionContext } from 'vscode';
import { EventEmitter, ExtensionMode } from 'vscode';
import { getSupportedGitProviders, getSupportedRepositoryPathMappingProvider } from '@env/providers';
import { AIProviderService } from './ai/aiProviderService';
import { Autolinks } from './annotations/autolinks';
import { FileAnnotationController } from './annotations/fileAnnotationController';
import { LineAnnotationController } from './annotations/lineAnnotationController';
import { ActionRunners } from './api/actionRunners';
import { setDefaultGravatarsStyle } from './avatars';
import { CacheProvider } from './cache';
import { GitCodeLensController } from './codelens/codeLensController';
import type { ToggleFileAnnotationCommandArgs } from './commands/toggleFileAnnotations';
import type { DateStyle, FileAnnotationType, ModeConfig } from './config';
import { fromOutputLevel } from './config';
import { Commands, extensionPrefix } from './constants';
import { EventBus } from './eventBus';
import { GitFileSystemProvider } from './git/fsProvider';
import { GitProviderService } from './git/gitProviderService';
import { LineHoverController } from './hovers/lineHoverController';
import type { RepositoryPathMappingProvider } from './pathMapping/repositoryPathMappingProvider';
import { DraftService } from './plus/drafts/draftsService';
import { FocusService } from './plus/focus/focusService';
import { AccountAuthenticationProvider } from './plus/gk/account/authenticationProvider';
import { OrganizationService } from './plus/gk/account/organizationService';
import { SubscriptionService } from './plus/gk/account/subscriptionService';
import { ServerConnection } from './plus/gk/serverConnection';
import { IntegrationAuthenticationService } from './plus/integrations/authentication/integrationAuthentication';
import { IntegrationService } from './plus/integrations/integrationService';
import { RepositoryIdentityService } from './plus/repos/repositoryIdentityService';
import { registerAccountWebviewView } from './plus/webviews/account/registration';
import { registerFocusWebviewCommands, registerFocusWebviewPanel } from './plus/webviews/focus/registration';
import type { GraphWebviewShowingArgs } from './plus/webviews/graph/registration';
import {
	registerGraphWebviewCommands,
	registerGraphWebviewPanel,
	registerGraphWebviewView,
} from './plus/webviews/graph/registration';
import { GraphStatusBarController } from './plus/webviews/graph/statusbar';
import type { PatchDetailsWebviewShowingArgs } from './plus/webviews/patchDetails/registration';
import {
	registerPatchDetailsWebviewPanel,
	registerPatchDetailsWebviewView,
} from './plus/webviews/patchDetails/registration';
import type { TimelineWebviewShowingArgs } from './plus/webviews/timeline/registration';
import {
	registerTimelineWebviewCommands,
	registerTimelineWebviewPanel,
	registerTimelineWebviewView,
} from './plus/webviews/timeline/registration';
import { scheduleAddMissingCurrentWorkspaceRepos, WorkspacesService } from './plus/workspaces/workspacesService';
import { StatusBarController } from './statusbar/statusBarController';
import { executeCommand } from './system/command';
import { configuration } from './system/configuration';
import { log } from './system/decorators/log';
import { memoize } from './system/decorators/memoize';
import { Keyboard } from './system/keyboard';
import { Logger } from './system/logger';
import type { Storage } from './system/storage';
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
import { DraftsView } from './views/draftsView';
import { FileHistoryView } from './views/fileHistoryView';
import { LineHistoryView } from './views/lineHistoryView';
import { RemotesView } from './views/remotesView';
import { RepositoriesView } from './views/repositoriesView';
import { SearchAndCompareView } from './views/searchAndCompareView';
import { StashesView } from './views/stashesView';
import { TagsView } from './views/tagsView';
import { ViewCommands } from './views/viewCommands';
import { ViewFileDecorationProvider } from './views/viewDecorationProvider';
import { WorkspacesView } from './views/workspacesView';
import { WorktreesView } from './views/worktreesView';
import { VslsController } from './vsls/vsls';
import type { CommitDetailsWebviewShowingArgs } from './webviews/commitDetails/registration';
import {
	registerCommitDetailsWebviewView,
	registerGraphDetailsWebviewView,
} from './webviews/commitDetails/registration';
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
		dateSource: 'authored',
		dateStyle: 'relative',

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
		dateStyle: 'relative',

		reset: () => {
			this.PullRequestDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.PullRequestDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly TagDateFormatting = {
		dateFormat: null as string | null,
		dateStyle: 'relative',

		reset: () => {
			this.TagDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.TagDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	private readonly _connection: ServerConnection;
	private _disposables: Disposable[];
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

		this._disposables = [
			(this._storage = storage),
			(this._telemetry = new TelemetryService(this)),
			(this._usage = new UsageTracker(this, storage)),
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
		];

		this._disposables.push((this._connection = new ServerConnection(this)));

		this._disposables.push(
			(this._accountAuthentication = new AccountAuthenticationProvider(this, this._connection)),
		);
		this._disposables.push((this._subscription = new SubscriptionService(this, this._connection, previousVersion)));

		this._disposables.push((this._git = new GitProviderService(this)));
		this._disposables.push(new GitFileSystemProvider(this));

		this._disposables.push((this._uri = new UriService(this)));

		this._disposables.push((this._deepLinks = new DeepLinkService(this)));

		this._disposables.push((this._actionRunners = new ActionRunners(this)));
		this._disposables.push((this._tracker = new GitDocumentTracker(this)));
		this._disposables.push((this._lineTracker = new GitLineTracker(this)));
		this._disposables.push((this._keyboard = new Keyboard()));
		this._disposables.push((this._vsls = new VslsController(this)));
		this._disposables.push((this._eventBus = new EventBus()));

		this._disposables.push((this._fileAnnotationController = new FileAnnotationController(this)));
		this._disposables.push((this._lineAnnotationController = new LineAnnotationController(this)));
		this._disposables.push((this._lineHoverController = new LineHoverController(this)));
		this._disposables.push((this._statusBarController = new StatusBarController(this)));
		this._disposables.push((this._codeLensController = new GitCodeLensController(this)));

		this._disposables.push((this._webviews = new WebviewsController(this)));

		const graphPanels = registerGraphWebviewPanel(this._webviews);
		this._disposables.push(graphPanels);
		this._disposables.push(registerGraphWebviewCommands(this, graphPanels));
		this._disposables.push((this._graphView = registerGraphWebviewView(this._webviews)));
		this._disposables.push(new GraphStatusBarController(this));

		const focusPanels = registerFocusWebviewPanel(this._webviews);
		this._disposables.push(focusPanels);
		this._disposables.push(registerFocusWebviewCommands(focusPanels));

		const timelinePanels = registerTimelineWebviewPanel(this._webviews);
		this._disposables.push(timelinePanels);
		this._disposables.push(registerTimelineWebviewCommands(timelinePanels));
		this._disposables.push((this._timelineView = registerTimelineWebviewView(this._webviews)));

		this._disposables.push((this._rebaseEditor = new RebaseEditorProvider(this)));

		const settingsPanels = registerSettingsWebviewPanel(this._webviews);
		this._disposables.push(settingsPanels);
		this._disposables.push(registerSettingsWebviewCommands(settingsPanels));

		this._disposables.push(registerWelcomeWebviewPanel(this._webviews));

		this._disposables.push(new ViewFileDecorationProvider());

		this._disposables.push((this._repositoriesView = new RepositoriesView(this)));
		this._disposables.push((this._commitDetailsView = registerCommitDetailsWebviewView(this._webviews)));
		const patchDetailsPanels = registerPatchDetailsWebviewPanel(this._webviews);
		this._disposables.push(patchDetailsPanels);
		this._disposables.push((this._patchDetailsView = registerPatchDetailsWebviewView(this._webviews)));
		this._disposables.push((this._graphDetailsView = registerGraphDetailsWebviewView(this._webviews)));
		this._disposables.push((this._commitsView = new CommitsView(this)));
		this._disposables.push((this._fileHistoryView = new FileHistoryView(this)));
		this._disposables.push((this._lineHistoryView = new LineHistoryView(this)));
		this._disposables.push((this._branchesView = new BranchesView(this)));
		this._disposables.push((this._remotesView = new RemotesView(this)));
		this._disposables.push((this._stashesView = new StashesView(this)));
		this._disposables.push((this._tagsView = new TagsView(this)));
		this._disposables.push((this._worktreesView = new WorktreesView(this)));
		this._disposables.push((this._contributorsView = new ContributorsView(this)));
		this._disposables.push((this._searchAndCompareView = new SearchAndCompareView(this)));
		this._disposables.push((this._draftsView = new DraftsView(this)));
		this._disposables.push((this._workspacesView = new WorkspacesView(this)));

		this._disposables.push((this._homeView = registerHomeWebviewView(this._webviews)));
		this._disposables.push((this._accountView = registerAccountWebviewView(this._webviews)));

		if (configuration.get('terminalLinks.enabled')) {
			this._disposables.push((this._terminalLinks = new GitTerminalLinkProvider(this)));
		}

		this._disposables.push(
			configuration.onDidChange(e => {
				if (!configuration.changed(e, 'terminalLinks.enabled')) return;

				this._terminalLinks?.dispose();
				if (configuration.get('terminalLinks.enabled')) {
					this._disposables.push((this._terminalLinks = new GitTerminalLinkProvider(this)));
				}
			}),
		);

		context.subscriptions.push({
			dispose: () => this._disposables.reverse().forEach(d => void d.dispose()),
		});

		scheduleAddMissingCurrentWorkspaceRepos(this);
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
			this._disposables.push(this._git.register(provider.descriptor.id, provider));
		}

		// Don't wait here otherwise will we deadlock in certain places
		void this._git.registrationComplete();
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changedAny(e, extensionPrefix)) return;

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

	private _accountAuthentication: AccountAuthenticationProvider;
	get accountAuthentication() {
		return this._accountAuthentication;
	}

	private readonly _accountView: WebviewViewProxy<[]>;
	get accountView() {
		return this._accountView;
	}

	private readonly _actionRunners: ActionRunners;
	get actionRunners() {
		return this._actionRunners;
	}

	private _ai: AIProviderService | undefined;
	get ai() {
		if (this._ai == null) {
			this._disposables.push((this._ai = new AIProviderService(this)));
		}
		return this._ai;
	}

	private _autolinks: Autolinks | undefined;
	get autolinks() {
		if (this._autolinks == null) {
			this._disposables.push((this._autolinks = new Autolinks(this)));
		}

		return this._autolinks;
	}

	private readonly _branchesView: BranchesView;
	get branchesView() {
		return this._branchesView;
	}

	private _cache: CacheProvider | undefined;
	get cache() {
		if (this._cache == null) {
			this._disposables.push((this._cache = new CacheProvider(this)));
		}

		return this._cache;
	}

	private _drafts: DraftService | undefined;
	get drafts() {
		if (this._drafts == null) {
			this._disposables.push((this._drafts = new DraftService(this, this._connection)));
		}
		return this._drafts;
	}

	private _repositoryIdentity: RepositoryIdentityService | undefined;
	get repositoryIdentity() {
		if (this._repositoryIdentity == null) {
			this._disposables.push((this._repositoryIdentity = new RepositoryIdentityService(this, this._connection)));
		}
		return this._repositoryIdentity;
	}

	private readonly _draftsView: DraftsView;
	get draftsView() {
		return this._draftsView;
	}

	private readonly _codeLensController: GitCodeLensController;
	get codeLens() {
		return this._codeLensController;
	}

	private readonly _commitsView: CommitsView;
	get commitsView() {
		return this._commitsView;
	}

	private readonly _commitDetailsView: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
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

	private readonly _deepLinks: DeepLinkService;
	get deepLinks() {
		return this._deepLinks;
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

	private _focus: FocusService | undefined;
	get focus() {
		if (this._focus == null) {
			this._disposables.push((this._focus = new FocusService(this, new ServerConnection(this))));
		}

		return this._focus;
	}

	private readonly _git: GitProviderService;
	get git() {
		return this._git;
	}

	private _github: Promise<import('./plus/integrations/providers/github/github').GitHubApi | undefined> | undefined;
	get github() {
		if (this._github == null) {
			this._github = this._loadGitHubApi();
		}

		return this._github;
	}

	private async _loadGitHubApi() {
		try {
			const github = new (
				await import(/* webpackChunkName: "github" */ './plus/integrations/providers/github/github')
			).GitHubApi(this);
			this._disposables.push(github);
			return github;
		} catch (ex) {
			Logger.error(ex);
			return undefined;
		}
	}

	private _gitlab: Promise<import('./plus/integrations/providers/gitlab/gitlab').GitLabApi | undefined> | undefined;
	get gitlab() {
		if (this._gitlab == null) {
			this._gitlab = this._loadGitLabApi();
		}

		return this._gitlab;
	}

	private async _loadGitLabApi() {
		try {
			const gitlab = new (
				await import(/* webpackChunkName: "gitlab" */ './plus/integrations/providers/gitlab/gitlab')
			).GitLabApi(this);
			this._disposables.push(gitlab);
			return gitlab;
		} catch (ex) {
			Logger.error(ex);
			return undefined;
		}
	}

	private readonly _graphDetailsView: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	get graphDetailsView() {
		return this._graphDetailsView;
	}

	private readonly _graphView: WebviewViewProxy<GraphWebviewShowingArgs>;
	get graphView() {
		return this._graphView;
	}

	private readonly _homeView: WebviewViewProxy<[]>;
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
			this._disposables.push((this._integrationAuthentication = new IntegrationAuthenticationService(this)));
		}

		return this._integrationAuthentication;
	}

	private _integrations: IntegrationService | undefined;
	get integrations(): IntegrationService {
		if (this._integrations == null) {
			this._disposables.push((this._integrations = new IntegrationService(this)));
		}
		return this._integrations;
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

	private _mode: ModeConfig | undefined;
	get mode() {
		if (this._mode == null) {
			this._mode = configuration.get('modes')?.[configuration.get('mode.active')];
		}
		return this._mode;
	}

	private _organization: OrganizationService | undefined;
	get organization() {
		if (this._organization == null) {
			this._disposables.push((this._organization = new OrganizationService(this, this._connection)));
		}
		return this._organization;
	}

	private readonly _patchDetailsView: WebviewViewProxy<PatchDetailsWebviewShowingArgs>;
	get patchDetailsView() {
		return this._patchDetailsView;
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

	private _repositoryPathMapping: RepositoryPathMappingProvider | undefined;
	get repositoryPathMapping() {
		if (this._repositoryPathMapping == null) {
			this._disposables.push((this._repositoryPathMapping = getSupportedRepositoryPathMappingProvider(this)));
		}
		return this._repositoryPathMapping;
	}

	private readonly _searchAndCompareView: SearchAndCompareView;
	get searchAndCompareView() {
		return this._searchAndCompareView;
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

	private _subscription: SubscriptionService;
	get subscription() {
		return this._subscription;
	}

	private readonly _tagsView: TagsView;
	get tagsView() {
		return this._tagsView;
	}

	private readonly _telemetry: TelemetryService;
	get telemetry(): TelemetryService {
		return this._telemetry;
	}

	private readonly _timelineView: WebviewViewProxy<TimelineWebviewShowingArgs>;
	get timelineView() {
		return this._timelineView;
	}

	private readonly _tracker: GitDocumentTracker;
	get tracker() {
		return this._tracker;
	}

	private readonly _uri: UriService;
	get uri() {
		return this._uri;
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

	private _workspaces: WorkspacesService | undefined;
	get workspaces() {
		if (this._workspaces == null) {
			this._disposables.push((this._workspaces = new WorkspacesService(this, this._connection)));
		}
		return this._workspaces;
	}

	private _workspacesView: WorkspacesView;
	get workspacesView() {
		return this._workspacesView;
	}

	private readonly _worktreesView: WorktreesView;
	get worktreesView() {
		return this._worktreesView;
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
						value = 'window' as typeof value;
						return value;
					}

					if (configuration.matches(mode.annotations, section, value)) {
						value.toggleMode = 'window';
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
					cfg[mode.annotations].toggleMode = 'window';
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
			onDidChange: e => {
				// When the mode or modes change, we will simulate that all the affected configuration also changed
				if (!configuration.changed(e, ['mode', 'modes'])) return e;

				const originalAffectsConfiguration = e.affectsConfiguration;
				return {
					...e,
					affectsConfiguration: (section, scope) =>
						/^gitlens\.(?:modes?|blame|changes|heatmap|codeLens|currentLine|hovers|statusBar)\b/.test(
							section,
						)
							? true
							: originalAffectsConfiguration(section, scope),
				};
			},
		});
	}
}

export function isContainer(container: any): container is Container {
	return container instanceof Container;
}
