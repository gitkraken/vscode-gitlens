/*global*/
import type { Serialized } from '../../../system/vscode/serialize';
import type { State } from '../../commitDetails/protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
import type { GlCommitDetailsApp } from './components/commit-details-app';
import './commitDetails.scss';
import './components/commit-details-app';

export type CommitState = SomeNonNullable<Serialized<State>, 'commit'>;
export class CommitDetailsApp extends App<Serialized<State>> {
	constructor() {
		super('CommitDetailsApp');
	}

	override onInitialize() {
		const component = document.getElementById('app') as GlCommitDetailsApp;
		component.state = this.state;
		DOM.on<GlCommitDetailsApp, Serialized<State>>(component, 'state-changed', e => {
			this.state = e.detail;
			this.setState(this.state);
		});
	}
}

new CommitDetailsApp();
