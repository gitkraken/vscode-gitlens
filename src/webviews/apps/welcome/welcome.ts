/*global window*/
import './welcome.scss';
import type { State } from '../../welcome/protocol';
import { AppWithConfig } from '../shared/appWithConfigBase';
// import { Snow } from '../shared/snow';

export class WelcomeApp extends AppWithConfig<State> {
	constructor() {
		super('WelcomeApp', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
	}
}

new WelcomeApp();
// requestAnimationFrame(() => new Snow());
