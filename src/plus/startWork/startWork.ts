import { md5 } from '@env/crypto';
import slug from 'slug';
import type { QuickInputButton, QuickPick } from 'vscode';
import { Uri } from 'vscode';
import type {
	AsyncStepResultGenerator,
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
	freezeStep,
	QuickCommand,
	StepResultBreak,
} from '../../commands/quickCommand';
import { OpenOnGitHubQuickInputButton, OpenOnJiraQuickInputButton } from '../../commands/quickCommand.buttons';
import { getSteps } from '../../commands/quickWizard.utils';
import { proBadge } from '../../constants';
import type { IntegrationId } from '../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId } from '../../constants.integrations';
import type { Source, Sources, StartWorkTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { Issue, IssueShape, SearchedIssue } from '../../git/models/issue';
import { getOrOpenIssueRepository } from '../../git/models/issue';
import type { Repository } from '../../git/models/repository';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import { getScopedCounter } from '../../system/counter';
import { fromNow } from '../../system/date';
import { some } from '../../system/iterable';
import { configuration } from '../../system/vscode/configuration';
import { openUrl } from '../../system/vscode/utils';

export type StartWorkItem = {
	item: SearchedIssue;
};

export type StartWorkResult = { items: StartWorkItem[] };

interface Context {
	result: StartWorkResult;
	title: string;
	telemetryContext: StartWorkTelemetryContext | undefined;
	connectedIntegrations: Map<SupportedStartWorkIntegrationIds, boolean>;
}

interface State {
	item?: StartWorkItem;
	type?: StartWorkType;
}
interface StateWithType extends State {
	type: StartWorkType;
}

export type StartWorkType = 'branch' | 'issue';
type StartWorkTypeItem = { type: StartWorkType };

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
	source?: Sources;
	type?: StartWorkType;
}

export const supportedStartWorkIntegrations = [HostingIntegrationId.GitHub, IssueIntegrationId.Jira];
export type SupportedStartWorkIntegrationIds = (typeof supportedStartWorkIntegrations)[number];
const instanceCounter = getScopedCounter();

