import type { ConfigurationChangeEvent, Disposable, Event, ExtensionContext } from 'vscode';
import { EventEmitter, ExtensionMode } from 'vscode';
import {
	getGkCliIntegrationProvider,
	getSharedGKStorageLocationProvider,
	getSupportedGitProviders,
	getSupportedRepositoryLocationProvider,
	getSupportedWorkspacesStorageProvider,
} from '@env/providers';
import { FileAnnotationController } from './annotations/fileAnnotationController';
import { LineAnnotationController } from './annotations/lineAnnotationController';
import { ActionRunners } from './api/actionRunners';
import { AutolinksProvider } from './autolinks/autolinksProvider';
import { setDefaultGravatarsStyle } from './avatars';
import { CacheProvider } from './cache';
import { GitCodeLensController } from './codelens/codeLensController';
import type { ToggleFileAnnotationCommandArgs } from './commands/toggleFileAnnotations';
import type { DateStyle, FileAnnotationType, Mode } from './config';
import { fromOutputLevel } from './config';
import { extensionPrefix } from './constants';
import type { GlCommands } from './constants.commands';
import { MarkdownContentProvider } from './documents/markdown';
import { EventBus } from './eventBus';
import { GitFileSystemProvider } from './git/fsProvider';
import { GitProviderService } from './git/gitProviderService';
import type { RepositoryLocationProvider } from './git/location/repositorylocationProvider';
import { LineHoverController } from './hovers/lineHoverController';
import { AIProviderService } from './plus/ai/aiProviderService';
import { DraftService } from './plus/drafts/draftsService';
import { AccountAuthenticationProvider } from './plus/gk/authenticationProvider';
import { OrganizationService } from './plus/gk/organizationService';
import { ProductConfigProvider } from './plus/gk/productConfigProvider';
import { ServerConnection } from './plus/gk/serverConnection';
import { SubscriptionService } from './plus/gk/subscriptionService';
import { UrlsProvider } from './plus/gk/urlsProvider';
import { GraphStatusBarController } from './plus/graph/statusbar';
import type { CloudIntegrationService } from './plus/integrations/authentication/cloudIntegrationService';
import { ConfiguredIntegrationService } from './plus/integrations/authentication/configuredIntegrationService';
import { IntegrationAuthenticationService } from './plus/integrations/authentication/integrationAuthenticationService';
import { IntegrationService } from './plus/integrations/integrationService';
import type { AzureDevOpsApi } from './plus/integrations/providers/azure/azure';
import type { BitbucketApi } from './plus/integrations/providers/bitbucket/bitbucket';
import type { GitHubApi } from './plus/integrations/providers/github/github';
import type { GitLabApi } from './plus/integrations/providers/gitlab/gitlab';
import { EnrichmentService } from './plus/launchpad/enrichmentService';
import { LaunchpadIndicator } from './plus/launchpad/launchpadIndicator';
import { LaunchpadProvider } from './plus/launchpad/launchpadProvider';
import { RepositoryIdentityService } from './plus/repos/repositoryIdentityService';
import type { SharedGkStorageLocationProvider } from './plus/repos/sharedGkStorageLocationProvider';
import { WorkspacesApi } from './plus/workspaces/workspacesApi';
import { scheduleAddMissingCurrentWorkspaceRepos, WorkspacesService } from './plus/workspaces/workspacesService';
import { StatusBarController } from './statusbar/statusBarController';
import { executeCommand } from './system/-webview/command';
import { configuration } from './system/-webview/configuration';
import { Keyboard } from './system/-webview/keyboard';
import type { Storage } from './system/-webview/storage';
import { memoize } from './system/decorators/-webview/memoize';
import { log } from './system/decorators/log';
import { Logger } from './system/logger';
import { TelemetryService } from './telemetry/telemetry';
import { UsageTracker } from './telemetry/usageTracker';
import { isWalkthroughSupported, WalkthroughStateProvider } from './telemetry/walkthroughStateProvider';
import { GitTerminalLinkProvider } from './terminal/linkProvider';
import { GitDocumentTracker } from './trackers/documentTracker';
import { LineTracker } from './trackers/lineTracker';
import { DeepLinkService } from './uris/deepLinks/deepLinkService';
import { UriService } from './uris/uriService';
import { ViewFileDecorationProvider } from './views/viewDecorationProvider';
import { Views } from './views/views';
import { VslsController } from './vsls/vsls';
import { registerComposerWebviewPanel } from './webviews/plus/composer/registration';
import { registerGraphWebviewCommands, registerGraphWebviewPanel } from './webviews/plus/graph/registration';
import { registerPatchDetailsWebviewPanel } from './webviews/plus/patchDetails/registration';
import { registerTimelineWebviewCommands, registerTimelineWebviewPanel } from './webviews/plus/timeline/registration';
import { RebaseEditorProvider } from './webviews/rebase/rebaseEditor';
import { registerSettingsWebviewCommands, registerSettingsWebviewPanel } from './webviews/settings/registration';
import { WebviewsController } from './webviews/webviewsController';

