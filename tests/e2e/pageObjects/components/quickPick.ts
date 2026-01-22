import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { MaxTimeout, ShortTimeout } from '../../baseTest.js';
import type { VSCodePage } from '../vscodePage.js';

const QuickPickItemSelector = '.quick-input-list-entry';

/** Represents a wizard step identified by title and/or placeholder */
export type Step = { title?: RegExp; placeholder?: RegExp };

/**
 * Component for VS Code Quick Pick / Quick Input interactions.
 * Handles both command palette operations and wizard-style multi-step pickers.
 */
export class QuickPick {
	private readonly container: Locator;

	constructor(
		private readonly vscode: VSCodePage,
		private readonly page: Page,
	) {
		this.container = page.locator('.quick-input-widget');
	}

	// ============================================================================
	// Locators
	// ============================================================================

	/** Get the quick pick container */
	get locator(): Locator {
		return this.container;
	}

	/** Get the input field */
	get input(): Locator {
		return this.container.locator('input');
	}

	/** Get the title element */
	get title(): Locator {
		return this.container.locator('.quick-input-title');
	}

	/** Get the results list rows */
	get results(): Locator {
		return this.container.locator('.quick-input-list .quick-input-list-row');
	}

	/** Get the first result */
	get firstResult(): Locator {
		return this.results.first();
	}

	/** Get the back button */
	get backButton(): Locator {
		return this.container.locator('.codicon-quick-input-back').first();
	}

	/** Get the action buttons in the quick input header */
	get actionButtons(): Locator {
		// VS Code uses different selectors for action buttons depending on version
		// Try multiple selectors: the title bar actions, or the input box actions
		return this.container.locator('.monaco-action-bar .action-item a.action-label');
	}

	// ============================================================================
	// Visibility & State
	// ============================================================================

	async getVisibleItem(itemLabel: string | RegExp): Promise<Locator> {
		const locator = this.container
			.locator(QuickPickItemSelector)
			.filter({ hasText: itemLabel, visible: true })
			.first();
		await locator.waitFor({ state: 'visible', timeout: MaxTimeout });

		return locator;
	}

	/** Get all visible item labels for debugging */
	async getVisibleItems(): Promise<string[]> {
		const locator = this.container.locator(QuickPickItemSelector).filter({ visible: true });
		await locator.first().waitFor({ state: 'visible', timeout: MaxTimeout });

		const items = locator.allTextContents();
		return items;
	}

	/** Check if the quick pick is visible */
	async isVisible(): Promise<boolean> {
		return this.container.isVisible();
	}

	/** Wait for the quick pick to be visible */
	async waitForVisible(timeout = MaxTimeout): Promise<void> {
		await this.container.waitFor({ state: 'visible', timeout: timeout });
	}

	/** Wait for the quick pick to be hidden */
	async waitForHidden(timeout = MaxTimeout): Promise<void> {
		await this.container.waitFor({ state: 'hidden', timeout: timeout });
	}

	/** Wait for a specific placeholder text */
	async waitForPlaceholder(placeholder: string | RegExp, timeout = MaxTimeout): Promise<void> {
		await expect(this.input).toHaveAttribute('placeholder', placeholder, { timeout: timeout });
	}

	/** Wait for a specific title text */
	async waitForTitle(title: string | RegExp, timeout = MaxTimeout): Promise<void> {
		await expect(this.title).toHaveText(title, { timeout: timeout });
	}

	/** Get the current placeholder text */
	async getPlaceholder(): Promise<string | null> {
		return this.input.getAttribute('placeholder');
	}

	/** Get the current title text */
	async getTitle(): Promise<string | null> {
		return this.title.textContent();
	}

	/** Check if title matches a pattern */
	async hasTitle(title: string | RegExp): Promise<boolean> {
		const currentTitle = await this.getTitle();
		if (currentTitle === null) return false;
		if (typeof title === 'string') {
			return currentTitle.includes(title);
		}
		return title.test(currentTitle);
	}

	/** Count the number of visible items */
	async countItems(): Promise<number> {
		return this.results.count();
	}

	// ============================================================================
	// Command Palette Operations
	// ============================================================================

	/** Open the command palette (Ctrl+Shift+P) */
	async open(): Promise<void> {
		// Ensure any previous quick input is closed first
		if (await this.isVisible()) {
			await this.page.keyboard.press('Escape');
			await this.waitForHidden();
		}
		await this.page.keyboard.press('Control+Shift+P');
		await this.input.waitFor({ state: 'visible', timeout: MaxTimeout });
	}

	/** Close the quick pick */
	async close(): Promise<void> {
		if (await this.isVisible()) {
			await this.page.keyboard.press('Escape');
			await this.waitForHidden();
		}
	}

