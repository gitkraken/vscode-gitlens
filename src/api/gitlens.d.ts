import type { Disposable } from 'vscode';

export type { Disposable } from 'vscode';

export interface RemoteProvider {
	readonly id: string;
	readonly name: string;
	readonly domain: string;
}

export interface CreatePullRequestActionContext {
	readonly type: 'createPullRequest';

	readonly repoPath: string;
	readonly branch: {
		readonly name: string;
		readonly upstream: string | undefined;
		readonly isRemote: boolean;
	};
	readonly remote:
		| {
				readonly name: string;
				readonly provider?: RemoteProvider;
				readonly url?: string;
		  }
		| undefined;
}

export interface OpenPullRequestActionContext {
	readonly type: 'openPullRequest';

	readonly repoPath: string;
	readonly provider: RemoteProvider | undefined;
	readonly pullRequest: {
		readonly id: string;
		readonly url: string;
	};
}

export interface HoverCommandsActionContext {
	readonly type: 'hover.commands';

	readonly repoPath: string;
	readonly commit: {
		sha: string;
		author: {
			name: string;
			email: string | undefined;
			[key: string]: unknown;
		};
	};
	readonly file:
		| {
				uri: string;
				line: number | undefined;
		  }
		| undefined;
}

export type ActionContext = CreatePullRequestActionContext | OpenPullRequestActionContext | HoverCommandsActionContext;
export type Action<T extends ActionContext> = T['type'];

export interface ActionRunner<T extends ActionContext = ActionContext> {
	/*
	 * A unique key to identify the extension/product/company to which the runner belongs
	 */
	readonly partnerId: string;

	/*
	 * A user-friendly name to which the runner belongs, i.e. your extension/product/company name. Will be shown, less prominently, to the user when offering this action
	 */
	readonly name: string;

	/*
	 * A user-friendly string which describes the action that will be taken. Will be shown to the user when offering this action
	 */
	readonly label: string | ((context: T) => string);

	run(context: T): void | Promise<void>;
	// when?(context: T): boolean;
}

export interface GitLensApi {
	registerActionRunner<T extends ActionContext>(action: Action<T>, runner: ActionRunner): Disposable;
}
