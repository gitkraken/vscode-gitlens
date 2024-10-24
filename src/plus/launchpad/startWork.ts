import type { QuickInputButton } from 'vscode';
import { ThemeIcon, Uri } from 'vscode';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../../commands/quickCommand';
import {
	canPickStepContinue,
	createPickStep,
	endSteps,
	QuickCommand,
	StepResultBreak,
} from '../../commands/quickCommand';
import { ensureAccessStep } from '../../commands/quickCommand.steps';
import { proBadge, Schemes } from '../../constants';
import { HostingIntegrationId } from '../../constants.integrations';
import type { Container } from '../../container';
import { PlusFeatures } from '../../features';
import type { Issue, IssueShape, SearchedIssue } from '../../git/models/issue';
import type { Repository } from '../../git/models/repository';
import type { RepositoryIdentityDescriptor } from '../../gk/models/repositoryIdentities';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT, createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import { fromNow } from '../../system/date';

export type StartWorkItem = {
	item: SearchedIssue;
};

export const StartWorkQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('beaker'),
	tooltip: 'Start Work on this Item',
};

export type StartWorkResult = { items: StartWorkItem[] };

interface Context {
	result: StartWorkResult;
	title: string;
}

interface State {
	item?: StartWorkItem;
	action?: StartWorkAction;
}

type StartWorkStepState<T extends State = State> = RequireSome<StepState<T>, 'item'>;

export type StartWorkAction = 'start';

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
}

function assertsStartWorkStepState(state: StepState<State>): asserts state is StartWorkStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}

export class StartWorkCommand extends QuickCommand<State> {
	constructor(container: Container) {
		super(container, 'startWork', 'startWork', `Start Work\u00a0\u00a0${proBadge}`, {
			description: 'Start work on an issue',
		});

		this.initialState = {
			counter: 0,
		};
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		const context: Context = {
			result: { items: [] },
			title: this.title,
		};

		while (this.canStepsContinue(state)) {
			context.title = this.title;
			const result = yield* ensureAccessStep(state, context, PlusFeatures.Launchpad);
			if (result === StepResultBreak) continue;

			await updateContextItems(this.container, context);

			if (state.counter < 1 || state.item == null) {
				const result = yield* this.pickIssueStep(state, context);
				if (result === StepResultBreak) continue;
				state.item = result;
			}

			assertsStartWorkStepState(state);

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.action = result;
			}

			if (typeof state.action === 'string') {
				switch (state.action) {
					case 'start':
						void startWork(this.container, state.item.item);
						break;
				}
			}

			endSteps(state);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *pickIssueStep(state: StepState<State>, context: Context): StepResultGenerator<StartWorkItem> {
		const getItems = (result: StartWorkResult) => {
			const items: QuickPickItemOfT<StartWorkItem>[] = [];

			if (result.items?.length) {
				items.push(
					...result.items.map(i => {
						const buttons = [StartWorkQuickInputButton];

						return {
							label:
								i.item.issue.title.length > 60
									? `${i.item.issue.title.substring(0, 60)}...`
									: i.item.issue.title,
							// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
							description: `\u00a0 ${i.item.issue.repository?.owner ?? ''}/${
								i.item.issue.repository?.repo ?? ''
							}#${i.item.issue.id} \u00a0`,
							detail: `      ${fromNow(i.item.issue.updatedDate)} by @${i.item.issue.author.name}`,
							buttons: buttons,
							iconPath:
								i.item.issue.author?.avatarUrl != null
									? Uri.parse(i.item.issue.author.avatarUrl)
									: undefined,
							item: i,
						};
					}),
				);
			}

			return items;
		};

		function getItemsAndPlaceholder() {
			if (!context.result.items.length) {
				return {
					placeholder: 'All done! Take a vacation',
					items: [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })],
				};
			}

			return {
				placeholder: 'Choose an item to focus on',
				items: getItems(context.result),
			};
		}

		const { items, placeholder } = getItemsAndPlaceholder();

		const step = createPickStep({
			title: context.title,
			placeholder: placeholder,
			matchOnDescription: true,
			matchOnDetail: true,
			items: items,
			onDidClickItemButton: (_quickpick, button, { item }) => {
				if (button === StartWorkQuickInputButton) {
					void startWork(this.container, item.item);
				}
			},
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) {
			return StepResultBreak;
		}
		const element = selection[0];
		return { ...element.item };
	}

