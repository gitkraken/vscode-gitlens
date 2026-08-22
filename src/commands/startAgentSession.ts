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
}

/** Launches a new coding-agent session targeting a worktree. Resolves the agent as the persisted
 *  `gitlens.ai.defaultAgent` > picker (same as `runPromptInAgent`). */
@command()
export class StartAgentSessionCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.startAgentSession');
	}

	async execute(args?: StartAgentSessionCommandArgs): Promise<void> {
		const descriptor = await this.resolveAgent(args?.pick ?? false);
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

	private async resolveAgent(pick: boolean): Promise<AgentDescriptor | undefined> {
		if (!pick) {
			const persistedId = configuration.get('ai.defaultAgent') ?? undefined;
			if (persistedId != null) {
				const descriptor = await resolveDefaultAgent(this.container, persistedId);
				if (descriptor != null) return descriptor;
			}
		}

		return pickAgentStandalone(this.container);
	}
}
