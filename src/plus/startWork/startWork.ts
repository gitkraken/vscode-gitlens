import { window } from 'vscode';
import { isWeb } from '@env/platform.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import type { AsyncStepResultGenerator, StepSelection } from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import { getSteps } from '../../commands/quick-wizard/utils/quickWizard.utils.js';
import { canPickStepContinue, createPickStep } from '../../commands/quick-wizard/utils/steps.utils.js';
import type { Source, Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { locateOrCloneRepository } from '../../git/utils/-webview/repository.utils.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickItemOfT } from '../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import type { AgentRoute } from '../agents/agentDescriptor.js';
import type { ResolveAgentFlowResult } from '../agents/agentPicker.js';
import { buildAgentResolvedTelemetryData, resolveAgentFlow } from '../agents/agentPicker.js';
import type { StartWorkChatAction } from '../chat/chatActions.js';
import type { StartWorkContext, StartWorkStepState } from './startWorkBase.js';
import { StartWorkBaseCommand } from './startWorkBase.js';
import { createBranchNameFromIssue } from './utils/-webview/startWork.utils.js';

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
	source?: Sources | Source;

	// Pre-select issue by URL (skips issue picker)
	issueUrl?: string;

	// Use smart defaults and skip unnecessary steps
	useDefaults?: boolean;

	// Open chat on after branch/worktree is opened
	openChatOnComplete?: boolean;

	// Activates the manual-vs-agent flow after issue selection:
	//   - `'ask'`    : defer to the persisted `gitlens.ai.openInAgent` setting (default: pre-picker)
	//   - `'manual'` : force manual — skip chat hand-off entirely, regardless of persisted setting
	//   - `'agent'`  : force agent — skip the pre-picker and go straight to the agent picker (or the
	//                  persisted `gitlens.ai.defaultAgent` if set and available)
	//   - undefined  : do not run the new flow; legacy `openChatOnComplete` behavior applies
	showOpenInAgent?: AgentRoute;

	// Instructions to include in the AI prompt
	instructions?: string;

	// Result tracking for programmatic usage
	result?: Deferred<{ branch: GitBranch; worktree?: GitWorktree }>;
}

export class StartWorkCommand extends StartWorkBaseCommand {
	overrides?: undefined;

	protected override get openRepositoriesOnly(): boolean {
		return this.container.git.openRepositoryCount > 0;
	}

	constructor(container: Container, args?: StartWorkCommandArgs) {
		super(container, { ...args, command: 'startWork' });

		// Populate initialState with args for CLI/programmatic usage
		this.initialState = {
			...this.initialState,
			issueUrl: args?.issueUrl,
			instructions: args?.instructions,
			useDefaults: args?.useDefaults,
			openChatOnComplete: args?.openChatOnComplete,
			showOpenInAgent: args?.showOpenInAgent,
			result: args?.result,
		};
	}

	protected override async *continuation(
		state: StartWorkStepState,
		context: StartWorkContext,
	): AsyncStepResultGenerator<void> {
		const issue = state.item.issue;
		const hasOpenRepos = this.openRepositoriesOnly;
		let repo =
			issue && (await this.getIssueRepositoryIfExists(issue, hasOpenRepos ? undefined : { skipVirtual: true }));

		// No open repositories and none could be located/opened for this issue — the branch wizard's
		// repo picker only lists `openRepositories` (empty here) and would dead-end on a Cancel-only
		// picker. Offer a way to get a repository open instead of proceeding to the wizard.
		if (repo == null && !hasOpenRepos) {
			// Hard contract (mirrors startReview): never pop an interactive prompt when running
			// unattended (MCP/CLI pass useDefaults) — fail deterministically instead.
			if (state.useDefaults) {
				const message = `No local repository found${
					issue.repository != null ? ` for ${issue.repository.owner}/${issue.repository.repo}` : ''
				}. Please clone the repository first.`;
				state.result?.cancel(new Error(message));
				void window.showErrorMessage(`Failed to start work: ${message}`);
				return;
			}

			const located = yield* this.pickNoRepositoryFoundStep(state, context, issue);
			if (located === StepResultBreak || located == null) return;

			repo = located;
		}

		// Determine defaults when useDefaults is enabled
		let defaultReference = undefined;

		if (state.useDefaults && repo) {
			// Get default branch (returns remote branch name like "origin/main")
			const defaultBranchName = await repo.git.branches.getDefaultBranchName();
			if (defaultBranchName) {
				// Strip remote prefix to get local branch name (e.g., "origin/main" -> "main")
				const localBranchName = getBranchNameWithoutRemote(defaultBranchName);

				// Get the local version of the default branch
				const defaultBranch = await repo.git.branches.getBranch(localBranchName);
				if (defaultBranch) {
					defaultReference = defaultBranch;
				}
			}
		}

		const branchName = issue ? createBranchNameFromIssue(issue) : undefined;

		// When `showOpenInAgent` is set, run the manual-vs-agent flow (overriding the persisted
		// route for this invocation). Otherwise, fall back to the legacy `openChatOnComplete`
		// behavior — always hand off to the host IDE chat.
		// Defense-in-depth: skip the agent flow entirely when AI is disabled (org or user setting),
		// even if a caller passed `showOpenInAgent`. UI surfaces gate, but the wizard enforces too.
		const aiAllowed = this.container.ai.allowed;
		let chatAction: StartWorkChatAction | undefined;
		if (aiAllowed && state.showOpenInAgent != null && issue) {
			// yield* so any picker steps go through the wizard machinery (NOT standalone QuickPicks,
			// which collide with the wizard's still-alive picker and silently exit the wizard).
			const flow = yield* resolveAgentFlow(this.container, {
				useDefaults: state.useDefaults,
				requestedRoute: state.showOpenInAgent,
			});
			if (flow === StepResultBreak) return;

			this.sendAgentResolvedTelemetry(flow, context);

			if (flow.kind === 'cancel') return;

			if (flow.kind === 'agent') {
				chatAction = {
					type: 'startWork',
					issue: issue,
					instructions: state.instructions,
					agent: flow.descriptor,
				};
			}
			// flow.kind === 'manual' → leave chatAction undefined → no chat hand-off
		} else if (state.openChatOnComplete && issue) {
			chatAction = { type: 'startWork', issue: issue, instructions: state.instructions };
		}

		// When useDefaults is true, set repo directly to skip picker.
		// Otherwise, use suggestedRepo to hint at the picker. Also set repo directly when
		// there are no open repositories — a located-but-closed repo is added closed and
		// never appears in the picker's openRepositories list, so a suggestion would dead-end.
		const skipRepoPicker = state.useDefaults || !hasOpenRepos;

		yield* getSteps(
			this.container,
			{
				command: 'branch',
				confirm: state.useDefaults ? false : undefined,
				state: {
					subcommand: 'create',
					repo: skipRepoPicker ? repo : undefined,
					suggestedRepo: skipRepoPicker ? undefined : repo,
					reference: defaultReference,
					name: state.useDefaults ? branchName : undefined,
					suggestedName: branchName,
					flags: state.useDefaults ? ['--worktree'] : [],
					confirmOptions: ['--switch', '--worktree'],
					associateWithIssue: issue,
					// Agent-aware post-create open behavior:
					//   - CLI agent: skip the open step ('none'). The CLI dispatch opens a terminal
					//     in the current window with `cwd = worktree.uri.fsPath`; a window switch
					//     would tear down that terminal.
					//   - Non-CLI agent (IDE chat, Claude extension, legacy): force a new window
					//     ('new') so the deep-link bridge fires reliably. Without this, the "open
					//     after create" prompt may default to "don't open" and the agent dispatch
					//     sits in secret storage until manual window reload.
					//   - No agent: honor `useDefaults` if set, else fall through to the user's setting.
					worktreeDefaultOpen:
						chatAction?.agent?.kind === 'cli'
							? 'none'
							: chatAction?.agent != null || state.useDefaults
								? 'new'
								: undefined,
					result: state.result,
					chatAction: chatAction,
				},
			},
			context,
			this.startedFrom,
		);
	}

