import { commands, ConfigurationChangeEvent, ConfigurationScope, Event, EventEmitter, ExtensionContext } from 'vscode';
import { getSupportedGitProviders } from '@env/git';
import { Autolinks } from './annotations/autolinks';
import { FileAnnotationController } from './annotations/fileAnnotationController';
import { LineAnnotationController } from './annotations/lineAnnotationController';
import { ActionRunners } from './api/actionRunners';
import { resetAvatarCache } from './avatars';
import { GitCodeLensController } from './codelens/codeLensController';
import { Commands, ToggleFileAnnotationCommandArgs } from './commands';
import {
	AnnotationsToggleMode,
	Config,
	configuration,
	ConfigurationWillChangeEvent,
	FileAnnotationType,
} from './configuration';
import { GitFileSystemProvider } from './git/fsProvider';
import { GitProviderService } from './git/gitProviderService';
import { LineHoverController } from './hovers/lineHoverController';
import { Keyboard } from './keyboard';
import { Logger } from './logger';
import { StatusBarController } from './statusbar/statusBarController';
import { log } from './system/decorators/log';
import { memoize } from './system/decorators/memoize';
import { GitTerminalLinkProvider } from './terminal/linkProvider';
import { GitDocumentTracker } from './trackers/gitDocumentTracker';
import { GitLineTracker } from './trackers/gitLineTracker';
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
import { VslsController } from './vsls/vsls';
import { RebaseEditorProvider } from './webviews/rebaseEditor';
import { SettingsWebview } from './webviews/settingsWebview';
import { WelcomeWebview } from './webviews/welcomeWebview';

