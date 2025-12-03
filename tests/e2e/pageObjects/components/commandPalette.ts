import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../specs/baseTest';

/**
 * Component for VS Code Command Palette interactions.
 */
export class CommandPalette {
	constructor(private readonly page: Page) {}

	/**
	 * Get the command palette input field
	 */
	get input(): Locator {
		return this.page.locator('.quick-input-box input');
	}

	/**
	 * Get the results list
	 */
	get results(): Locator {
		return this.page.locator('.quick-input-list .quick-input-list-row');
	}

	/**
	 * Get the first result
	 */
	get firstResult(): Locator {
		return this.results.first();
	}

	/**
	 * Get the quick input widget (container for command palette)
	 */
	get widget(): Locator {
		return this.page.locator('.quick-input-widget');
	}

	/**
	 * Check if the command palette is open
	 */
	async isOpen(): Promise<boolean> {
		return this.widget.isVisible();
	}

	/**
	 * Open the command palette
	 */
	async open(): Promise<void> {
		// Ensure any previous quick input is closed first
		if (await this.isOpen()) {
			await this.page.keyboard.press('Escape');
			await this.widget.waitFor({ state: 'hidden', timeout: MaxTimeout });
		}
		await this.page.keyboard.press('Control+Shift+P');
		await this.input.waitFor({ state: 'visible', timeout: MaxTimeout });
	}

	/**
	 * Close the command palette
	 */
	async close(): Promise<void> {
		if (await this.isOpen()) {
			await this.page.keyboard.press('Escape');
			await this.widget.waitFor({ state: 'hidden', timeout: MaxTimeout });
		}
	}

	/**
	 * Type into the command palette
	 */
	async type(text: string): Promise<void> {
		await this.input.fill(text);
	}

	/**
	 * Execute a command by name with retry logic
	 */
	async execute(command: string, maxRetries = 3): Promise<void> {
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			await this.open();
			await this.type(`> ${command}`);

			// Wait for results to populate
			await this.firstResult.waitFor({ state: 'visible', timeout: MaxTimeout });
			await this.page.waitForTimeout(300); // Brief wait for results to settle

			const firstResultText = await this.firstResult.textContent();
			if (firstResultText === command) {
				await this.input.press('Enter');
				// Wait for command palette to close completely
				await this.widget.waitFor({ state: 'hidden', timeout: MaxTimeout });
				// Give the command time to execute and UI to settle
				await this.page.waitForTimeout(500);
				return;
			}

			// Close palette and retry
			await this.close();
			await this.page.waitForTimeout(200);
		}

		throw new Error(`Command "${command}" not found in command palette after ${maxRetries} attempts`);
	}

	/**
	 * Quick open a file by name
	 */
	async quickOpen(filename: string): Promise<void> {
		await this.page.keyboard.press('Control+P');
		await this.input.waitFor({ state: 'visible', timeout: MaxTimeout });
		await this.type(filename);
		await this.firstResult.waitFor({ state: 'visible', timeout: MaxTimeout });
		await this.input.press('Enter');
	}
}