	/**
	 * Execute a command by name with retry logic.
	 * Opens command palette, types the command, and executes it.
	 */
	async execute(command: string, maxRetries = 3): Promise<void> {
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			await this.open();
			await this.input.fill(`> ${command}`);

			// Wait for results to populate
			await this.firstResult.waitFor({ state: 'visible', timeout: MaxTimeout });
			await this.page.waitForTimeout(ShortTimeout / 2); // Brief wait for results to settle

			const firstResultText = await this.firstResult.textContent();
			if (firstResultText === command) {
				await this.input.press('Enter');
				// Wait for command palette to close completely
				await this.waitForHidden();
				// Give the command time to execute and UI to settle
				await this.page.waitForTimeout(ShortTimeout);
				return;
			}

			// Close palette and retry
			await this.close();
			await this.page.waitForTimeout(ShortTimeout / 2);
		}

		throw new Error(`Command "${command}" not found in command palette after ${maxRetries} attempts`);
	}

	/** Quick open a file by name (Ctrl+P) */
	async quickOpen(filename: string): Promise<void> {
		await this.page.keyboard.press('Control+P');
		await this.input.waitFor({ state: 'visible', timeout: MaxTimeout });
		await this.input.fill(filename);
		await this.firstResult.waitFor({ state: 'visible', timeout: MaxTimeout });
		await this.input.press('Enter');
	}

	// ============================================================================
	// Quick Pick Operations
	// ============================================================================

	/** Cancel/close the quick pick - presses Escape until fully closed */
	async cancel(): Promise<void> {
		// Press Escape multiple times to ensure wizard is fully closed
		// (GitLens wizards may have multiple nested states)
		for (let i = 0; i < 5 && (await this.isVisible()); i++) {
			await this.page.keyboard.press('Escape');
			await this.page.waitForTimeout(ShortTimeout / 4);
		}
		await this.page.waitForTimeout(ShortTimeout / 2);
	}

	/** Clear the input field */
	async clear(): Promise<void> {
		await this.input.clear();
		await this.page.waitForTimeout(ShortTimeout / 2);
	}

	/** Type text into the input field */
	async enterText(text: string): Promise<void> {
		await this.input.fill(text);
		// Wait for the list to update after typing
		await this.page.waitForTimeout(ShortTimeout);
	}

	/** Type text and submit */
	async enterTextAndSubmit(text: string): Promise<void> {
		await this.enterText(text);
		await this.submit();
	}

	/** Type text and wait for items to appear */
	async enterTextAndWaitForItems(text: string, timeout = MaxTimeout): Promise<void> {
		await this.input.fill(text);
		await this.waitForItems(timeout);
	}

	/** Go back to the previous step by clicking the Back button */
	async goBack(): Promise<void> {
		await this.vscode.executeCommand('workbench.action.quickInputBack');
		await this.page.waitForTimeout(ShortTimeout / 2);
	}

	/**
	 * Navigate back and verify we reach the expected previous step
	 */
	async goBackAndWaitForStep(expectedStep: Step): Promise<void> {
		await this.goBack();
		await this.waitForStep(expectedStep);
	}

	/**
	 * Navigate back and verify we reach one of the expected previous steps.
	 * Useful when the previous step could be one of several options.
	 * @returns The index of the matched step in the array
	 */
	async goBackAndWaitForAnyStep(steps: Step[]): Promise<number> {
		await this.goBack();
		return this.waitForAnyStep(steps);
	}

	/**
	 * Check if we're currently at a step matching the given criteria.
	 */
	async isAtStep(step: Step): Promise<boolean> {
		const currentPlaceholder = await this.getPlaceholder();
		const currentTitle = await this.getTitle();

		const placeholderMatches =
			!step.placeholder || (currentPlaceholder != null && step.placeholder.test(currentPlaceholder));
		const titleMatches = !step.title || (currentTitle != null && step.title.test(currentTitle));

		return placeholderMatches && titleMatches;
	}

	/** Select an item by its label */
	async selectItem(label: string | RegExp): Promise<void> {
		const item = await this.getVisibleItem(label);

		// Avoid tooltips by clicking in the top-left corner
		await item.click({ position: { x: 1, y: 1 } });
		// await this.vscode.executeCommand('quickInput.accept');
		await this.page.waitForTimeout(ShortTimeout);
	}

	/**
	 * Click an action button in the quick pick header by its tooltip.
	 * Action buttons appear to the right of the title (e.g., "Choose a Specific Commit" toggle).
	 */
	async clickActionButton(tooltip: string | RegExp): Promise<void> {
		// Try multiple selectors for action buttons
		const selectors = [
			'.quick-input-widget .monaco-action-bar .action-item a.action-label',
			'.quick-input-widget .quick-input-titlebar .monaco-action-bar a.action-label',
			'.quick-input-widget a.action-label',
			'.quick-input-box .monaco-findInput .controls a.action-label',
		];

		for (const selector of selectors) {
			const buttons = this.page.locator(selector);
			const count = await buttons.count();

			for (let i = 0; i < count; i++) {
				const btn = buttons.nth(i);
				// Try both title and aria-label attributes
				const title = await btn.getAttribute('title');
				const ariaLabel = await btn.getAttribute('aria-label');
				const label = title || ariaLabel;

				if (label != null && label.length > 0) {
					const matches = typeof tooltip === 'string' ? label.includes(tooltip) : tooltip.test(label);
					if (matches) {
						await btn.click({ force: true });
						await this.page.waitForTimeout(ShortTimeout);
						return;
					}
				}
			}
		}

		throw new Error(`Action button with tooltip "${tooltip}" not found`);
	}

	/**
	 * Select an item in a possible multi-select quick pick (VS Code will automatically use a single-select if there is only 1 item)
	 */
	async selectItemMulti(itemLabel: string | RegExp): Promise<void> {
		// Check if we actually toggled the item — otherwise assume this is a single select and just click it
		const toggled = await this.toggleItemSelection(itemLabel, true);
		if (toggled) {
			await this.submit();
		}
	}

	async toggleItemSelection(itemLabel: string | RegExp, clickIfSingleSelect: boolean): Promise<boolean> {
		const item = await this.getVisibleItem(itemLabel);
		await item.focus();

		let toggled = false;
		// Try to find and click the checkbox inside the item, fall back to Space key
		if (await item.locator('.monaco-checkbox[role=checkbox]').first().count()) {
			await item.check();
			toggled = true;
		} else if (clickIfSingleSelect) {
			// Avoid tooltips by clicking in the top-left corner
			await item.click({ position: { x: 1, y: 1 } });
			toggled = false;
		}

		await this.page.waitForTimeout(ShortTimeout / 4);
		return toggled;
	}

	/** Submit the current input (press Enter) */
	async submit(): Promise<void> {
		await this.page.keyboard.press('Enter');
		await this.page.waitForTimeout(ShortTimeout);
	}

	/**
	 * Wait for any of the given steps (by title and/or placeholder) and return the index of the one found.
	 * Useful when the step could be one of several options (e.g., repo picker or subcommand).
	 * @returns The index of the matched step in the array
	 */
	async waitForAnyStep(steps: Step[], timeout = MaxTimeout): Promise<number> {
		const startTime = Date.now();
		while (Date.now() - startTime < timeout) {
			const currentPlaceholder = await this.getPlaceholder();
			const currentTitle = await this.getTitle();

			for (let i = 0; i < steps.length; i++) {
				const step = steps[i];
				const placeholderMatches =
					!step.placeholder || (currentPlaceholder && step.placeholder.test(currentPlaceholder));
				const titleMatches = !step.title || (currentTitle && step.title.test(currentTitle));

				if (placeholderMatches && titleMatches) {
					return i;
				}
			}
			await this.page.waitForTimeout(ShortTimeout / 4);
		}
		throw new Error(
			`None of the expected steps found within ${timeout}ms. ` +
				`Expected one of: ${steps.map(s => `{title: ${s.title}, placeholder: ${s.placeholder}}`).join(', ')}`,
		);
	}

	/**
	 * Wait briefly and check if we're at an optional step.
	 * Returns true if the step appeared, false otherwise.
	 * The caller decides what action to take if the step is present.
	 */
	async waitForOptionalStep(step: Step): Promise<boolean> {
		await this.page.waitForTimeout(ShortTimeout / 2);
		return this.isAtStep(step);
	}

	/**
	 * Wait for a step identified by title and/or placeholder patterns
	 */
	async waitForStep(step: Step, timeout = MaxTimeout): Promise<void> {
		await Promise.all([
			step.title ? this.waitForTitle(step.title, timeout) : undefined,
			step.placeholder ? this.waitForPlaceholder(step.placeholder, timeout) : undefined,
		]);
	}

	/** Wait for items to appear */
	async waitForItems(timeout = MaxTimeout): Promise<void> {
		try {
			await this.container.locator(QuickPickItemSelector).first().waitFor({ state: 'visible', timeout: timeout });
		} catch (ex) {
			// Log the current state for debugging
			const placeholder = await this.getPlaceholder();
			const title = await this.getTitle();
			console.error(`[QWTEST] waitForItems failed. Title: ${title}, Placeholder: ${placeholder}`);
			throw ex;
		}
	}
}