export class Container {
	static #instance: Container | undefined;
	static #proxy = new Proxy<Container>({} as Container, {
		get: function (target, prop) {
			// In case anyone has cached this instance
			if (Container.#instance != null) return (Container.#instance as any)[prop];

			// Allow access to config before we are initialized
			if (prop === 'config') return configuration.get();

			// debugger;
			throw new Error('Container is not initialized');
		},
	});

	static create(context: ExtensionContext, cfg: Config) {
		if (Container.#instance != null) throw new Error('Container is already initialized');

		Container.#instance = new Container(context, cfg);
		return Container.#instance;
	}

	static get instance(): Container {
		return Container.#instance ?? Container.#proxy;
	}

	private _onReady: EventEmitter<void> = new EventEmitter<void>();
	get onReady(): Event<void> {
		return this._onReady.event;
	}

	private _configsAffectedByMode: string[] | undefined;
	private _applyModeConfigurationTransformBound:
		| ((e: ConfigurationChangeEvent) => ConfigurationChangeEvent)
		| undefined;

	private _terminalLinks: GitTerminalLinkProvider | undefined;

	private constructor(context: ExtensionContext, config: Config) {
		this._context = context;
		this._config = this.applyMode(config);
		context.subscriptions.push(configuration.onWillChange(this.onConfigurationChanging, this));

		context.subscriptions.push((this._git = new GitProviderService(this)));
		context.subscriptions.push(new GitFileSystemProvider(this));

		context.subscriptions.push((this._actionRunners = new ActionRunners(this)));
		context.subscriptions.push((this._tracker = new GitDocumentTracker(this)));
		context.subscriptions.push((this._lineTracker = new GitLineTracker(this)));
		context.subscriptions.push((this._keyboard = new Keyboard()));
		context.subscriptions.push((this._vsls = new VslsController(this)));

		context.subscriptions.push((this._fileAnnotationController = new FileAnnotationController(this)));
		context.subscriptions.push((this._lineAnnotationController = new LineAnnotationController(this)));
		context.subscriptions.push((this._lineHoverController = new LineHoverController(this)));
		context.subscriptions.push((this._statusBarController = new StatusBarController(this)));
		context.subscriptions.push((this._codeLensController = new GitCodeLensController(this)));

		context.subscriptions.push((this._settingsWebview = new SettingsWebview(this)));
		context.subscriptions.push((this._welcomeWebview = new WelcomeWebview(this)));
		context.subscriptions.push((this._rebaseEditor = new RebaseEditorProvider(this)));

		context.subscriptions.push(new ViewFileDecorationProvider());
		context.subscriptions.push((this._repositoriesView = new RepositoriesView(this)));
		context.subscriptions.push((this._commitsView = new CommitsView(this)));
		context.subscriptions.push((this._fileHistoryView = new FileHistoryView(this)));
		context.subscriptions.push((this._lineHistoryView = new LineHistoryView(this)));
		context.subscriptions.push((this._branchesView = new BranchesView(this)));
		context.subscriptions.push((this._remotesView = new RemotesView(this)));
		context.subscriptions.push((this._stashesView = new StashesView(this)));
		context.subscriptions.push((this._tagsView = new TagsView(this)));
		context.subscriptions.push((this._contributorsView = new ContributorsView(this)));
		context.subscriptions.push((this._searchAndCompareView = new SearchAndCompareView(this)));

		if (config.terminalLinks.enabled) {
			context.subscriptions.push((this._terminalLinks = new GitTerminalLinkProvider(this)));
		}

		context.subscriptions.push(
			configuration.onDidChange(e => {
				if (!configuration.changed(e, 'terminalLinks.enabled')) return;

				this._terminalLinks?.dispose();
				if (this.config.terminalLinks.enabled) {
					context.subscriptions.push((this._terminalLinks = new GitTerminalLinkProvider(this)));
				}
			}),
		);
	}

	private _ready: boolean = false;

	ready() {
		if (this._ready) throw new Error('Container is already ready');

		this._ready = true;
		this.registerGitProviders();
		queueMicrotask(() => this._onReady.fire());
	}

	@log()
	private registerGitProviders() {
		const providers = getSupportedGitProviders(this);
		for (const provider of providers) {
			this._context.subscriptions.push(this._git.register(provider.descriptor.id, provider));
		}

		this._git.registrationComplete();
	}

	private onConfigurationChanging(e: ConfigurationWillChangeEvent) {
		this._config = undefined;

		if (configuration.changed(e.change, 'outputLevel')) {
			Logger.logLevel = configuration.get('outputLevel');
		}

		if (configuration.changed(e.change, 'defaultGravatarsStyle')) {
			resetAvatarCache('fallback');
		}

		if (configuration.changed(e.change, 'mode') || configuration.changed(e.change, 'modes')) {
			if (this._applyModeConfigurationTransformBound == null) {
				this._applyModeConfigurationTransformBound = this.applyModeConfigurationTransform.bind(this);
			}
			e.transform = this._applyModeConfigurationTransformBound;
		}
	}

	private _actionRunners: ActionRunners;
	get actionRunners() {
		if (this._actionRunners == null) {
			this._context.subscriptions.push((this._actionRunners = new ActionRunners(this)));
		}

		return this._actionRunners;
	}

	private _autolinks: Autolinks | undefined;
	get autolinks() {
		if (this._autolinks == null) {
			this._context.subscriptions.push((this._autolinks = new Autolinks(this)));
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
			this._context.subscriptions.push((this._branchesView = new BranchesView(this)));
		}

		return this._branchesView;
	}

	private _commitsView: CommitsView | undefined;
	get commitsView() {
		if (this._commitsView == null) {
			this._context.subscriptions.push((this._commitsView = new CommitsView(this)));
		}

		return this._commitsView;
	}

	private _config: Config | undefined;
	get config() {
		if (this._config == null) {
			this._config = this.applyMode(configuration.get());
		}
		return this._config;
	}

	private _context: ExtensionContext;
	get context() {
		return this._context;
	}

	private _contributorsView: ContributorsView | undefined;
	get contributorsView() {
		if (this._contributorsView == null) {
			this._context.subscriptions.push((this._contributorsView = new ContributorsView(this)));
		}

		return this._contributorsView;
	}

	private _fileAnnotationController: FileAnnotationController;
	get fileAnnotations() {
		return this._fileAnnotationController;
	}

	private _fileHistoryView: FileHistoryView | undefined;
	get fileHistoryView() {
		if (this._fileHistoryView == null) {
			this._context.subscriptions.push((this._fileHistoryView = new FileHistoryView(this)));
		}

		return this._fileHistoryView;
	}

	private _git: GitProviderService;
	get git() {
		return this._git;
	}

	private _github: Promise<import('./github/github').GitHubApi | undefined> | undefined;
	get github() {
		if (this._github == null) {
			this._github = this._loadGitHubApi();
		}

		return this._github;
	}

	private async _loadGitHubApi() {
		try {
			return new (await import(/* webpackChunkName: "github" */ './github/github')).GitHubApi();
		} catch (ex) {
			Logger.error(ex);
			return undefined;
		}
	}

	@memoize()
	get insiders() {
		return this._context.extension.id.endsWith('-insiders');
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
			this._context.subscriptions.push((this._lineHistoryView = new LineHistoryView(this)));
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

	private _rebaseEditor: RebaseEditorProvider | undefined;
	get rebaseEditor() {
		if (this._rebaseEditor == null) {
			this._context.subscriptions.push((this._rebaseEditor = new RebaseEditorProvider(this)));
		}

		return this._rebaseEditor;
	}

	private _remotesView: RemotesView | undefined;
	get remotesView() {
		if (this._remotesView == null) {
			this._context.subscriptions.push((this._remotesView = new RemotesView(this)));
		}

		return this._remotesView;
	}

	private _repositoriesView: RepositoriesView | undefined;
	get repositoriesView(): RepositoriesView {
		if (this._repositoriesView == null) {
			this._context.subscriptions.push((this._repositoriesView = new RepositoriesView(this)));
		}

		return this._repositoriesView;
	}

	private _searchAndCompareView: SearchAndCompareView | undefined;
	get searchAndCompareView() {
		if (this._searchAndCompareView == null) {
			this._context.subscriptions.push((this._searchAndCompareView = new SearchAndCompareView(this)));
		}

		return this._searchAndCompareView;
	}

	private _settingsWebview: SettingsWebview;
	get settingsWebview() {
		return this._settingsWebview;
	}

	private _stashesView: StashesView | undefined;
	get stashesView() {
		if (this._stashesView == null) {
			this._context.subscriptions.push((this._stashesView = new StashesView(this)));
		}

		return this._stashesView;
	}

	private _statusBarController: StatusBarController;
	get statusBar() {
		return this._statusBarController;
	}

	private _tagsView: TagsView | undefined;
	get tagsView() {
		if (this._tagsView == null) {
			this._context.subscriptions.push((this._tagsView = new TagsView(this)));
		}

		return this._tagsView;
	}

	private _tracker: GitDocumentTracker;
	get tracker() {
		return this._tracker;
	}

	@memoize()
	get version(): string {
		return this.context.extension.packageJSON.version;
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

	private applyMode(config: Config) {
		if (!config.mode.active) return config;

		const mode = config.modes?.[config.mode.active];
		if (mode == null) return config;

		if (mode.annotations != null) {
			let command: string | undefined;
			switch (mode.annotations) {
				case 'blame':
					config.blame.toggleMode = AnnotationsToggleMode.Window;
					command = Commands.ToggleFileBlame;
					break;
				case 'changes':
					config.changes.toggleMode = AnnotationsToggleMode.Window;
					command = Commands.ToggleFileChanges;
					break;
				case 'heatmap':
					config.heatmap.toggleMode = AnnotationsToggleMode.Window;
					command = Commands.ToggleFileHeatmap;
					break;
			}

			if (command != null) {
				const commandArgs: ToggleFileAnnotationCommandArgs = {
					type: mode.annotations as FileAnnotationType,
					on: true,
				};
				// Make sure to delay the execution by a bit so that the configuration changes get propegated first
				setTimeout(() => commands.executeCommand(command!, commandArgs), 50);
			}
		}

		if (mode.codeLens != null) {
			config.codeLens.enabled = mode.codeLens;
		}

		if (mode.currentLine != null) {
			config.currentLine.enabled = mode.currentLine;
		}

		if (mode.hovers != null) {
			config.hovers.enabled = mode.hovers;
		}

		if (mode.statusBar != null) {
			config.statusBar.enabled = mode.statusBar;
		}

		return config;
	}

	private applyModeConfigurationTransform(e: ConfigurationChangeEvent): ConfigurationChangeEvent {
		if (this._configsAffectedByMode == null) {
			this._configsAffectedByMode = [
				`gitlens.${configuration.name('mode')}`,
				`gitlens.${configuration.name('modes')}`,
				`gitlens.${configuration.name('blame.toggleMode')}`,
				`gitlens.${configuration.name('changes.toggleMode')}`,
				`gitlens.${configuration.name('codeLens')}`,
				`gitlens.${configuration.name('currentLine')}`,
				`gitlens.${configuration.name('heatmap.toggleMode')}`,
				`gitlens.${configuration.name('hovers')}`,
				`gitlens.${configuration.name('statusBar')}`,
			];
		}

		const original = e.affectsConfiguration;
		return {
			...e,
			affectsConfiguration: (section: string, scope?: ConfigurationScope) =>
				this._configsAffectedByMode?.some(n => section.startsWith(n)) ? true : original(section, scope),
		};
	}
}
