import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { urls } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { KeplerTaskIntent, KeplerTaskItem } from '../plus/kepler/keplerTask.js';
import { findKeplerRepoPathForPullRequest, getKeplerRepoPath, startKeplerTask } from '../plus/kepler/keplerTask.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';

// The surface-agnostic "Get Kepler" CTA, used by the Settings and Graph sidebar banners.
//
// Named `openProductPage`, not `openKepler`: this opens Kepler's *product page* in a browser, it
// does not open Kepler itself. The `gitlens.kepler.*` namespace is for deep linking into an
// installed Kepler (`gitlens.kepler.startReview`, `.newTask`, …) — a separate, larger command
// surface than the single-command `gitlens.openKepler` this used to reserve for that purpose.
//
// Distinct from `WelcomeOpenKeplerCommand` (`./welcome.js`), which is welcome-page-specific and
// reports through that page's own `welcome/action` event.

@command()
export class KeplerOpenProductPageCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.kepler.openProductPage');
	}

	execute(src?: Source): void {
		this.container.telemetry.sendEvent('kepler/productPage/opened', undefined, src);
		void openUrl(urls.kepler);
	}
}

export interface KeplerCommandArgs {
	/** The PR to start from, identity only. Required by `gitlens.kepler.startReview`, ignored by `.newTask`. */
	pr?: Pick<KeplerTaskItem, 'url' | 'provider'>;
	/** A local repository path; sent as `repo=` only if it resolves to a known, non-virtual repository. */
	repoPath?: string;
	source?: Source;
}

// Deep links into an installed Kepler's Task Composer from the tree views and the Graph (via its
// `:graph` sibling in `graphCommands.ts`). There is deliberately no `gitlens.kepler.startWork`:
// issues have no surface to hang a menu on, so `start-work` is reached only as an intent, from the
// Start Work wizard route, which calls `startKeplerTask` directly.
@command()
export class KeplerCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.kepler.startReview', 'gitlens.kepler.newTask']);
	}

	protected override async preExecute(context: CommandContext, args?: KeplerCommandArgs): Promise<void> {
		const intent: KeplerTaskIntent = context.command === 'gitlens.kepler.startReview' ? 'start-review' : 'new-task';

		if (context.type === 'viewItem') {
			const { node } = context;
			if (node.is('pullrequest')) {
				args = {
					...args,
					pr: toKeplerTaskPullRequest(node.pullRequest),
					repoPath: node.repoPath,
					source: args?.source ?? { source: 'view' },
				};
			} else if (node.is('launchpad-item')) {
				const pr = node.pullRequest;
				args = {
					...args,
					pr: pr != null ? toKeplerTaskPullRequest(pr) : undefined,
					// Launchpad only knows the repo when it is an open workspace folder
					repoPath:
						node.repoPath ??
						(pr != null ? await findKeplerRepoPathForPullRequest(this.container, pr) : undefined),
					source: args?.source ?? { source: 'launchpad-view' },
				};
			} else if (node.isAny('repository', 'repo-folder')) {
				args = { ...args, repoPath: node.repo.path, source: args?.source ?? { source: 'view' } };
			}
		}

		return this.execute(intent, args);
	}

	async execute(intent: KeplerTaskIntent, args?: KeplerCommandArgs): Promise<void> {
		const repoPath = getKeplerRepoPath(this.container, args?.repoPath);

		if (intent === 'new-task') {
			await startKeplerTask(this.container, { intent: intent, repoPath: repoPath }, args?.source);
			return;
		}

		if (args?.pr == null) return;

		await startKeplerTask(
			this.container,
			{
				intent: intent,
				item: { kind: 'pr', url: args.pr.url, provider: args.pr.provider },
				repoPath: repoPath,
			},
			args.source,
		);
	}
}

function toKeplerTaskPullRequest(pr: PullRequest): Pick<KeplerTaskItem, 'url' | 'provider'> {
	return { url: pr.url, provider: { id: pr.provider.id, name: pr.provider.name } };
}