	/**
	 * Offers a way forward when no repository is open and none could be located/opened for the
	 * selected issue — cloning, choosing a local folder, or (on the web) opening a remote
	 * repository. Cloning/choosing a folder locates-or-adds the repository and returns it so the
	 * wizard can continue into branch creation; `undefined` ends the wizard.
	 */
	private async *pickNoRepositoryFoundStep(
		state: StartWorkStepState,
		context: StartWorkContext,
		issue: IssueShape,
	): AsyncStepResultGenerator<GlRepository | undefined> {
		type NoRepositoryAction = 'clone' | 'folder' | 'open-remote';

		const name = issue.repository != null ? `${issue.repository.owner}/${issue.repository.repo}` : undefined;
		const remoteUrl = issue.repository?.url;

		const items: (DirectiveQuickPickItem | QuickPickItemOfT<NoRepositoryAction>)[] = [];

		if (!isWeb && remoteUrl != null) {
			items.push(
				createQuickPickItemOfT<NoRepositoryAction>(
					{
						label: 'Clone Repository...',
						detail: `Clone ${name} to start work on this issue`,
					},
					'clone',
				),
			);
		}

		if (!isWeb) {
			items.push(
				createQuickPickItemOfT<NoRepositoryAction>(
					{
						label: 'Choose a Local Folder...',
						detail: 'Choose a folder containing the repository for this issue',
					},
					'folder',
				),
			);
		} else {
			items.push(
				createQuickPickItemOfT<NoRepositoryAction>(
					{
						label: 'Open a Remote Repository...',
						detail: 'Work with a repository without cloning it locally',
					},
					'open-remote',
				),
			);
		}

		items.push(createDirectiveQuickPickItem(Directive.Cancel));

		const step = createPickStep<QuickPickItemOfT<NoRepositoryAction>>({
			title: context.title,
			placeholder: `Unable to locate a local repository for ${name ?? 'this issue'}, choose how to find it`,
			items: items,
		});

		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) return undefined;

		const action = selection[0].item;
		switch (action) {
			case 'clone':
			case 'folder': {
				// Freeze the step while the native dialog/clone runs — otherwise losing focus hides
				// the quickpick and the wizard machinery resolves the step as cancelled, tearing the
				// wizard down before branch creation can continue.
				using _frozen = step.freeze?.();
				try {
					return await locateOrCloneRepository(this.container, action, {
						name: name ?? 'this issue',
						remoteUrl: remoteUrl,
					});
				} catch (ex) {
					if (!isCancellationError(ex)) {
						void window.showErrorMessage(
							`Failed to start work: ${ex instanceof Error ? ex.message : String(ex)}`,
						);
					}
					return undefined;
				}
			}
			case 'open-remote':
				void executeCoreCommand('remoteHub.openRepository');
				return undefined;
		}
	}

	private sendAgentResolvedTelemetry(result: ResolveAgentFlowResult, context: StartWorkContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			'startWork/agent/resolved',
			{ ...context.telemetryContext!, connected: true, ...buildAgentResolvedTelemetryData(result) },
			this.source,
		);
	}
}