	private *confirmStep(state: StartWorkStepState, _context: Context): StepResultGenerator<StartWorkAction> {
		const confirmations: (QuickPickItemOfT<StartWorkAction> | DirectiveQuickPickItem)[] = [
			createQuickPickSeparator(fromNow(state.item.item.issue.updatedDate)),
			createQuickPickItemOfT(
				{
					label: state.item.item.issue.title,
					description: `${state.item.item.issue.repository?.owner ?? ''}/${
						state.item.item.issue.repository?.repo ?? ''
					}#${state.item.item.issue.id}`,
					detail: state.item.item.issue.body ?? '',
					iconPath:
						state.item.item.issue.author?.avatarUrl != null
							? Uri.parse(state.item.item.issue.author.avatarUrl)
							: undefined,
					buttons: [StartWorkQuickInputButton],
				},
				'start',
			),
			createDirectiveQuickPickItem(Directive.Noop, false, { label: '' }),
			createQuickPickSeparator('Actions'),
			createQuickPickItemOfT(
				{
					label: 'Start Work...',
					detail: `Will start working on this issue`,
				},
				'start',
			),
		];

		const step = this.createConfirmStep(
			`Issue ${state.item.item.issue.repository?.owner ?? ''}/${state.item.item.issue.repository?.repo ?? ''}#${
				state.item.item.issue.id
			}`,
			confirmations,
			undefined,
			{
				placeholder: 'Choose an action to perform',
				onDidClickItemButton: (_quickpick, button, _item) => {
					switch (button) {
						case StartWorkQuickInputButton:
							void startWork(this.container, state.item.item);
							break;
					}
				},
			},
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

async function updateContextItems(container: Container, context: Context) {
	context.result = {
		items:
			(await container.integrations.getMyIssues([HostingIntegrationId.GitHub]))?.map(i => ({
				item: i,
			})) ?? [],
	};
}

async function startWork(container: Container, issue: SearchedIssue) {
	const _repo = await getOrOpenIssueRepository(container, issue.issue);
	//if (repo == null) return;

	/*void showInspectView({
		type: 'wip',
		inReview: false,
		repository: repo,
		source: 'launchpad',
	} satisfies ShowWipArgs);*/
}

export async function getOrOpenIssueRepository(
	container: Container,
	issue: IssueShape | Issue,
	options?: { promptIfNeeded?: boolean; skipVirtual?: boolean },
): Promise<Repository | undefined> {
	const identity = getRepositoryIdentityForIssue(issue);
	let repo = await container.repositoryIdentity.getRepository(identity, {
		openIfNeeded: true,
		keepOpen: false,
		prompt: false,
	});

	if (repo == null && !options?.skipVirtual) {
		const virtualUri = getVirtualUriForIssue(issue);
		if (virtualUri != null) {
			repo = await container.git.getOrOpenRepository(virtualUri, { closeOnOpen: true, detectNested: false });
		}
	}

	if (repo == null && options?.promptIfNeeded) {
		repo = await container.repositoryIdentity.getRepository(identity, {
			openIfNeeded: true,
			keepOpen: false,
			prompt: true,
		});
	}

	return repo;
}

export function getRepositoryIdentityForIssue(issue: IssueShape | Issue): IssueRepositoryIdentityDescriptor {
	if (issue.repository == null) throw new Error('Missing repository');

	return {
		remote: {
			url: issue.repository.url,
			domain: issue.provider.domain,
		},
		name: `${issue.repository.owner}/${issue.repository.repo}`,
		provider: {
			id: issue.provider.id,
			domain: issue.provider.domain,
			repoDomain: issue.repository.owner,
			repoName: issue.repository.repo,
			repoOwnerDomain: issue.repository.owner,
		},
	};
}

export function getVirtualUriForIssue(issue: IssueShape | Issue): Uri | undefined {
	if (issue.repository == null) throw new Error('Missing repository');
	if (issue.provider.id !== 'github') return undefined;

	const uri = Uri.parse(issue.repository.url ?? issue.url);
	return uri.with({ scheme: Schemes.Virtual, authority: 'github', path: uri.path });
}

export type IssueRepositoryIdentityDescriptor = RequireSomeWithProps<
	RequireSome<RepositoryIdentityDescriptor<string>, 'provider'>,
	'provider',
	'id' | 'domain' | 'repoDomain' | 'repoName'
> &
	RequireSomeWithProps<RequireSome<RepositoryIdentityDescriptor<string>, 'remote'>, 'remote', 'domain'>;
