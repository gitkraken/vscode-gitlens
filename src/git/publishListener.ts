import type { Disposable } from 'vscode';
import type { CreatePullRequestActionContext } from '../api/gitlens.d.js';
import type { Container } from '../container.js';
import { showCreatePullRequestPrompt } from '../messages.js';
import { executeActionCommand } from '../system/-webview/command.js';

export function registerPublishListener(container: Container): Disposable {
	return container.events.on('git:publish', async e => {
		if (!container.actionRunners.count('createPullRequest')) return;
		if (!(await showCreatePullRequestPrompt(e.data.branch.name))) return;

		const repo = container.git.getRepository(e.data.repoPath);
		const remote = await repo?.git.remotes.getRemote(e.data.remote);

		void executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
			repoPath: e.data.repoPath,
			remote:
				remote != null
					? {
							name: remote.name,
							provider:
								remote.provider != null
									? {
											id: remote.provider.id,
											name: remote.provider.name,
											domain: remote.provider.domain,
										}
									: undefined,
							url: remote.url,
						}
					: { name: e.data.remote },
			branch: {
				name: e.data.branch.name,
				isRemote: e.data.branch.remote,
				upstream: e.data.branch.upstream?.name,
			},
		});
	});
}
