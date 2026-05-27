import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import type { AsyncStepResultGenerator } from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import { getSteps } from '../../commands/quick-wizard/utils/quickWizard.utils.js';
import type { Source, Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { getContext } from '../../system/-webview/context.js';
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
		const repo = issue && (await this.getIssueRepositoryIfExists(issue));

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
		// Defense-in-depth: skip the agent flow entirely when the org has disabled AI, even if a
		// caller passed `showOpenInAgent`. UI surfaces should already gate, but the wizard enforces.
		const aiEnabled = getContext('gitlens:gk:organization:ai:enabled', true);
		let chatAction: StartWorkChatAction | undefined;
		if (aiEnabled && state.showOpenInAgent != null && issue) {
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

		yield* getSteps(
			this.container,
			{
				command: 'branch',
				confirm: state.useDefaults ? false : undefined,
				state: {
					subcommand: 'create',
					// When useDefaults is true, set repo directly to skip picker
					// Otherwise, use suggestedRepo to hint at the picker
					repo: state.useDefaults ? repo : undefined,
					suggestedRepo: state.useDefaults ? undefined : repo,
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

	private sendAgentResolvedTelemetry(result: ResolveAgentFlowResult, context: StartWorkContext) {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			'startWork/agent/resolved',
			{ ...context.telemetryContext!, connected: true, ...buildAgentResolvedTelemetryData(result) },
			this.source,
		);
	}
}
