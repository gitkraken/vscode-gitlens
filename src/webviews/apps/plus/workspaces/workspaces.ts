import type { State } from '../../../../plus/webviews/workspaces/protocol';
import { App } from '../../shared/appBase';
import type { PullRequestRow } from './components/pull-request-row';
import '../../shared/components/code-icon';
import '../../shared/components/avatars/avatar-item';
import '../../shared/components/avatars/avatar-stack';
import '../../shared/components/table/table-container';
import '../../shared/components/table/table-row';
import '../../shared/components/table/table-cell';
import './components/pull-request-row';
import './workspaces.scss';

export class WorkspacesApp extends App<State> {
	constructor() {
		super('WorkspacesApp');
	}

	override onInitialize() {
		this.log(`${this.appName}.onInitialize`);
		this.renderContent();
		console.log(this.state);
	}

	renderContent() {
		this.renderPullRequests();
	}

	renderPullRequests() {
		const prTableEl = document.getElementById('pull-requests');

		if (this.state.pullRequests != null && this.state.pullRequests?.length > 0) {
			const els = this.state.pullRequests.map(({ pullRequest }) => {
				const prRowEl = document.createElement('pull-request-row') as PullRequestRow;
				prRowEl.pullRequest = pullRequest;

				return prRowEl;
			});
			prTableEl?.append(...els);
		}
	}
}

new WorkspacesApp();
