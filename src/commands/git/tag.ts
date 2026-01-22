import type { Container } from '../../container.js';
import type { Repository } from '../../git/models/repository.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { StepsContext } from '../quick-wizard/models/steps.js';
import type { SubcommandState } from '../quick-wizard/quickCommandWithSubcommands.js';
import { QuickCommandWithSubcommands } from '../quick-wizard/quickCommandWithSubcommands.js';
import type { TagCreateState, TagCreateStepNames } from './tag/create.js';
import { TagCreateGitCommand } from './tag/create.js';
import type { TagDeleteState, TagDeleteStepNames } from './tag/delete.js';
import { TagDeleteGitCommand } from './tag/delete.js';

type StepNames = TagCreateStepNames | TagDeleteStepNames;
type State = SubcommandState<TagCreateState, 'create'> | SubcommandState<TagDeleteState, 'delete'>;
type Subcommands = State['subcommand'];

export interface TagContext<TStepNames extends StepNames = StepNames> extends StepsContext<TStepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	showTags: boolean;
	title: string;
}

export interface TagGitCommandArgs {
	readonly command: 'tag';
	confirm?: boolean;
	state?: Partial<State>;
}

export class TagGitCommand extends QuickCommandWithSubcommands<Subcommands, State, TagContext> {
	constructor(container: Container, args?: TagGitCommandArgs) {
		super(container, 'tag', 'tag', 'Tag', { description: 'create, or delete tags' });

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	protected override createContext(context?: StepsContext<any>): TagContext {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.tags,
			showTags: false,
			title: this.title,
		};
	}

	protected override registerSubcommands(): void {
		this.registerSubcommand('create', new TagCreateGitCommand(this.container));
		this.registerSubcommand('delete', new TagDeleteGitCommand(this.container));
	}
}
