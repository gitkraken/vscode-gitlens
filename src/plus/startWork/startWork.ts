import { md5 } from '@env/crypto';
import slug from 'slug';
import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { Uri } from 'vscode';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
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
import {
	ConnectIntegrationButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
	OpenOnJiraQuickInputButton,
} from '../../commands/quickCommand.buttons';
import { getSteps } from '../../commands/quickWizard.utils';
import { proBadge } from '../../constants';
import { Commands } from '../../constants.commands';
import type { IntegrationId } from '../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId } from '../../constants.integrations';
import type { Source, Sources, StartWorkTelemetryContext, TelemetryEvents } from '../../constants.telemetry';
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
import { executeCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import { openUrl } from '../../system/vscode/utils';

export type StartWorkItem = {
	item: SearchedIssue;
};

export type StartWorkResult = { items: StartWorkItem[] };

interface Context {
	result?: StartWorkResult;
	title: string;
	telemetryContext: StartWorkTelemetryContext | undefined;
	connectedIntegrations: Map<SupportedStartWorkIntegrationIds, boolean>;
}

interface State {
	item?: StartWorkItem;
}

type StartWorkStepState<T extends State = State> = RequireSome<StepState<T>, 'item'>;

function assertsStartWorkStepState(state: StepState<State>): asserts state is StartWorkStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
	source?: Sources;
}

export const supportedStartWorkIntegrations = [
	HostingIntegrationId.GitHub,
	HostingIntegrationId.GitLab,
	IssueIntegrationId.Jira,
];
export type SupportedStartWorkIntegrationIds = (typeof supportedStartWorkIntegrations)[number];
const instanceCounter = getScopedCounter();

type ConnectMoreIntegrationsItem = QuickPickItem & {
	item: undefined;
};

type ManageIntegrationsItem = QuickPickItem & {
	item: undefined;
};

const connectMoreIntegrationsItem: ConnectMoreIntegrationsItem = {
	label: 'Connect an Additional Integration...',
	detail: 'Connect additional integrations to view and start work on their issues',
	item: undefined,
};

const manageIntegrationsItem: ManageIntegrationsItem = {
	label: 'Manage integrations...',
	detail: 'Manage your connected integrations',
	item: undefined,
};

function isConnectMoreIntegrationsItem(item: unknown): item is ConnectMoreIntegrationsItem {
	return item === connectMoreIntegrationsItem;
}

