import { window } from 'vscode';
import type { Container } from '../container.js';
import type { AgentDescriptor } from '../plus/agents/agentDescriptor.js';
import { runAgent } from '../plus/agents/agentDispatch.js';
import { pickAgentStandalone } from '../plus/agents/agentPicker.js';
import { resolveDefaultAgent } from '../plus/agents/agentRegistry.js';
import { command } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { GlCommandBase } from './commandBase.js';

export interface StartAgentSessionCommandArgs {
	/** Working directory for the new session. CLI agents get it as the terminal's cwd; IDE chat and
	 *  the Claude extension are workspace-rooted, so it is delivered as an instruction prompt instead. */
	cwd?: string;
	/** When true, always show the agent picker instead of using the persisted default. */
	pick?: boolean;
	/** Target a specific agent by descriptor id (e.g. `cli:codex`), bypassing both the persisted
	 *  default and the picker. */
	agentId?: string;
}

/** Launches a new coding-agent session targeting a worktree. Resolves the agent as an explicit
 *  `agentId` > `pick` > the persisted `gitlens.ai.defaultAgent` > picker (same as `runPromptInAgent`). */
@command()
export class StartAgentSessionCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.startAgentSession');
	}

	async execute(args?: StartAgentSessionCommandArgs): Promise<void> {
		const descriptor = await this.resolveAgent(args);
		if (descriptor == null) return;

		const cwd = args?.cwd;

		// Only the CLI path honors a real cwd — launch bare in a terminal there. The other hosts
		// root at the current workspace, so point them at the worktree via the prompt itself.
		const prompt =
			descriptor.kind === 'cli' || cwd == null
				? ''
				: `Work in the Git worktree at \`${cwd}\` for this session — change to that directory before running any commands, and make all file changes there.`;

		const result = await runAgent(descriptor, prompt, { cwd: cwd, autoExecute: true });
		if (!result.success) {
			void window.showWarningMessage(`Couldn't start ${descriptor.label}.`);
		}
	}

	/** Resolves the agent to target, honoring precedence `agentId` > `pick` > persisted default >
	 *  picker. An explicit `agentId` that fails to resolve is a hard stop — it warns (naming the
	 *  agent that couldn't be started) and returns `undefined` WITHOUT falling through to the
	 *  picker, since offering a different agent isn't what someone who asked for a specific one
	 *  wants. A cancelled picker also returns `undefined`, but silently — that's the user's own
	 *  choice, not a failure. */
	private async resolveAgent(args?: StartAgentSessionCommandArgs): Promise<AgentDescriptor | undefined> {
		const agentId = args?.agentId;
		if (agentId != null) {
			const descriptor = await resolveDefaultAgent(this.container, agentId);
			if (descriptor == null) {
				void window.showWarningMessage(`Couldn't start ${describeAgentId(agentId)}.`);
			}

			return descriptor;
		}

		if (!(args?.pick ?? false)) {
			const persistedId = configuration.get('ai.defaultAgent') ?? undefined;
			if (persistedId != null) {
				const descriptor = await resolveDefaultAgent(this.container, persistedId);
				if (descriptor != null) return descriptor;
			}
		}

		return pickAgentStandalone(this.container);
	}
}

/** Best-effort readable name for an `agentId` that failed to resolve to a descriptor — there is no
 *  `AgentDescriptor.label` to fall back on at that point, so this strips the `cli:` id prefix the
 *  same way `agentStatusService.ts`'s `handleHooksOperationForAgentCommand` does for its own
 *  "agent is no longer available" warning. */
function describeAgentId(agentId: string): string {
	return agentId.startsWith('cli:') ? agentId.slice(4) : agentId;
}
