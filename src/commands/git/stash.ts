import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { StepsContext } from '../quick-wizard/models/steps.js';
import type { SubcommandState } from '../quick-wizard/quickCommandWithSubcommands.js';
import { QuickCommandWithSubcommands } from '../quick-wizard/quickCommandWithSubcommands.js';
import type { StashApplyOrPopState, StashApplyOrPopStepNames } from './stash/applyOrPop.js';
import { StashApplyOrPopGitCommand } from './stash/applyOrPop.js';
import type { StashDropState, StashDropStepNames } from './stash/drop.js';
import { StashDropGitCommand } from './stash/drop.js';
import type { StashListState, StashListStepNames } from './stash/list.js';
import { StashListGitCommand } from './stash/list.js';
import type { StashPushState, StashPushStepNames } from './stash/push.js';
import { StashPushGitCommand } from './stash/push.js';
import type { StashRenameState, StashRenameStepNames } from './stash/rename.js';
import { StashRenameGitCommand } from './stash/rename.js';

type StepNames =
	| StashApplyOrPopStepNames
	| StashDropStepNames
	| StashListStepNames
	| StashPushStepNames
	| StashRenameStepNames;
type State =
	| SubcommandState<StashApplyOrPopState, 'apply'>
	| SubcommandState<StashApplyOrPopState, 'pop'>
	| SubcommandState<StashDropState, 'drop'>
	| SubcommandState<StashListState, 'list'>
	| SubcommandState<StashPushState, 'push'>
	| SubcommandState<StashRenameState, 'rename'>;
type Subcommands = State['subcommand'];

export interface StashContext<TStepNames extends StepNames = StepNames> extends StepsContext<TStepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	readonly: boolean;
	title: string;
}

export interface StashGitCommandArgs {
	readonly command: 'stash';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashGitCommand extends QuickCommandWithSubcommands<Subcommands, State, StashContext> {
	constructor(container: Container, args?: StashGitCommandArgs) {
		super(container, 'stash', 'stash', 'Stash', {
			description: 'shelves (stashes) local changes to be reapplied later',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	protected override createContext(context?: StepsContext<any>): StashContext {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.stashes,
			readonly: false,
			title: this.title,
		};
	}

	protected override registerSubcommands(): void {
		this.registerSubcommand('apply', new StashApplyOrPopGitCommand(this.container, { command: 'stash-apply' }));
		this.registerSubcommand('pop', new StashApplyOrPopGitCommand(this.container, { command: 'stash-pop' }));
		this.registerSubcommand('drop', new StashDropGitCommand(this.container));
		this.registerSubcommand('list', new StashListGitCommand(this.container));
		this.registerSubcommand('push', new StashPushGitCommand(this.container));
		this.registerSubcommand('rename', new StashRenameGitCommand(this.container));
	}
}