function isManageIntegrationsItem(item: unknown): item is ManageIntegrationsItem {
	return item === manageIntegrationsItem;
}

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
			counter: 0,
		};
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		const context: Context = {
			result: undefined,
			title: this.title,
			telemetryContext: this.telemetryContext,
			connectedIntegrations: await getConnectedIntegrations(this.container),
		};

		let opened = false;
		while (this.canStepsContinue(state)) {
			context.title = this.title;
			const hasConnectedIntegrations = [...context.connectedIntegrations.values()].some(c => c);

			if (!hasConnectedIntegrations) {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						opened ? 'startWork/steps/connect' : 'startWork/opened',
						{
							...context.telemetryContext!,
							connected: false,
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

				result.resume();

				const connected = result.connected;
				if (!connected) {
					continue;
				}
			}

			if (state.counter < 1 || state.item == null) {
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						opened ? 'startWork/steps/issue' : 'startWork/opened',
						{
							...context.telemetryContext!,
							connected: true,
						},
						this.source,
					);
				}

				opened = true;

				const result = yield* this.pickStartWorkIssueStep(state, context);
				if (result === StepResultBreak) continue;
				state.item = result;
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						'startWork/issue/chosen',
						{
							...context.telemetryContext!,
							...buildItemTelemetryData(result),
							connected: true,
						},
						this.source,
					);
				}
			}

			assertsStartWorkStepState(state);

			const issue = state.item.item.issue;
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
			if (result !== StepResultBreak) {
				state.counter = 0;
				continue;
			}

			endSteps(state);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
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
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationId; resume: () => void | undefined }> {
		context.result = undefined;
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

		const selection: StepSelection<typeof step> = yield step;
		if (canPickStepContinue(step, state, selection)) {
			const resume = step.freeze?.();
			const chosenIntegrationId = selection[0].item;
			const connected = await this.ensureIntegrationConnected(chosenIntegrationId);
			return { connected: connected ? chosenIntegrationId : false, resume: () => resume?.[Symbol.dispose]() };
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
		overrideStep?: QuickPickStep<QuickPickItemOfT<StartWorkItem>>,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationId; resume: () => void | undefined }> {
		// TODO: This step is almost an exact copy of the similar one from launchpad.ts. Do we want to do anything about it? Maybe to move it to an util function with ability to parameterize labels?
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		context.result = undefined;
		let step;
		let selection;
		if (overrideStep == null) {
			step = this.createConfirmStep(
				`${this.title} \u00a0\u2022\u00a0 Connect an ${
					hasConnectedIntegration ? 'Additional ' : ''
				}Integration`,
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

			selection = yield step;
		} else {
			step = overrideStep;
			selection = [true];
		}

		if (canPickStepContinue(step, state, selection)) {
			let previousPlaceholder: string | undefined;
			if (step.quickpick) {
				previousPlaceholder = step.quickpick.placeholder;
				step.quickpick.placeholder = 'Connecting integrations...';
			}
			const resume = step.freeze?.();
			const connected = await this.container.integrations.connectCloudIntegrations(
				{ integrationIds: supportedStartWorkIntegrations },
				{
					source: 'startWork',
				},
			);
			if (step.quickpick) {
				step.quickpick.placeholder = previousPlaceholder;
			}
			return { connected: connected, resume: () => resume?.[Symbol.dispose]() };
		}

		return StepResultBreak;
	}

	private async *pickStartWorkIssueStep(
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<StartWorkItem> {
		const hasDisconnectedIntegrations = [...context.connectedIntegrations.values()].some(c => !c);

		const buildStartWorkQuickPickItem = (i: StartWorkItem) => {
			const onWebButton = i.item.issue.url ? getOpenOnWebQuickInputButton(i.item.issue.provider.id) : undefined;
			const buttons = onWebButton ? [onWebButton] : [];
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
				items.push(...result.items.map(buildStartWorkQuickPickItem));
			}

			return items;
		};

		function getItemsAndPlaceholder(): {
			placeholder: string;
			items: (DirectiveQuickPickItem | QuickPickItemOfT<StartWorkItem | undefined>)[];
		} {
			if (!context.result?.items.length) {
				return {
					placeholder: 'No issues found for your open repositories.',
					items: [
						hasDisconnectedIntegrations ? connectMoreIntegrationsItem : manageIntegrationsItem,
						createDirectiveQuickPickItem(Directive.Cancel),
					],
				};
			}

			return {
				placeholder: 'Choose an issue to start working on',
				items: [...getItems(context.result), createDirectiveQuickPickItem(Directive.Cancel)],
			};
		}

		const updateItems = async (quickpick: QuickPick<any>) => {
			quickpick.busy = true;
			try {
				await updateContextItems(this.container, context);
				const { items, placeholder } = getItemsAndPlaceholder();
				quickpick.placeholder = placeholder;
				quickpick.items = items;
			} catch {
				quickpick.placeholder = 'Error retrieving issues';
				quickpick.items = [createDirectiveQuickPickItem(Directive.Cancel)];
			} finally {
				quickpick.busy = false;
			}
		};

		const step = createPickStep<QuickPickItemOfT<StartWorkItem>>({
			title: context.title,
			placeholder: 'Loading...',
			matchOnDescription: true,
			matchOnDetail: true,
			items: [],
			buttons: [...(hasDisconnectedIntegrations ? [ConnectIntegrationButton] : [])],
			onDidActivate: updateItems,
			onDidClickButton: async (_quickpick, button) => {
				switch (button) {
					case ConnectIntegrationButton:
						this.sendTitleActionTelemetry('connect', context);
						return this.next([connectMoreIntegrationsItem]);
				}
				return undefined;
			},
			onDidClickItemButton: (_quickpick, button, { item }) => {
				switch (button) {
					case OpenOnGitHubQuickInputButton:
					case OpenOnGitLabQuickInputButton:
					case OpenOnJiraQuickInputButton:
						this.sendItemActionTelemetry('soft-open', item, context);
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
		if (isConnectMoreIntegrationsItem(element)) {
			this.sendTitleActionTelemetry('connect', context);
			const isUsingCloudIntegrations = configuration.get('cloudIntegrations.enabled', undefined, false);
			const result = isUsingCloudIntegrations
				? yield* this.confirmCloudIntegrationsConnectStep(state, context, step)
				: yield* this.confirmLocalIntegrationConnectStep(state, context);
			if (result === StepResultBreak) return result;

			result.resume();
			return StepResultBreak;
		} else if (isManageIntegrationsItem(element)) {
			this.sendActionTelemetry('manage', context);
			executeCommand(Commands.PlusManageCloudIntegrations, { source: 'startWork' });
			endSteps(state);
			return StepResultBreak;
		}

		return { ...element.item };
	}

	private open(item: StartWorkItem): void {
		if (item.item.issue.url == null) return;
		void openUrl(item.item.issue.url);
	}

	private sendItemActionTelemetry(action: 'soft-open', item: StartWorkItem, context: Context) {
		this.container.telemetry.sendEvent('startWork/issue/action', {
			...context.telemetryContext!,
			...buildItemTelemetryData(item),
			action: action,
			connected: true,
		});
	}

	private sendTitleActionTelemetry(action: TelemetryEvents['startWork/title/action']['action'], context: Context) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			'startWork/title/action',
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}

	private sendActionTelemetry(action: TelemetryEvents['startWork/action']['action'], context: Context) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			'startWork/action',
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}
}

async function updateContextItems(container: Container, context: Context) {
	context.connectedIntegrations = await getConnectedIntegrations(container);
	const connectedIntegrations = [...context.connectedIntegrations.keys()].filter(integrationId =>
		Boolean(context.connectedIntegrations.get(integrationId)),
	);
	context.result ??= {
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
		'items.count': context.result?.items.length ?? 0,
	};
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
		case HostingIntegrationId.GitLab:
			return OpenOnGitLabQuickInputButton;
		case IssueIntegrationId.Jira:
			return OpenOnJiraQuickInputButton;
		default:
			return undefined;
	}
}

async function getConnectedIntegrations(container: Container): Promise<Map<SupportedStartWorkIntegrationIds, boolean>> {
	const connected = new Map<SupportedStartWorkIntegrationIds, boolean>();
	await Promise.allSettled(
		supportedStartWorkIntegrations.map(async integrationId => {
			const integration = await container.integrations.get(integrationId);
			const isConnected = integration.maybeConnected ?? (await integration.isConnected());
			const hasAccess = isConnected && (await integration.access());
			connected.set(integrationId, hasAccess);
		}),
	);

	return connected;
}
