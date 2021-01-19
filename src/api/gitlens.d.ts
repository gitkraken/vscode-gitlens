'use strict';
import { Disposable } from 'vscode';

export { Disposable } from 'vscode';

export interface RemoteProvider {
	readonly id: string;
	readonly name: string;
	readonly domain: string;
}

export interface CreatePullRequestActionContext {
	readonly type: 'createPullRequest';
	readonly branch: {
		readonly name: string;
		readonly remote?: {
			readonly name: string;
			readonly provider?: RemoteProvider;
			readonly url?: string;
		};
		readonly repoPath: string;
	};
}

export interface OpenPullRequestActionContext {
	readonly type: 'openPullRequest';
	readonly pullRequest: {
		readonly id: string;
		readonly provider?: RemoteProvider;
		readonly repoPath: string;
		readonly url: string;
	};
}

export type ActionContext = CreatePullRequestActionContext | OpenPullRequestActionContext;
export type Action<T extends ActionContext> = T['type'];

export interface ActionRunner {
	readonly name: string;
	readonly label: string;

	run(context: ActionContext): void | Promise<void>;
}

export interface GitLensApi {
	registerActionRunner<T extends ActionContext>(action: Action<T>, runner: ActionRunner): Disposable;
}