export type Environment = 'dev' | 'staging' | 'production';

export class Container {
	static #instance: Container | undefined;
	static #proxy = new Proxy<Container>({} as Container, {
		get: function (_target, prop) {
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
	): Container {
		if (Container.#instance != null) throw new Error('Container is already initialized');

		Container.#instance = new Container(context, storage, prerelease, version, previousVersion);
		return Container.#instance;
	}

	static get instance(): Container {
		return Container.#instance ?? Container.#proxy;
	}

	private _onReady: EventEmitter<void> = new EventEmitter<void>();
	get onReady(): Event<void> {
		if (this._ready) {
			const emitter = new EventEmitter<void>();
			setTimeout(() => emitter.fire(), 0);
			return emitter.event;
		}

		return this._onReady.event;
	}

	readonly BranchDateFormatting = {
		dateFormat: undefined! as string | null,
		dateStyle: undefined! as DateStyle,

		reset: (): void => {
			this.BranchDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.BranchDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly CommitDateFormatting = {
		dateFormat: null as string | null,
		dateSource: 'authored',
		dateStyle: 'relative',

		reset: (): void => {
			this.CommitDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.CommitDateFormatting.dateSource = configuration.get('defaultDateSource');
			this.CommitDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly CommitShaFormatting = {
		length: 7,

		reset: (): void => {
			// Don't allow shas to be shortened to less than 5 characters
			this.CommitShaFormatting.length = Math.max(5, configuration.get('advanced.abbreviatedShaLength'));
		},
	};

	readonly PullRequestDateFormatting = {
		dateFormat: null as string | null,
		dateStyle: 'relative',

		reset: (): void => {
			this.PullRequestDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.PullRequestDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	readonly TagDateFormatting = {
		dateFormat: null as string | null,
		dateStyle: 'relative',

		reset: (): void => {
			this.TagDateFormatting.dateFormat = configuration.get('defaultDateFormat');
			this.TagDateFormatting.dateStyle = configuration.get('defaultDateStyle');
		},
	};

	private readonly _connection: ServerConnection;
	private _disposables: Disposable[];
	private _terminalLinks: GitTerminalLinkProvider | undefined;
	private _launchpadIndicator: LaunchpadIndicator | undefined;

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
			configuration,
			(this._storage = storage),
			(this._telemetry = new TelemetryService(this)),
			(this._usage = new UsageTracker(this, storage)),
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
		];

		this._urls = new UrlsProvider(this.env);
		this._disposables.push((this._connection = new ServerConnection(this, this._urls)));

		this._disposables.push(
			(this._accountAuthentication = new AccountAuthenticationProvider(this, this._connection)),
		);
		this._disposables.push((this._uri = new UriService(this)));
		this._disposables.push((this._subscription = new SubscriptionService(this, this._connection, previousVersion)));
		if (isWalkthroughSupported()) {
			this._disposables.push((this._walkthrough = new WalkthroughStateProvider(this)));
		}
		this._disposables.push((this._organizations = new OrganizationService(this, this._connection)));

		this._disposables.push((this._git = new GitProviderService(this)));
		this._disposables.push(new GitFileSystemProvider(this));

		this._disposables.push((this._deepLinks = new DeepLinkService(this)));

		this._disposables.push((this._actionRunners = new ActionRunners(this)));
		this._disposables.push((this._documentTracker = new GitDocumentTracker(this)));
		this._disposables.push((this._lineTracker = new LineTracker(this, this._documentTracker)));
		this._disposables.push((this._keyboard = new Keyboard()));
		this._disposables.push((this._vsls = new VslsController(this)));
		this._disposables.push((this._eventBus = new EventBus()));
		this._disposables.push((this._launchpadProvider = new LaunchpadProvider(this)));
		this._disposables.push((this._markdownProvider = new MarkdownContentProvider(this)));

		this._disposables.push((this._fileAnnotationController = new FileAnnotationController(this)));
		this._disposables.push((this._lineAnnotationController = new LineAnnotationController(this)));
		this._disposables.push((this._lineHoverController = new LineHoverController(this)));
		this._disposables.push((this._statusBarController = new StatusBarController(this)));
		this._disposables.push((this._codeLensController = new GitCodeLensController(this)));

		const webviews = new WebviewsController(this);
		this._disposables.push(webviews);
		this._disposables.push((this._views = new Views(this, webviews)));

		const graphPanels = registerGraphWebviewPanel(webviews);
		this._disposables.push(graphPanels);
		this._disposables.push(registerGraphWebviewCommands(this, graphPanels));
		this._disposables.push(new GraphStatusBarController(this));

		const composerPanels = registerComposerWebviewPanel(webviews);
		this._disposables.push(composerPanels);

		const timelinePanels = registerTimelineWebviewPanel(webviews);
		this._disposables.push(timelinePanels);
		this._disposables.push(registerTimelineWebviewCommands(timelinePanels));

		this._disposables.push((this._rebaseEditor = new RebaseEditorProvider(this)));

		const settingsPanels = registerSettingsWebviewPanel(webviews);
		this._disposables.push(settingsPanels);
		this._disposables.push(registerSettingsWebviewCommands(settingsPanels));

		this._disposables.push(new ViewFileDecorationProvider());

		const patchDetailsPanels = registerPatchDetailsWebviewPanel(webviews);
		this._disposables.push(patchDetailsPanels);

		if (configuration.get('launchpad.indicator.enabled')) {
			this._disposables.push((this._launchpadIndicator = new LaunchpadIndicator(this, this._launchpadProvider)));
		}

		if (configuration.get('terminalLinks.enabled')) {
			this._disposables.push((this._terminalLinks = new GitTerminalLinkProvider(this)));
		}

		const cliIntegration = getGkCliIntegrationProvider(this);
		if (cliIntegration != null) {
			this._disposables.push(cliIntegration);
		}

		this._disposables.push(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'terminalLinks.enabled')) {
					this._terminalLinks?.dispose();
					this._terminalLinks = undefined;
					if (configuration.get('terminalLinks.enabled')) {
						this._disposables.push((this._terminalLinks = new GitTerminalLinkProvider(this)));
					}
				}

				if (configuration.changed(e, 'launchpad.indicator.enabled')) {
					this._launchpadIndicator?.dispose();
					this._launchpadIndicator = undefined;

					this.telemetry.sendEvent('launchpad/indicator/hidden');

					if (configuration.get('launchpad.indicator.enabled')) {
						this._disposables.push(
							(this._launchpadIndicator = new LaunchpadIndicator(this, this._launchpadProvider)),
						);
					}
				}
			}),
		);

		context.subscriptions.push({
			dispose: () => this._disposables.reverse().forEach(d => void d.dispose()),
		});

		scheduleAddMissingCurrentWorkspaceRepos(this);
	}

	deactivate(): void {
		this._deactivating = true;
	}

	private _deactivating: boolean = false;
	get deactivating(): boolean {
		return this._deactivating;
	}

	private _ready: boolean = false;

	async ready(): Promise<void> {
		if (this._ready) throw new Error('Container is already ready');

		this._ready = true;
		await this.registerGitProviders();
		queueMicrotask(() => this._onReady.fire());
	}

	@log()
	private async registerGitProviders(): Promise<void> {
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
	get accountAuthentication(): AccountAuthenticationProvider {
		return this._accountAuthentication;
	}

	private readonly _actionRunners: ActionRunners;
	get actionRunners(): ActionRunners {
		return this._actionRunners;
	}

	private _ai: AIProviderService | undefined;
	get ai(): AIProviderService {
		if (this._ai == null) {
			this._disposables.push((this._ai = new AIProviderService(this, this._connection)));
		}
		return this._ai;
	}

	private _autolinks: AutolinksProvider | undefined;
	get autolinks(): AutolinksProvider {
		if (this._autolinks == null) {
			this._disposables.push((this._autolinks = new AutolinksProvider(this)));
		}

		return this._autolinks;
	}

	private _cache: CacheProvider | undefined;
	get cache(): CacheProvider {
		if (this._cache == null) {
			this._disposables.push((this._cache = new CacheProvider(this)));
		}

		return this._cache;
	}

	private _cloudIntegrations: Promise<CloudIntegrationService | undefined> | undefined;
	get cloudIntegrations(): Promise<CloudIntegrationService | undefined> {
		if (this._cloudIntegrations == null) {
			async function load(this: Container) {
				try {
					const cloudIntegrations = new (
						await import(
							/* webpackChunkName: "integrations" */ './plus/integrations/authentication/cloudIntegrationService'
						)
					).CloudIntegrationService(this, this._connection);
					return cloudIntegrations;
				} catch (ex) {
					Logger.error(ex);
					return undefined;
				}
			}

			this._cloudIntegrations = load.call(this);
		}

		return this._cloudIntegrations;
	}

	private _drafts: DraftService | undefined;
	get drafts(): DraftService {
		if (this._drafts == null) {
			this._disposables.push((this._drafts = new DraftService(this, this._connection)));
		}
		return this._drafts;
	}

	private readonly _codeLensController: GitCodeLensController;
	get codeLens(): GitCodeLensController {
		return this._codeLensController;
	}

	private readonly _context: ExtensionContext;
	get context(): ExtensionContext {
		return this._context;
	}

	@memoize()
	get debugging(): boolean {
		return this._context.extensionMode === ExtensionMode.Development;
	}

	private readonly _deepLinks: DeepLinkService;
	get deepLinks(): DeepLinkService {
		return this._deepLinks;
	}

	private readonly _documentTracker: GitDocumentTracker;
	get documentTracker(): GitDocumentTracker {
		return this._documentTracker;
	}

	private _enrichments: EnrichmentService | undefined;
	get enrichments(): EnrichmentService {
		if (this._enrichments == null) {
			this._disposables.push((this._enrichments = new EnrichmentService(this, this._connection)));
		}

		return this._enrichments;
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
	get events(): EventBus {
		return this._eventBus;
	}

	private readonly _fileAnnotationController: FileAnnotationController;
	get fileAnnotations(): FileAnnotationController {
		return this._fileAnnotationController;
	}

	private readonly _launchpadProvider: LaunchpadProvider;
	get launchpad(): LaunchpadProvider {
		return this._launchpadProvider;
	}

	private readonly _markdownProvider: MarkdownContentProvider;
	get markdown(): MarkdownContentProvider {
		return this._markdownProvider;
	}

	private readonly _git: GitProviderService;
	get git(): GitProviderService {
		return this._git;
	}

	private _azure: Promise<AzureDevOpsApi | undefined> | undefined;
	get azure(): Promise<AzureDevOpsApi | undefined> {
		if (this._azure == null) {
			async function load(this: Container) {
				try {
					const azure = new (
						await import(/* webpackChunkName: "integrations" */ './plus/integrations/providers/azure/azure')
					).AzureDevOpsApi(this);
					this._disposables.push(azure);
					return azure;
				} catch (ex) {
					Logger.error(ex);
					return undefined;
				}
			}

			this._azure = load.call(this);
		}

		return this._azure;
	}

	private _bitbucket: Promise<BitbucketApi | undefined> | undefined;
	get bitbucket(): Promise<BitbucketApi | undefined> {
		if (this._bitbucket == null) {
			async function load(this: Container) {
				try {
					const bitbucket = new (
						await import(
							/* webpackChunkName: "integrations" */ './plus/integrations/providers/bitbucket/bitbucket'
						)
					).BitbucketApi(this);
					this._disposables.push(bitbucket);
					return bitbucket;
				} catch (ex) {
					Logger.error(ex);
					return undefined;
				}
			}

			this._bitbucket = load.call(this);
		}

		return this._bitbucket;
	}

	private _github: Promise<GitHubApi | undefined> | undefined;
	get github(): Promise<GitHubApi | undefined> {
		if (this._github == null) {
			async function load(this: Container) {
				try {
					const github = new (
						await import(
							/* webpackChunkName: "integrations" */ './plus/integrations/providers/github/github'
						)
					).GitHubApi(this);
					this._disposables.push(github);
					return github;
				} catch (ex) {
					Logger.error(ex);
					return undefined;
				}
			}

			this._github = load.call(this);
		}

		return this._github;
	}

	private _gitlab: Promise<GitLabApi | undefined> | undefined;
	get gitlab(): Promise<GitLabApi | undefined> {
		if (this._gitlab == null) {
			async function load(this: Container) {
				try {
					const gitlab = new (
						await import(
							/* webpackChunkName: "integrations" */ './plus/integrations/providers/gitlab/gitlab'
						)
					).GitLabApi(this);
					this._disposables.push(gitlab);
					return gitlab;
				} catch (ex) {
					Logger.error(ex);
					return undefined;
				}
			}

			this._gitlab = load.call(this);
		}

		return this._gitlab;
	}

	@memoize()
	get id(): string {
		return this._context.extension.id;
	}

	private _integrations: IntegrationService | undefined;
	get integrations(): IntegrationService {
		if (this._integrations == null) {
			const configuredIntegrationService = new ConfiguredIntegrationService(this);
			const authService = new IntegrationAuthenticationService(this, configuredIntegrationService);
			this._disposables.push(
				authService,
				configuredIntegrationService,
				(this._integrations = new IntegrationService(this, authService, configuredIntegrationService)),
			);
		}
		return this._integrations;
	}

	private readonly _keyboard: Keyboard;
	get keyboard(): Keyboard {
		return this._keyboard;
	}

	private readonly _lineAnnotationController: LineAnnotationController;
	get lineAnnotations(): LineAnnotationController {
		return this._lineAnnotationController;
	}

	private readonly _lineHoverController: LineHoverController;
	get lineHovers(): LineHoverController {
		return this._lineHoverController;
	}

	private readonly _lineTracker: LineTracker;
	get lineTracker(): LineTracker {
		return this._lineTracker;
	}

	private _mode: Mode | undefined;
	get mode(): Mode | undefined {
		if (this._mode == null) {
			this._mode = configuration.get('modes')?.[configuration.get('mode.active')];
		}
		return this._mode;
	}

	private _organizations: OrganizationService;
	get organizations(): OrganizationService {
		return this._organizations;
	}

	private readonly _prerelease;
	get prerelease(): boolean {
		return this._prerelease;
	}

	@memoize()
	get prereleaseOrDebugging(): boolean {
		return this._prerelease || this.debugging;
	}

	private _productConfig: ProductConfigProvider | undefined;
	get productConfig(): ProductConfigProvider {
		this._productConfig ??= new ProductConfigProvider(this, this._connection);
		return this._productConfig;
	}

	private readonly _rebaseEditor: RebaseEditorProvider;
	get rebaseEditor(): RebaseEditorProvider {
		return this._rebaseEditor;
	}

	private _repositoryIdentity: RepositoryIdentityService | undefined;
	get repositoryIdentity(): RepositoryIdentityService {
		if (this._repositoryIdentity == null) {
			this._disposables.push(
				(this._repositoryIdentity = new RepositoryIdentityService(this, this.repositoryLocator)),
			);
		}
		return this._repositoryIdentity;
	}

	private _repositoryLocator: RepositoryLocationProvider | null | undefined;
	get repositoryLocator(): RepositoryLocationProvider | undefined {
		if (this._repositoryLocator === undefined) {
			this._repositoryLocator = getSupportedRepositoryLocationProvider(this, this.sharedGkStorage!) ?? null;
			if (this._repositoryLocator != null) {
				this._disposables.push(this._repositoryLocator);
			}
		}
		return this._repositoryLocator ?? undefined;
	}

	private _sharedGkStorage: SharedGkStorageLocationProvider | null | undefined;
	private get sharedGkStorage(): SharedGkStorageLocationProvider | undefined {
		if (this._sharedGkStorage === undefined) {
			this._sharedGkStorage = getSharedGKStorageLocationProvider(this) ?? null;
		}
		return this._sharedGkStorage ?? undefined;
	}

	private readonly _statusBarController: StatusBarController;
	get statusBar(): StatusBarController {
		return this._statusBarController;
	}

	private readonly _storage: Storage;
	get storage(): Storage {
		return this._storage;
	}

	private _subscription: SubscriptionService;
	get subscription(): SubscriptionService {
		return this._subscription;
	}

	private readonly _telemetry: TelemetryService;
	get telemetry(): TelemetryService {
		return this._telemetry;
	}

	private readonly _uri: UriService;
	get uri(): UriService {
		return this._uri;
	}

	private readonly _urls: UrlsProvider;
	get urls(): UrlsProvider {
		return this._urls;
	}

	private readonly _usage: UsageTracker;
	get usage(): UsageTracker {
		return this._usage;
	}

	private readonly _walkthrough: WalkthroughStateProvider | undefined;
	get walkthrough(): WalkthroughStateProvider | undefined {
		return this._walkthrough;
	}

	private readonly _version: string;
	get version(): string {
		return this._version;
	}

	private readonly _views: Views;
	get views(): Views {
		return this._views;
	}

	private readonly _vsls: VslsController;
	get vsls(): VslsController {
		return this._vsls;
	}

	private _workspaces: WorkspacesService | undefined;
	get workspaces(): WorkspacesService {
		if (this._workspaces == null) {
			this._disposables.push(
				(this._workspaces = new WorkspacesService(
					this,
					new WorkspacesApi(this, this._connection),
					getSupportedWorkspacesStorageProvider(this, this.sharedGkStorage!),
					this.repositoryLocator,
				)),
			);
		}
		return this._workspaces;
	}

	private ensureModeApplied() {
		const mode = this.mode;
		if (mode == null) {
			configuration.clearOverrides();

			return;
		}

		if (mode.annotations != null) {
			let command: GlCommands | undefined;
			switch (mode.annotations) {
				case 'blame':
					command = 'gitlens.toggleFileBlame';
					break;
				case 'changes':
					command = 'gitlens.toggleFileChanges';
					break;
				case 'heatmap':
					command = 'gitlens.toggleFileHeatmap';
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
