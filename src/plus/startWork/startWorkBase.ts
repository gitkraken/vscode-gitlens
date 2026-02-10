import type { QuickInputButton, QuickPick } from 'vscode';
import { Uri, window } from 'vscode';
import { md5 } from '@env/crypto.js';
import type { ManageCloudIntegrationsCommandArgs } from '../../commands/cloudIntegrations.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../commands/quick-wizard/models/steps.quickpick.js';
import {
	ConnectIntegrationButton,
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
	OpenOnJiraQuickInputButton,
} from '../../commands/quick-wizard/quickButtons.js';
import { QuickCommand } from '../../commands/quick-wizard/quickCommand.js';
import { ensureAccessStep } from '../../commands/quick-wizard/steps/access.js';
import { StepsController } from '../../commands/quick-wizard/stepsController.js';
import { canPickStepContinue, createPickStep } from '../../commands/quick-wizard/utils/steps.utils.js';
import type { IntegrationIds } from '../../constants.integrations.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../constants.integrations.js';
import { proBadge } from '../../constants.js';
import type { Source, Sources, StartWorkTelemetryContext, TelemetryEvents } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { PlusFeatures } from '../../features.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { Issue, IssueShape } from '../../git/models/issue.js';
import type { Repository } from '../../git/models/repository.js';
import type { GitWorktree } from '../../git/models/worktree.js';
import { getOrOpenIssueRepository } from '../../git/utils/-webview/issue.utils.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickItemOfT } from '../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import { executeCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { getScopedCounter } from '../../system/counter.js';
import { fromNow } from '../../system/date.js';
import { some } from '../../system/iterable.js';
import type { Deferred } from '../../system/promise.js';
import type { ConnectMoreIntegrationsItem } from '../integrations/utils/-webview/integration.quickPicks.js';
import {
	isManageIntegrationsItem,
	manageIntegrationsItem,
} from '../integrations/utils/-webview/integration.quickPicks.js';

const instanceCounter = getScopedCounter();

const Steps = {
	ConnectIntegrations: 'startWork-connect-integrations',
	EnsureAccess: 'startWork-ensure-access',
	PickIssue: 'startWork-pick-issue',
} as const;

type StepNames = (typeof Steps)[keyof typeof Steps];

const supportedStartWorkIntegrations = [
	GitCloudHostIntegrationId.GitHub,
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitCloudHostIntegrationId.GitLab,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	GitCloudHostIntegrationId.AzureDevOps,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	GitCloudHostIntegrationId.Bitbucket,
	IssuesCloudHostIntegrationId.Jira,
	IssuesCloudHostIntegrationId.Linear,
];
type SupportedStartWorkIntegrationIds = (typeof supportedStartWorkIntegrations)[number];

const connectMoreIntegrationsItem: ConnectMoreIntegrationsItem = {
	label: 'Connect an Additional Integration...',
	detail: 'Connect additional integrations to view and start work on their issues',
	item: undefined,
};

export interface StartWorkContext extends StepsContext<StepNames> {
	result?: StartWorkResult;
	title: string;
	telemetryContext: StartWorkTelemetryContext | undefined;
	connectedIntegrations: Map<SupportedStartWorkIntegrationIds, boolean>;
}

interface StartWorkItem {
	issue: IssueShape;
}

interface StartWorkResult {
	items: StartWorkItem[];
}

export type StartWorkStepState<T extends StartWorkState = StartWorkState> = RequireSome<StepState<T>, 'item'>;
export function assertsStartWorkStepState(state: StepState<StartWorkState>): asserts state is StartWorkStepState {
	if (state.item != null) return;

	debugger;
	throw new Error('Missing item');
}
export interface StartWorkBaseCommandArgs {
	readonly command: 'startWork' | 'associateIssueWithBranch';
	source?: Sources;
}
export interface StartWorkOverrides {
	ownSource?: 'startWork' | 'associateIssueWithBranch';
	placeholders?: {
		localIntegrationConnect?: string;
		cloudIntegrationConnectHasConnected?: string;
		cloudIntegrationConnectNoConnected?: string;
		issueSelection?: string;
	};
}

interface StartWorkState {
	item?: StartWorkItem;
	issueUrl?: string;
	instructions?: string;
	useDefaults?: boolean;
	openChatOnComplete?: boolean;
	result?: Deferred<{ branch: GitBranch; worktree?: GitWorktree }>;
}

export abstract class StartWorkBaseCommand extends QuickCommand<StartWorkState> {
	protected abstract overrides?: StartWorkOverrides;

	private readonly source: Source;
	private readonly telemetryContext: StartWorkTelemetryContext | undefined;
	private readonly telemetryEventKey: 'startWork' | 'associateIssueWithBranch';

	constructor(
		container: Container,
		args?: StartWorkBaseCommandArgs,
		key: string = 'startWork',
		label: string = 'startWork',
		title: string = `Start Work\u00a0\u00a0${proBadge}`,
		description: string = 'Start work on an issue',
		telemetryEventKey: 'startWork' | 'associateIssueWithBranch' = 'startWork',
	) {
		super(container, key, label, title, {
			description: description,
		});

		this.telemetryEventKey = telemetryEventKey;
		this.source = { source: args?.source ?? 'commandPalette' };

		if (this.container.telemetry.enabled) {
			this.telemetryContext = { instance: instanceCounter.next() };
			this.container.telemetry.sendEvent(
				`${this.telemetryEventKey}/open`,
				{ ...this.telemetryContext },
				this.source,
			);
		}

		this.initialState = {};
	}

	protected override createContext(context?: StepsContext<any>): StartWorkContext {
		return {
			...context,
			container: this.container,
			result: undefined,
			title: this.title,
			telemetryContext: this.telemetryContext,
			connectedIntegrations: undefined!,
		};
	}

	protected async *steps(state: PartialStepState<StartWorkState>, context?: StartWorkContext): StepGenerator {
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		context ??= this.createContext();
		context.connectedIntegrations = await getConnectedIntegrations(this.container);

		using steps = new StepsController<StepNames>(context, this);

		let opened = false;
		try {
			while (!steps.isComplete) {
				context.title = this.title;
				const hasConnectedIntegrations = [...context.connectedIntegrations.values()].some(c => c);

				if (steps.isAtStep(Steps.ConnectIntegrations) || !hasConnectedIntegrations) {
					using step = steps.enterStep(Steps.ConnectIntegrations);

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							opened ? `${this.telemetryEventKey}/steps/connect` : `${this.telemetryEventKey}/opened`,
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
						if (step.goBack() == null) break;
						continue;
					}

					result.resume();

					const connected = result.connected;
					if (!connected) continue;
				}

				let plusFeature: PlusFeatures | undefined;
				if (this.key === 'startWork') {
					plusFeature = 'startWork';
				} else if (this.key === 'associateIssueWithBranch') {
					plusFeature = 'associateIssueWithBranch';
				}

				if (plusFeature != null && steps.isAtStepOrUnset(Steps.EnsureAccess)) {
					using step = steps.enterStep(Steps.EnsureAccess);

					const result = yield* ensureAccessStep(this.container, plusFeature, state, context, step);
					if (result === StepResultBreak) {
						if (step.goBack() == null) break;
						continue;
					}
				}

				if (steps.isAtStepOrUnset(Steps.PickIssue) || state.item == null) {
					using step = steps.enterStep(Steps.PickIssue);

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							opened ? `${this.telemetryEventKey}/steps/issue` : `${this.telemetryEventKey}/opened`,
							{
								...context.telemetryContext!,
								connected: true,
							},
							this.source,
						);
					}

					opened = true;

					let preSelecteditem: StartWorkItem | undefined = undefined;
					// Auto-select issue if issueUrl is provided
					if (state.issueUrl) {
						if (context.result == null) {
							await updateContextItems(this.container, context);
						}
						preSelecteditem = context.result?.items.find(item => item.issue.url === state.issueUrl);

						// If issue not found, show error and fall through to picker
						if (preSelecteditem == null) {
							void window.showErrorMessage(
								`Issue not found: ${state.issueUrl}. Please select an issue manually.`,
							);
						}
					}

					const result = preSelecteditem ?? (yield* this.pickStartWorkIssueStep(state, context));
					if (result === StepResultBreak) {
						state.item = undefined;
						if (step.goBack() == null) break;
						continue;
					}

					state.item = result;

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent(
							`${this.telemetryEventKey}/issue/chosen`,
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

				if (this.continuation) {
					yield* this.continuation(state, context);
				}

				steps.markStepsComplete();
			}
		} finally {
			if (state.result?.pending) {
				state.result.cancel(new Error('Start Work cancelled'));
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	protected abstract continuation?(state: StartWorkStepState, context: StartWorkContext): StepGenerator;

	protected async getIssueRepositoryIfExists(issue: IssueShape | Issue): Promise<Repository | undefined> {
		try {
			return await getOrOpenIssueRepository(this.container, issue);
		} catch {
			return undefined;
		}
	}

	private async *confirmLocalIntegrationConnectStep(
		state: StepState<StartWorkState>,
		context: StartWorkContext,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
		context.result = undefined;
		const confirmations: (QuickPickItemOfT<IntegrationIds> | DirectiveQuickPickItem)[] = [];

		for (const integration of supportedStartWorkIntegrations) {
			if (context.connectedIntegrations.get(integration)) {
				continue;
			}
			switch (integration) {
				case GitCloudHostIntegrationId.GitHub:
					confirmations.push(
						createQuickPickItemOfT(
							{
								label: 'Connect to GitHub...',
								detail: 'Will connect to GitHub to provide access to your pull requests and issues',
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
				placeholder:
					this.overrides?.placeholders?.localIntegrationConnect ??
					'Connect an integration to view its issues in Start Work',
				buttons: [],
				ignoreFocusOut: false,
			},
		);

		const selection: StepSelection<typeof step> = yield step;
		if (canPickStepContinue(step, state, selection)) {
			const resume = step.freeze?.();
			const chosenIntegrationId = selection[0].item;
			const connected = await this.ensureIntegrationConnected(chosenIntegrationId);
			return { connected: connected ? chosenIntegrationId : false, resume: () => resume?.dispose() };
		}

		return StepResultBreak;
	}

	private async ensureIntegrationConnected(id: IntegrationIds) {
		const integration = await this.container.integrations.get(id);
		if (integration == null) return false;

		let connected = integration.maybeConnected ?? (await integration.isConnected());
		if (!connected) {
			connected = await integration.connect(this.overrides?.ownSource ?? 'startWork');
		}

		return connected;
	}

	private async *confirmCloudIntegrationsConnectStep(
		state: StepState<StartWorkState>,
		context: StartWorkContext,
		overrideStep?: QuickPickStep<QuickPickItemOfT<StartWorkItem>>,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
		// TODO: This step is almost an exact copy of the similar one from launchpad.js. Do we want to do anything about it? Maybe to move it to an util function with ability to parameterize labels?
		const hasConnectedIntegration = some(context.connectedIntegrations.values(), c => c);
		context.result = undefined;
		let step;
		let selection;
		if (overrideStep == null) {
			step = this.createConfirmStep(
				`${this.title} \u00a0\u2022\u00a0 Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration`,
				[
					createQuickPickItemOfT(
						{
							label: `Connect an ${hasConnectedIntegration ? 'Additional ' : ''}Integration...`,
							detail: hasConnectedIntegration
								? 'Connect additional integrations to view their issues'
								: 'Connect an integration to accelerate your work',
							picked: true,
						},
						true,
					),
				],
				createDirectiveQuickPickItem(Directive.Cancel, false, { label: 'Cancel' }),
				{
					placeholder: hasConnectedIntegration
						? (this.overrides?.placeholders?.cloudIntegrationConnectHasConnected ??
							'Connect additional integrations to Start Work')
						: (this.overrides?.placeholders?.cloudIntegrationConnectNoConnected ??
							'Connect an integration to get started with Start Work'),
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
					source: this.overrides?.ownSource ?? 'startWork',
				},
			);
			if (step.quickpick) {
				step.quickpick.placeholder = previousPlaceholder;
			}
			return { connected: connected, resume: () => resume?.dispose() };
		}

		return StepResultBreak;
	}

	private async *pickStartWorkIssueStep(
		state: StepState<StartWorkState>,
		context: StartWorkContext,
	): AsyncStepResultGenerator<StartWorkItem> {
		const hasDisconnectedIntegrations = [...context.connectedIntegrations.values()].some(c => !c);

		const buildStartWorkQuickPickItem = (i: StartWorkItem) => {
			const onWebButton = i.issue.url ? getOpenOnWebQuickInputButton(i.issue.provider.id) : undefined;
			const buttons = onWebButton ? [onWebButton] : [];
			const hoverContent = i.issue.body ? `${repeatSpaces(200)}\n\n${i.issue.body}` : '';
			return {
				label: i.issue.title.length > 60 ? `${i.issue.title.substring(0, 60)}...` : i.issue.title,
				description: `\u00a0 ${i.issue.repository ? `${i.issue.repository.owner}/${i.issue.repository.repo}#` : ''}${i.issue.id} \u00a0`,
				// The spacing here at the beginning is used to align the description with the title. Otherwise it starts under the avatar icon:
				detail: `      ${fromNow(i.issue.updatedDate)} by @${i.issue.author.name}${hoverContent}`,
				iconPath: i.issue.author?.avatarUrl != null ? Uri.parse(i.issue.author.avatarUrl) : undefined,
				item: i,
				picked: i.issue.id === state.item?.issue.id,
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

		function getItemsAndPlaceholder(placeholderOverride?: string): {
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
				placeholder: placeholderOverride ?? 'Choose an issue to start working on',
				items: [...getItems(context.result), createDirectiveQuickPickItem(Directive.Cancel)],
			};
		}

		const updateItems = async (quickpick: QuickPick<any>) => {
			quickpick.busy = true;
			try {
				await updateContextItems(this.container, context);
				const { items, placeholder } = getItemsAndPlaceholder(this.overrides?.placeholders?.issueSelection);
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
					case OpenOnAzureDevOpsQuickInputButton:
					case OpenOnBitbucketQuickInputButton:
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
			executeCommand<ManageCloudIntegrationsCommandArgs>('gitlens.plus.cloudIntegrations.manage', {
				source: { source: this.overrides?.ownSource ?? 'startWork' },
			});
			return StepResultBreak;
		}

		return { ...element.item };
	}

	private open(item: StartWorkItem): void {
		if (item.issue.url == null) return;
		void openUrl(item.issue.url);
	}

	private sendItemActionTelemetry(action: 'soft-open', item: StartWorkItem, context: StartWorkContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/issue/action`,
			{
				...context.telemetryContext!,
				...buildItemTelemetryData(item),
				action: action,
				connected: true,
			},
			this.source,
		);
	}

	private sendTitleActionTelemetry(
		action: TelemetryEvents['startWork/title/action']['action'],
		context: StartWorkContext,
	) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/title/action`,
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}

	private sendActionTelemetry(action: TelemetryEvents['startWork/action']['action'], context: StartWorkContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/action`,
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}
}

function buildItemTelemetryData(item: StartWorkItem) {
	return {
		'item.id': getStartWorkItemIdHash(item),
		'item.type': item.issue.type,
		'item.provider': item.issue.provider.id,
		'item.assignees.count': item.issue.assignees?.length ?? undefined,
		'item.createdDate': item.issue.createdDate.getTime(),
		'item.updatedDate': item.issue.updatedDate.getTime(),

		'item.comments.count': item.issue.commentsCount ?? undefined,
		'item.upvotes.count': item.issue.thumbsUpCount ?? undefined,

		'item.issue.state': item.issue.state,
	};
}

export async function getConnectedIntegrations(
	container: Container,
): Promise<Map<SupportedStartWorkIntegrationIds, boolean>> {
	const connected = new Map<SupportedStartWorkIntegrationIds, boolean>();
	await Promise.allSettled(
		supportedStartWorkIntegrations.map(async integrationId => {
			const integration = await container.integrations.get(integrationId);
			if (integration == null) {
				connected.set(integrationId, false);
				return;
			}
			const isConnected = integration.maybeConnected ?? (await integration.isConnected());
			const hasAccess = isConnected && (await integration.access());
			connected.set(integrationId, hasAccess);
		}),
	);

	return connected;
}

function getOpenOnWebQuickInputButton(integrationId: string): QuickInputButton | undefined {
	switch (integrationId) {
		case GitCloudHostIntegrationId.AzureDevOps:
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return OpenOnAzureDevOpsQuickInputButton;
		case GitCloudHostIntegrationId.Bitbucket:
			return OpenOnBitbucketQuickInputButton;
		case GitCloudHostIntegrationId.GitHub:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return OpenOnGitHubQuickInputButton;
		case GitCloudHostIntegrationId.GitLab:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return OpenOnGitLabQuickInputButton;
		case IssuesCloudHostIntegrationId.Jira:
			return OpenOnJiraQuickInputButton;
		default:
			return undefined;
	}
}
function getStartWorkItemIdHash(item: StartWorkItem): string {
	return md5(item.issue.id);
}

function isConnectMoreIntegrationsItem(item: unknown): item is ConnectMoreIntegrationsItem {
	return item === connectMoreIntegrationsItem;
}

function repeatSpaces(count: number) {
	return ' '.repeat(count);
}

async function updateContextItems(container: Container, context: StartWorkContext) {
	context.connectedIntegrations = await getConnectedIntegrations(container);
	const connectedIntegrations = [...context.connectedIntegrations.keys()].filter(integrationId =>
		Boolean(context.connectedIntegrations.get(integrationId)),
	);
	context.result ??= {
		items:
			(await container.integrations.getMyIssues(connectedIntegrations, { openRepositoriesOnly: true }))?.map(
				i => ({
					issue: i,
				}),
			) ?? [],
	};
	if (container.telemetry.enabled) {
		updateTelemetryContext(context);
	}
}

function updateTelemetryContext(context: StartWorkContext) {
	context.telemetryContext = {
		...context.telemetryContext!,
		'items.count': context.result?.items.length ?? 0,
	};
}
