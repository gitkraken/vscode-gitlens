import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { StepsContext } from '../quick-wizard/models/steps.js';
import type { SubcommandState } from '../quick-wizard/quickCommandWithSubcommands.js';
import { QuickCommandWithSubcommands } from '../quick-wizard/quickCommandWithSubcommands.js';
import type { BranchCreateState, BranchCreateStepNames } from './branch/create.js';
import { BranchCreateGitCommand } from './branch/create.js';
import type { BranchDeleteState, BranchDeleteStepNames } from './branch/delete.js';
import { BranchDeleteGitCommand } from './branch/delete.js';
import type { BranchMergeTargetState, BranchMergeTargetStepNames } from './branch/mergeTarget.js';
import { BranchMergeTargetGitCommand } from './branch/mergeTarget.js';
import type { BranchRenameState, BranchRenameStepNames } from './branch/rename.js';
import { BranchRenameGitCommand } from './branch/rename.js';
import type { BranchUpstreamState, BranchUpstreamStepNames } from './branch/upstream.js';
import { BranchUpstreamGitCommand } from './branch/upstream.js';

type StepNames =
	| BranchCreateStepNames
	| BranchDeleteStepNames
	| BranchMergeTargetStepNames
	| BranchRenameStepNames
	| BranchUpstreamStepNames;

type State =
	| SubcommandState<BranchCreateState, 'create'>
	| SubcommandState<BranchDeleteState, 'delete'>
	| SubcommandState<BranchMergeTargetState, 'mergeTarget'>
	| SubcommandState<BranchDeleteState, 'prune'>
	| SubcommandState<BranchRenameState, 'rename'>
	| SubcommandState<BranchUpstreamState, 'upstream'>;
type Subcommands = State['subcommand'];

export interface BranchContext<TStepNames extends StepNames = StepNames> extends StepsContext<TStepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	showTags: boolean;
	title: string;
}

export interface BranchGitCommandArgs {
	readonly command: 'branch';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchGitCommand extends QuickCommandWithSubcommands<Subcommands, State, BranchContext> {
	constructor(container: Container, args?: BranchGitCommandArgs) {
		super(container, 'branch', 'branch', 'Branch', {
			description: 'create, change merge target, change upstream, prune, rename, or delete branches',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	protected override createContext(context?: StepsContext<any>): BranchContext {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.branches,
			showTags: false,
			title: this.title,
		};
	}

	protected override registerSubcommands(): void {
		this.registerSubcommand('create', new BranchCreateGitCommand(this.container));
		this.registerSubcommand('delete', new BranchDeleteGitCommand(this.container));
		this.registerSubcommand('mergeTarget', new BranchMergeTargetGitCommand(this.container));
		this.registerSubcommand('prune', new BranchDeleteGitCommand(this.container, { command: 'branch-prune' }));
		this.registerSubcommand('rename', new BranchRenameGitCommand(this.container));
		this.registerSubcommand('upstream', new BranchUpstreamGitCommand(this.container));
	}
}
