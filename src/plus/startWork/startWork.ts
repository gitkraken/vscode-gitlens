import slug from 'slug';
import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { Uri } from 'vscode';
import { md5 } from '@env/crypto';
import type { ManageCloudIntegrationsCommandArgs } from '../../commands/cloudIntegrations';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
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
import {
	ConnectIntegrationButton,
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
	OpenOnJiraQuickInputButton,
} from '../../commands/quickCommand.buttons';
import { ensureAccessStep } from '../../commands/quickCommand.steps';
import { getSteps } from '../../commands/quickWizard.utils';
import { proBadge } from '../../constants';
import type { IntegrationIds } from '../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../constants.integrations';
import type { Source, Sources, StartWorkTelemetryContext, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { PlusFeatures } from '../../features';
import type { Issue, IssueShape } from '../../git/models/issue';
import type { GitBranchReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { addAssociatedIssueToBranch } from '../../git/utils/-webview/branch.issue.utils';
import { getOrOpenIssueRepository } from '../../git/utils/-webview/issue.utils';
import { showBranchPicker } from '../../quickpicks/branchPicker';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickItemOfT } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import { executeCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { openUrl } from '../../system/-webview/vscode/uris';
import { getScopedCounter } from '../../system/counter';
import { fromNow } from '../../system/date';
import { some } from '../../system/iterable';
import type { ChatAction, ChatIssueContext } from '../chat/models/chat';
import { supportsChat } from '../chat/utils/-webview/chat.utils';
import { getIssueOwner } from '../integrations/providers/utils';

export type StartWorkItem = {
	issue: IssueShape;
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
	chatAction?: 'create-branch' | 'create-worktree' | 'explain-issue';
}

type StartWorkStepState<T extends State = State> = RequireSome<StepState<T>, 'item'>;

function assertsStartWorkStepState(state: StepState<State>): asserts state is StartWorkStepState {
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

export const supportedStartWorkIntegrations = [
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

export abstract class StartWorkBaseCommand extends QuickCommand<State> {
	private readonly source: Source;
	private readonly telemetryContext: StartWorkTelemetryContext | undefined;
	private readonly telemetryEventKey: 'startWork' | 'associateIssueWithBranch';
	protected abstract overrides?: StartWorkOverrides;

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
					return result;
				}

				result.resume();

				const connected = result.connected;
				if (!connected) {
					continue;
				}
			}

			let plusFeature: PlusFeatures | undefined;
			if (this.key === 'startWork') {
				plusFeature = 'startWork';
			} else if (this.key === 'associateIssueWithBranch') {
				plusFeature = 'associateIssueWithBranch';
			}

			if (plusFeature != null) {
				const result = yield* ensureAccessStep(this.container, state, context, plusFeature);
				if (result === StepResultBreak) continue;
			}

			if (state.counter < 1 || state.item == null) {
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

				const result = yield* this.pickStartWorkIssueStep(state, context);
				if (result === StepResultBreak) continue;
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

			// Add chat integration step after issue selection
			if ((await supportsChat()) && (state.counter < 2 || state.chatAction == null)) {
				const result = yield* this.pickChatActionStep(state, context);
				if (result === StepResultBreak) continue;
				state.chatAction = result;

				// If user chose "Send to AI Chat", send the prompt and end the flow
				if (result === 'explain-issue') {
					await this.sendIssueToChatWithAction(state.item, 'explain-issue');
					endSteps(state);
					break;
				}
				// For "Create Worktree & Chat", the chat prompt will be sent when the new worktree window opens
				// (handled by checkPendingWorktreeChat in extension.ts)
			}

			if (this.continuation) {
				yield* this.continuation(state, context);
			}

			endSteps(state);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	protected abstract continuation?(state: StartWorkStepState, context: Context): StepGenerator;

	protected async getIssueRepositoryIfExists(issue: IssueShape | Issue): Promise<Repository | undefined> {
		try {
			return await getOrOpenIssueRepository(this.container, issue);
		} catch {
			return undefined;
		}
	}

	private *pickChatActionStep(
		state: StepState<State>,
		context: Context,
	): StepResultGenerator<'create-branch' | 'create-worktree' | 'explain-issue' | undefined> {
		const aiChat = {
			label: '$(comment-discussion) Send to AI Chat',
			description: 'Get AI assistance with this issue',
			detail: 'Open AI Chat with contextual prompts and MCP tool integration',
			picked: true,
		};

		const branchAndAiChat = {
			label: '$(git-branch) Create Branch & Chat',
			description: 'Create a branch and get AI guidance',
			detail: 'Create a new branch and send contextual prompt to AI Chat',
		};

		const createWorktreeAndAiChat = {
			label: '$(folder-opened) Create Worktree & Chat',
			description: 'Create a worktree and get AI guidance',
			detail: 'Create a new worktree and send contextual prompt to AI Chat',
		};

		const noAiChat = {
			label: '$(arrow-right) Continue without AI Chat',
			description: 'Proceed with standard workflow',
			detail: 'Skip AI Chat integration and continue with branch creation',
		};

		const items: QuickPickItem[] = [aiChat, branchAndAiChat, createWorktreeAndAiChat, noAiChat];

		const step = createPickStep<QuickPickItem>({
			title: context.title,
			placeholder: 'Choose how to proceed with this issue',
			items: items,
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

		const selectedItem = selection[0];
		switch (selectedItem) {
			case aiChat:
				// Return action to send explain-issue prompt to chat (handled in main flow)
				return 'explain-issue';
			case branchAndAiChat:
				// Return action to create branch then send prompt to chat
				return 'create-branch';
			case createWorktreeAndAiChat:
				// Return action to create worktree then send prompt to chat
				return 'create-worktree';
			default:
				// Continue without AI Chat
				return undefined;
		}
	}

	protected async sendIssueToChatWithAction(item: StartWorkItem, action: ChatAction): Promise<void> {
		const repository = await this.getIssueRepositoryIfExists(item.issue);

		const context: ChatIssueContext = {
			item: item.issue,
			repository: repository,
			source: 'start-work',
			metadata: {
				worktree: action === 'create-worktree',
			},
		};

		await this.container.chat.sendContextualPrompt({
			context: context,
			action: action,
			config: {
				includeMcpTools: true,
				includeRepoContext: true,
				includeFileContext: action === 'explain-issue',
			},
			source: 'startWork',
		});
	}

	private async *confirmLocalIntegrationConnectStep(
		state: StepState<State>,
		context: Context,
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
		state: StepState<State>,
		context: Context,
		overrideStep?: QuickPickStep<QuickPickItemOfT<StartWorkItem>>,
	): AsyncStepResultGenerator<{ connected: boolean | IntegrationIds; resume: () => void | undefined }> {
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
		state: StepState<State>,
		context: Context,
	): AsyncStepResultGenerator<StartWorkItem> {
		const hasDisconnectedIntegrations = [...context.connectedIntegrations.values()].some(c => !c);

		const buildStartWorkQuickPickItem = (i: StartWorkItem) => {
			const onWebButton = i.issue.url ? getOpenOnWebQuickInputButton(i.issue.provider.id) : undefined;
			const buttons = onWebButton ? [onWebButton] : [];
			const hoverContent = i.issue.body ? `${repeatSpaces(200)}\n\n${i.issue.body}` : '';
			return {
				label: i.issue.title.length > 60 ? `${i.issue.title.substring(0, 60)}...` : i.issue.title,
				description: `\u00a0 ${
					i.issue.repository ? `${i.issue.repository.owner}/${i.issue.repository.repo}#` : ''
				}${i.issue.id} \u00a0`,
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
			endSteps(state);
			return StepResultBreak;
		}

		return { ...element.item };
	}

	private open(item: StartWorkItem): void {
		if (item.issue.url == null) return;
		void openUrl(item.issue.url);
	}

	private sendItemActionTelemetry(action: 'soft-open', item: StartWorkItem, context: Context) {
		this.container.telemetry.sendEvent(`${this.telemetryEventKey}/issue/action`, {
			...context.telemetryContext!,
			...buildItemTelemetryData(item),
			action: action,
			connected: true,
		});
	}

	private sendTitleActionTelemetry(action: TelemetryEvents['startWork/title/action']['action'], context: Context) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/title/action`,
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}

	private sendActionTelemetry(action: TelemetryEvents['startWork/action']['action'], context: Context) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			`${this.telemetryEventKey}/action`,
			{ ...context.telemetryContext!, connected: true, action: action },
			this.source,
		);
	}
}

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
	source?: Sources;
}

export class StartWorkCommand extends StartWorkBaseCommand {
	overrides?: undefined;

	protected override async *continuation(
		state: StartWorkStepState,
		_context: Context,
	): AsyncStepResultGenerator<void> {
		const issue = state.item.issue;
		const repo = issue && (await this.getIssueRepositoryIfExists(issue));

		// Determine the confirm options based on chat action
		let confirmOptions: ('--switch' | '--worktree')[] | undefined;
		if (state.chatAction === 'create-worktree') {
			// For worktree chat action, only allow worktree creation
			confirmOptions = ['--worktree'];
		} else if (state.chatAction === 'create-branch') {
			// For branch chat action, only allow branch creation (no worktree)
			confirmOptions = ['--switch'];
		} else {
			// For no chat action, allow both options
			confirmOptions = ['--switch', '--worktree'];
		}

		// Create onWorkspaceChanging callback for worktree chat action
		let onWorkspaceChanging: ((isNewWorktree?: boolean) => Promise<void>) | undefined;
		if (state.chatAction === 'create-worktree' && repo) {
			const { serializeIssue } = await import('../../git/utils/issue.utils');
			const serializedIssue = serializeIssue(issue);

			onWorkspaceChanging = async (isNewWorktree?: boolean) => {
				if (!isNewWorktree) return;

				// Get the repository ID
				const repoId =
					(await repo.git.getUniqueRepositoryId()) ??
					(await import('../../git/models/repositoryIdentities')).missingRepositoryId;

				// Get the remote URL
				const remote = await repo.git.remotes.getDefaultRemote();
				const remoteUrl = remote?.url;

				// Store a deeplink with the issue data for the new worktree window
				// Format: vscode://{extensionId}/link/r/{repoId}?action=start-work-chat&url={remoteUrl}
				const url = `vscode://${this.container.context.extension.id}/link/r/${repoId}?action=start-work-chat${
					remoteUrl ? `&url=${encodeURIComponent(remoteUrl)}` : ''
				}`;

				await this.container.storage.storeSecret(
					'deepLinks:pending',
					JSON.stringify({
						url: url,
						repoPath: repo.path,
						issue: serializedIssue,
					}),
				);
			};
		}

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
					confirmOptions: confirmOptions,
					associateWithIssue: issue,
					onWorkspaceChanging: onWorkspaceChanging,
				},
			},
			this.pickedVia,
		);
		if (result !== StepResultBreak) {
			state.counter = 0;

			// After branch creation, send prompt to chat if needed
			if (state.chatAction === 'create-branch') {
				await this.sendIssueToChatWithAction(state.item, 'create-branch');
			}
			// For worktree, the chat prompt will be sent when the new window opens
			// (handled by the deeplink service processing the pending deeplink)
		} else {
			endSteps(state);
		}
	}
}

