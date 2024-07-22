import { browser, expect } from '@wdio/globals';
import type { EditorView, Workbench } from 'wdio-vscode-service';
import { welcomeWebviewTitle } from '../constants/messages.ts';
import { waitUntilExtensionLoaded } from '../helpers/helpers.ts';

describe('Test GitLens extension load', () => {
	let workbench: Workbench;
	let editorView: EditorView;

	before(async () => {
		workbench = await browser.getWorkbench();
		editorView = workbench.getEditorView();
		await waitUntilExtensionLoaded();
	});

	it('should display GitLens Welcome page after installation', async () => {
		const currentTab = await editorView.getActiveTab();
		const currentTabTitle = await currentTab?.getTitle();
		await expect(currentTabTitle).toBe(welcomeWebviewTitle);
		await editorView.closeAllEditors();
	});

	it('should contain GitLens & GitLens Inspect icons in activity bar', async () => {
		const activityBar = workbench.getActivityBar();
		const viewControls = await activityBar.getViewControls();
		const controls = await Promise.all(viewControls.map(vc => vc.getTitle()));
		await expect(controls).toContain('GitLens');
		await expect(controls).toContain('GitLens Inspect');
	});
});
