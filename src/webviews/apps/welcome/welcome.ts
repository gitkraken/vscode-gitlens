'use strict';
/*global window*/
import '../scss/welcome.scss';
import { WelcomeState } from '../../protocol';
import { AppWithConfig } from '../shared/appWithConfigBase';
import { Snow } from '../shared/snow';

export class WelcomeApp extends AppWithConfig<WelcomeState> {
	constructor() {
		super('WelcomeApp', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
	}
}

new WelcomeApp();
requestAnimationFrame(() => new Snow());
