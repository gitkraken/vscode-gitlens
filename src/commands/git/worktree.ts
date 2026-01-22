import type { Uri } from 'vscode';
import { proBadge, proBadgeSuperscript } from '../../constants.js';
import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { GitWorktree } from '../../git/models/worktree.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { StepsContext } from '../quick-wizard/models/steps.js';
import type { SubcommandState } from '../quick-wizard/quickCommandWithSubcommands.js';
import { QuickCommandWithSubcommands } from '../quick-wizard/quickCommandWithSubcommands.js';
import type { WorktreeCopyChangesState, WorktreeCopyChangesStepNames } from './worktree/copyChanges.js';
import { WorktreeCopyChangesGitCommand } from './worktree/copyChanges.js';
import type { WorktreeCreateState, WorktreeCreateStepNames } from './worktree/create.js';
import { WorktreeCreateGitCommand } from './worktree/create.js';
import type { WorktreeDeleteState, WorktreeDeleteStepNames } from './worktree/delete.js';
import { WorktreeDeleteGitCommand } from './worktree/delete.js';
import type { WorktreeOpenState, WorktreeOpenStepNames } from './worktree/open.js';
import { WorktreeOpenGitCommand } from './worktree/open.js';

type StepNames =
	| WorktreeCreateStepNames
	| WorktreeDeleteStepNames
	| WorktreeOpenStepNames
	| WorktreeCopyChangesStepNames;

type State =
	| SubcommandState<WorktreeCreateState, 'create'>
	| SubcommandState<WorktreeDeleteState, 'delete'>
	| SubcommandState<WorktreeOpenState, 'open'>
	| SubcommandState<WorktreeCopyChangesState, 'copy-changes'>;
type Subcommands = State['subcommand'];

export interface WorktreeContext<TStepNames extends StepNames = StepNames> extends StepsContext<TStepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	defaultUri?: Uri;
	pickedRootFolder?: Uri;
	pickedSpecificFolder?: Uri;
	showTags: boolean;
	title: string;
	worktrees?: GitWorktree[];
}

export interface WorktreeGitCommandArgs {
	readonly command: 'worktree';
	confirm?: boolean;
	state?: Partial<State>;
}

export class WorktreeGitCommand extends QuickCommandWithSubcommands<Subcommands, State, WorktreeContext> {
	constructor(container: Container, args?: WorktreeGitCommandArgs) {
		super(container, 'worktree', 'worktree', `Worktrees ${proBadgeSuperscript}`, {
			description: `${proBadge}\u00a0\u00a0open, create, or delete worktrees`,
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	protected override createContext(context?: StepsContext<any>): WorktreeContext {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.worktrees,
			showTags: false,
			title: this.title,
		};
	}

	protected override registerSubcommands(): void {
		this.registerSubcommand('create', new WorktreeCreateGitCommand(this.container));
		this.registerSubcommand('delete', new WorktreeDeleteGitCommand(this.container));
		this.registerSubcommand('open', new WorktreeOpenGitCommand(this.container));
		this.registerSubcommand('copy-changes', new WorktreeCopyChangesGitCommand(this.container));
	}
}
