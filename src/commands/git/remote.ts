import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { StepsContext } from '../quick-wizard/models/steps.js';
import type { SubcommandState } from '../quick-wizard/quickCommandWithSubcommands.js';
import { QuickCommandWithSubcommands } from '../quick-wizard/quickCommandWithSubcommands.js';
import type { RemoteAddState, RemoteAddStepNames } from './remote/add.js';
import { RemoteAddGitCommand } from './remote/add.js';
import type { RemotePruneState, RemotePruneStepNames } from './remote/prune.js';
import { RemotePruneGitCommand } from './remote/prune.js';
import type { RemoteRemoveState, RemoteRemoveStepNames } from './remote/remove.js';
import { RemoteRemoveGitCommand } from './remote/remove.js';

type StepNames = RemoteAddStepNames | RemoteRemoveStepNames | RemotePruneStepNames;
type State =
	| SubcommandState<RemoteAddState, 'add'>
	| SubcommandState<RemoteRemoveState, 'remove'>
	| SubcommandState<RemotePruneState, 'prune'>;
type Subcommands = State['subcommand'];

export interface RemoteContext<TStepNames extends StepNames = StepNames> extends StepsContext<TStepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

export interface RemoteGitCommandArgs {
	readonly command: 'remote';
	confirm?: boolean;
	state?: Partial<State>;
}

export class RemoteGitCommand extends QuickCommandWithSubcommands<Subcommands, State, RemoteContext> {
	constructor(container: Container, args?: RemoteGitCommandArgs) {
		super(container, 'remote', 'remote', 'Remote', {
			description: 'add, prune, or remove remotes',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	protected override createContext(context?: StepsContext<any>): RemoteContext {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.remotes,
			title: this.title,
		};
	}

	protected override registerSubcommands(): void {
		this.registerSubcommand('add', new RemoteAddGitCommand(this.container));
		this.registerSubcommand('prune', new RemotePruneGitCommand(this.container));
		this.registerSubcommand('remove', new RemoteRemoveGitCommand(this.container));
	}
}