export interface AssociateIssueWithBranchCommandArgs {
	readonly command: 'associateIssueWithBranch';
	branch?: GitBranchReference;
	source?: Sources;
}

export class AssociateIssueWithBranchCommand extends StartWorkBaseCommand {
	private branch: GitBranchReference | undefined;
	protected override overrides: StartWorkOverrides = {
		ownSource: 'associateIssueWithBranch',
		placeholders: {
			cloudIntegrationConnectHasConnected:
				'Connect additional integrations to associate their issues with your branches',
			cloudIntegrationConnectNoConnected: 'Connect an integration to associate its issues with your branches',
			localIntegrationConnect: 'Connect an integration to associate its issues with your branches',
			issueSelection: 'Choose an issue to associate with your branch',
		},
	};

	constructor(container: Container, args?: AssociateIssueWithBranchCommandArgs) {
		super(
			container,
			{ command: 'associateIssueWithBranch', source: args?.source ?? 'commandPalette' },
			'associateIssueWithBranch',
			'associateIssueWithBranch',
			`Associate Issue with Branch\u00a0\u00a0${proBadge}`,
			'Associate an issue with your branch',
			'associateIssueWithBranch',
		);
		this.branch = args?.branch;
	}

	// eslint-disable-next-line require-yield
	protected override async *continuation(
		state: StartWorkStepState,
		_context: Context,
	): AsyncStepResultGenerator<void> {
		if (!this.container.git.openRepositories.length) {
			return;
		}

		const issue = state.item.issue;

		if (this.branch == null) {
			this.branch = await showBranchPicker(
				`Associate Issue with Branch\u00a0\u00a0${proBadge}`,
				'Choose a branch to associate the issue with',
				this.container.git.openRepositories,
				{ filter: b => !b.remote },
			);
		}

		if (this.branch == null) {
			return;
		}

		const owner = getIssueOwner(issue);
		if (owner == null) {
			return;
		}

		await addAssociatedIssueToBranch(this.container, this.branch, { ...issue, type: 'issue' }, owner);
		endSteps(state);
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
					issue: i,
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

export function getStartWorkItemIdHash(item: StartWorkItem): string {
	return md5(item.issue.id);
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

async function getConnectedIntegrations(container: Container): Promise<Map<SupportedStartWorkIntegrationIds, boolean>> {
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