export class StartWorkCommand extends QuickCommand<State> {
	private readonly source: Source;
	private readonly telemetryContext: StartWorkTelemetryContext | undefined;
	constructor(container: Container, args?: StartWorkCommandArgs) {
		super(container, 'startWork', 'startWork', `Start Work\u00a0\u00a0${proBadge}`, {
			description: 'Start work on an issue',
		});

		this.source = { source: args?.source ?? 'commandPalette' };

		if (this.container.telemetry.enabled) {
			this.telemetryContext = { instance: instanceCounter.next() };
			this.container.telemetry.sendEvent('startWork/open', { ...this.telemetryContext }, this.source);
		}

		this.initialState = {
			counter: args?.type != null ? 1 : 0,
			type: args?.type,
		};
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		const context: Context = {
			result: { items: [] },
			title: this.title,
			telemetryContext: this.telemetryContext,
			connectedIntegrations: await this.getConnectedIntegrations(),
		};

		let opened = false;
		while (this.canStepsContinue(state)) {
			const hasConnectedIntegrations = this.hasConnectedIntegrations(context);
			context.title = this.title;

			if (state.counter < 1 || state.type == null) {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						opened ? 'startWork/steps/type' : 'startWork/opened',
						{
							...context.telemetryContext!,
							connected: hasConnectedIntegrations,
						},
						this.source,
					);
				}

				opened = true;
				const result = yield* this.selectTypeStep(state);
				if (result === StepResultBreak) continue;
				state.type = result.type;

				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						'startWork/type/chosen',
						{
							...context.telemetryContext!,
							connected: hasConnectedIntegrations,
							type: state.type,
						},
						this.source,
					);
				}
			}

			if (state.counter < 2 && state.type === 'issue') {
				if (!hasConnectedIntegrations) {
					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							opened ? 'startWork/steps/connect' : 'startWork/opened',
							{
								...context.telemetryContext!,
								connected: false,
								type: state.type,
							},
							this.source,
						);
					}

					opened = true;

					const isUsingCloudIntegrations = configuration.get('cloudIntegrations.enabled', undefined, false);
					const result = isUsingCloudIntegrations
						? yield* this.confirmCloudIntegrationsConnectStep(state, context)
						: yield* this.confirmLocalIntegrationConnectStep(state, context);
					if (result === StepResultBreak) {
						return result;
					}
					context.connectedIntegrations = await this.getConnectedIntegrations();
					if (!this.hasConnectedIntegrations(context)) {
						state.counter--;
						continue;
					}
				}

				assertsTypeStepState(state);
				const result = yield* this.pickIssueStep(state, context, opened);
				opened = true;
				if (result === StepResultBreak) continue;
				if (!isStartWorkTypeItem(result)) {
					state.item = result;
					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							'startWork/issue/chosen',
							{
								...context.telemetryContext!,
								...buildItemTelemetryData(result),
								connected: true,
								type: state.type,
							},
							this.source,
						);
					}
				} else {
					state.type = result.type;
				}
			}

			const issue = state.item?.item?.issue;
			const repo = issue && (await this.getIssueRepositoryIfExists(issue));

			const result = yield* getSteps(
				this.container,
				{
					command: 'branch',
					state: {
						subcommand: 'create',
						repo: repo,
						name: issue ? `${slug(issue.id, { lower: false })}-${slug(issue.title)}` : undefined,
						suggestNameOnly: true,
						suggestRepoOnly: true,
						confirmOptions: ['--switch', '--worktree'],
					},
				},
				this.pickedVia,
			);
			if (result === StepResultBreak) {
				endSteps(state);
			} else {
				state.counter--;
			}
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *selectTypeStep(state: StepState<State>): StepResultGenerator<{ type: StartWorkType }> {
		const step = createPickStep({
			placeholder: 'Choose how to start work',
			items: [
				createQuickPickItemOfT<StartWorkTypeItem>(
					{
						label: 'Create Branch from Issue...',
						detail: 'Will create a new branch after selecting an issue',
					},
					{ type: 'issue' },
				),
				createQuickPickItemOfT<StartWorkTypeItem>(
					{ label: 'Create Branch...', detail: 'Will create a new branch after selecting a reference' },
					{
						type: 'branch',
					},
				),
			],
		});
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async getIssueRepositoryIfExists(issue: IssueShape | Issue): Promise<Repository | undefined> {
		try {
			return await getOrOpenIssueRepository(this.container, issue);
		} catch {
			return undefined;
		}
	}

	private async *confirmLocalIntegrationConnectStep(
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationId; resume: () => void }> {
		const confirmations: (QuickPickItemOfT<IntegrationId> | DirectiveQuickPickItem)[] = [];

		for (const integration of supportedStartWorkIntegrations) {
			if (context.connectedIntegrations.get(integration)) {
				continue;
			}
			switch (integration) {
				case HostingIntegrationId.GitHub:
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Connect to GitHub...',
								detail: 'Will connect to GitHub to provide access your pull requests and issues',
							},
							integration,
						),
					);
					break;
				default:
					break;
			}
		}

		const step = this.createConfirmStep(
			`${this.title} \u00a0\u2022\u00a0 Connect an Integration`,
			confirmations,
			createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
			{
				placeholder: 'Connect an integration to view their issues in Start Work',
				buttons: [],
				ignoreFocusOut: false,
			},
		);

		// Note: This is a hack to allow the quickpick to stay alive after the user finishes connecting the integration.
		// Otherwise it disappears.
		let freeze!: () => Disposable;
		step.onDidActivate = qp => {
			freeze = () => freezeStep(step, qp);
		};

		const selection: StepSelection<typeof step> = yield step;
		if (canPickStepContinue(step, state, selection)) {
			const resume = freeze();
			const chosenIntegrationId = selection[0].item;
			const connected = await this.ensureIntegrationConnected(chosenIntegrationId);
			return { connected: connected ? chosenIntegrationId : false, resume: () => resume[Symbol.dispose]() };
		}

		return StepResultBreak;
	}

	private async ensureIntegrationConnected(id: IntegrationId) {
		const integration = await this.container.integrations.get(id);
		let connected = integration.maybeConnected ?? (await integration.isConnected());
		if (!connected) {
			connected = await integration.connect('startWork');
		}

		return connected;
	}

	private async *confirmCloudIntegrationsConnectStep(
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationId; resume: () => void }> {
		// TODO: This step is almost an exact copy of the similar one from launchpad.ts. Do we want to do anything about it? Maybe to move it to an util function with ability to parameterize labels?
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		const step = this.createConfirmStep(
			`${this.title} \u00a0\u2022\u00a0 Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration`,
			[
				createQuickPickItemOfT(
					{
						label: `Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration...`,
						detail: hasConnectedIntegration
							? 'Connect additional integrations to view their issues in Start Work'
							: 'Connect an integration to accelerate your work',
						picked: true,
					},
					true,
				),
			],
			createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
			{
				placeholder: hasConnectedIntegration
					? 'Connect additional integrations to Start Work'
					: 'Connect an integration to get started with Start Work',
				buttons: [],
				ignoreFocusOut: true,
			},
		);

		// Note: This is a hack to allow the quickpick to stay alive after the user finishes connecting the integration.
		// Otherwise it disappears.
		let freeze!: () => Disposable;
		let quickpick!: QuickPick<any>;
		step.onDidActivate = qp => {
			quickpick = qp;
			freeze = () => freezeStep(step, qp);
		};

		const selection: StepSelection<typeof step> = yield step;

		if (canPickStepContinue(step, state, selection)) {
			const previousPlaceholder = quickpick.placeholder;
			quickpick.placeholder = 'Connecting integrations...';
			quickpick.ignoreFocusOut = true;
			const resume = freeze();
			const connected = await this.container.integrations.connectCloudIntegrations(
				{ integrationIds: supportedStartWorkIntegrations },
				{
					source: 'startWork',
				},
			);
			quickpick.placeholder = previousPlaceholder;
			return { connected: connected, resume: () => resume[Symbol.dispose]() };
		}

		return StepResultBreak;
	}

	private *pickIssueStep(
		state: StepState<StateWithType>,
		context: Context,
		opened: boolean,
	): StepResultGenerator<StartWorkItem | StartWorkTypeItem> {
		const buildIssueItem = (i: StartWorkItem) => {
			const onWebbButton = i.item.issue.url ? getOpenOnWebQuickInputButton(i.item.issue.provider.id) : undefined;
			const buttons = onWebbButton ? [onWebbButton] : [];
			const hoverContent = i.item.issue.body ? `${repeatSpaces(200)}\n\n${i.item.issue.body}` : '';
			return {
				label:
					i.item.issue.title.length > 60 ? `${i.item.issue.title.substring(0, 60)}...` : i.item.issue.title,
				// description: `${i.repoAndOwner}#${i.id}, by @${i.author}`,
				description: `\u00a0 ${
					i.item.issue.repository ? `${i.item.issue.repository.owner}/${i.item.issue.repository.repo}#` : ''
				}${i.item.issue.id} \u00a0`,
				// The spacing here at the beginning is used to align the description with the title. Otherwise it starts under the avatar icon:
				detail: `      ${fromNow(i.item.issue.updatedDate)} by @${i.item.issue.author.name}${hoverContent}`,
				iconPath: i.item.issue.author?.avatarUrl != null ? Uri.parse(i.item.issue.author.avatarUrl) : undefined,
				item: i,
				picked: i.item.issue.id === state.item?.item?.issue.id,
				buttons: buttons,
			};
		};

		const getItems = (result: StartWorkResult) => {
			const items: QuickPickItemOfT<StartWorkItem>[] = [];

			if (result.items?.length) {
				items.push(...result.items.map(buildIssueItem));
			}

			return items;
		};

		function getItemsAndPlaceholder(): {
			placeholder: string;
			items: QuickPickItemOfT<StartWorkItem | StartWorkTypeItem>[];
		} {
			if (!context.result.items.length) {
				return {
					placeholder: 'No issues found. Start work anyway.',
					items: [createQuickPickItemOfT<StartWorkTypeItem>('Create a branch', { type: 'branch' })],
				};
			}

			return {
				placeholder: 'Choose an item to focus on',
				items: getItems(context.result),
			};
		}

		const updateItems = async (quickpick: QuickPick<any>) => {
			quickpick.busy = true;
			try {
				await updateContextItems(this.container, context);
				const { items, placeholder } = getItemsAndPlaceholder();
				quickpick.placeholder = placeholder;
				quickpick.items = items;

				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						opened ? 'startWork/steps/issue' : 'startWork/opened',
						{
							...context.telemetryContext!,
							connected: true,
							type: state.type,
						},
						this.source,
					);
				}
			} catch {
				quickpick.placeholder = 'Error retrieving issues';
				quickpick.items = [];
			} finally {
				quickpick.busy = false;
			}
		};

		const step = createPickStep<QuickPickItemOfT<StartWorkItem | StartWorkTypeItem>>({
			title: context.title,
			placeholder: 'Loading...',
			matchOnDescription: true,
			matchOnDetail: true,
			items: [],
			onDidActivate: updateItems,
			onDidClickItemButton: (_quickpick, button, { item }) => {
				if (isStartWorkTypeItem(item)) {
					return false;
				}

				switch (button) {
					case OpenOnGitHubQuickInputButton:
					case OpenOnJiraQuickInputButton:
						this.sendItemActionTelemetry('soft-open', item, state, context);
						this.open(item);
						return undefined;
					default:
						return false;
				}
			},
			onDidChangeValue: () => true,
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) {
			return StepResultBreak;
		}
		const element = selection[0];
		return typeof element.item === 'string' ? element.item : { ...element.item };
	}

	private open(item: StartWorkItem): void {
		if (item.item.issue.url == null) return;
		void openUrl(item.item.issue.url);
	}

	private sendItemActionTelemetry(
		action: 'soft-open',
		item: StartWorkItem,
		state: StepState<StateWithType>,
		context: Context,
	) {
		this.container.telemetry.sendEvent('startWork/issue/action', {
			...context.telemetryContext!,
			...buildItemTelemetryData(item),
			action: action,
			connected: true,
			type: state.type,
		});
	}

	private async getConnectedIntegrations(): Promise<Map<SupportedStartWorkIntegrationIds, boolean>> {
		const connected = new Map<SupportedStartWorkIntegrationIds, boolean>();
		await Promise.allSettled(
			supportedStartWorkIntegrations.map(async integrationId => {
				const integration = await this.container.integrations.get(integrationId);
				const isConnected = integration.maybeConnected ?? (await integration.isConnected());
				const hasAccess = isConnected && (await integration.access());
				connected.set(integrationId, hasAccess);
			}),
		);

		return connected;
	}

	private hasConnectedIntegrations(context: Context) {
		return [...context.connectedIntegrations.values()].some(c => c);
	}
}

async function updateContextItems(container: Container, context: Context) {
	const connectedIntegrationsMap = context.connectedIntegrations;
	const connectedIntegrations = [...connectedIntegrationsMap.keys()].filter(integrationId =>
		Boolean(connectedIntegrationsMap.get(integrationId)),
	);
	context.result = {
		items:
			(await container.integrations.getMyIssues(connectedIntegrations, { openRepositoriesOnly: true }))?.map(
				i => ({
					item: i,
				}),
			) ?? [],
	};
	if (container.telemetry.enabled) {
		updateTelemetryContext(context);
	}
}

function updateTelemetryContext(context: Context) {
	context.telemetryContext = {
		...context.telemetryContext!,
		'items.count': context.result.items.length,
	};
}

function isStartWorkTypeItem(item: unknown): item is StartWorkTypeItem {
	return item != null && typeof item === 'object' && 'type' in item;
}

function repeatSpaces(count: number) {
	return ' '.repeat(count);
}

export function getStartWorkItemIdHash(item: StartWorkItem) {
	return md5(item.item.issue.id);
}

function buildItemTelemetryData(item: StartWorkItem) {
	return {
		'item.id': getStartWorkItemIdHash(item),
		'item.type': item.item.issue.type,
		'item.provider': item.item.issue.provider.id,
		'item.assignees.count': item.item.issue.assignees?.length ?? undefined,
		'item.createdDate': item.item.issue.createdDate.getTime(),
		'item.updatedDate': item.item.issue.updatedDate.getTime(),

		'item.comments.count': item.item.issue.commentsCount ?? undefined,
		'item.upvotes.count': item.item.issue.thumbsUpCount ?? undefined,

		'item.issue.state': item.item.issue.state,
	};
}

function getOpenOnWebQuickInputButton(integrationId: string): QuickInputButton | undefined {
	switch (integrationId) {
		case HostingIntegrationId.GitHub:
			return OpenOnGitHubQuickInputButton;
		case IssueIntegrationId.Jira:
			return OpenOnJiraQuickInputButton;
		default:
			return undefined;
	}
}

function assertsTypeStepState(state: StepState<State>): asserts state is StepState<StateWithType> {
	if (state.type != null) {
		return;
	}

	debugger;
	throw new Error('Missing `item` field in state of StartWork');
}
