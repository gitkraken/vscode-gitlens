import { browser, expect } from '@wdio/globals';
import type { Workbench } from 'wdio-vscode-service';
import { sleep } from 'wdio-vscode-service';
import { waitUntilExtensionLoaded } from '../helpers/helpers.ts';

const defaultTimeout = 3000;

describe('VS Code Extension Testing', () => {
	let workbench: Workbench;

	before(async () => {
		workbench = await browser.getWorkbench();
	});

	beforeEach(async () => {
		// TODO: check if it switches to the top
		await browser.switchToParentFrame();
		const welcomePage = await waitUntilExtensionLoaded();
		await welcomePage.closeWelcomePage();
	});

	it('should open commit graph with the command', async () => {
		await workbench.executeCommand('GitLens: Show Commit graph');

		const glLeftFrame = await $$('iframe')[0];
		await glLeftFrame?.waitForExist({ timeout: defaultTimeout });
		if (!glLeftFrame) throw new Error('no left frame');
		const leftFrameName = await glLeftFrame.getAttribute('name');
		await expect(leftFrameName).toMatch(/[\w-]*/gm);

		await browser.switchToFrame(glLeftFrame);
		const nestedIframe = await browser.$('iframe');
		await nestedIframe.waitForExist({ timeout: defaultTimeout });
		const nestedIframeId = await nestedIframe.getAttribute('id');
		await expect(nestedIframeId).toBe('active-frame');

		await browser.switchToFrame(nestedIframe);
		// TODO: add abstraction level to get easy access to the view
		// TODO: add complex tests with moving panels
		const graphApp = await $('div[data-test="graph-app"]');
		await graphApp.waitForExist({ timeout: defaultTimeout });
		const className = await graphApp.getAttribute('class');
		await expect(className).toBe('graph-app__container');
		const mainRefSpan = await $('div[data-testid="resizable-refHeaderColumn"]');
		await mainRefSpan.waitForExist({ timeout: defaultTimeout });
		await sleep(3000);
	});
});
