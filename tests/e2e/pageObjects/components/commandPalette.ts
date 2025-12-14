import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../baseTest';
import type { VSCodePage } from '../vscodePage';

/**
 * Component for VS Code Command Palette interactions.
 */
export class CommandPalette {
	constructor(
		private readonly vscode: VSCodePage,
		private readonly page: Page,
	) {}

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

	async isOpen(): Promise<boolean> {
		return this.widget.isVisible();
	}

	async open(): Promise<void> {
		// Ensure any previous quick input is closed first
		if (await this.isOpen()) {
			await this.page.keyboard.press('Escape');
			await this.widget.waitFor({ state: 'hidden', timeout: MaxTimeout });
		}

		await this.page.keyboard.press('Control+Shift+P');
		try {
			await this.input.waitFor({ state: 'visible', timeout: 2000 });
		} catch {
			// Retry once if it failed to open
			await this.page.keyboard.press('Control+Shift+P');
			await this.input.waitFor({ state: 'visible', timeout: MaxTimeout });
		}
	}

	async close(): Promise<void> {
		if (await this.isOpen()) {
			await this.page.keyboard.press('Escape');
			await this.widget.waitFor({ state: 'hidden', timeout: MaxTimeout });
		}
	}

	/** Type into the command palette */
	async fill(text: string): Promise<void> {
		await this.input.fill(text);
	}

	/** Execute a command by exact name with retry logic */
	async execute(command: string, maxRetries = 3): Promise<void> {
		await this.paletteCore('command', command, false, maxRetries);
	}

	/** Quick open a file by name */
	async openFile(filename: string): Promise<void> {
		await this.paletteCore('file', filename, true);
	}

	private async paletteCore(type: 'command' | 'file', text: string, fuzzy: boolean, maxRetries = 3): Promise<void> {
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				await this.open();

				// Ensure input is still visible before filling (palette can close unexpectedly)
				await this.input.waitFor({ state: 'visible', timeout: 2000 });
				await this.fill(type === 'command' ? `> ${text}` : text);

				// Wait for results to populate
				await this.firstResult.waitFor({ state: 'visible', timeout: MaxTimeout });
				await this.page.waitForTimeout(300); // Brief wait for results to settle

				const firstResultText = await this.firstResult.textContent();
				// Check if the result matches the command name exactly
				if ((!fuzzy && firstResultText === text) || (fuzzy && firstResultText?.includes(text))) {
					await this.input.press('Enter');
					// Wait for command palette to close completely
					await this.widget.waitFor({ state: 'hidden', timeout: MaxTimeout });
					// Give the command time to execute and UI to settle
					await this.page.waitForTimeout(1000);
					return;
				}

				// Close palette and retry
				await this.close();
				await this.page.waitForTimeout(500);
			} catch (ex) {
				// If anything fails (e.g., palette closed unexpectedly), close and retry
				await this.close().catch(() => {});
				await this.page.waitForTimeout(500);
				if (attempt === maxRetries - 1) {
					throw ex;
				}
			}
		}

		const firstResultText = (await this.firstResult.isVisible())
			? await this.firstResult.textContent()
			: 'No result visible';
		throw new Error(
			`${
				type === 'command' ? 'Command' : 'File'
			} "${text}" not found in command palette after ${maxRetries} attempts. First result: "${firstResultText}"`,
		);
	}
}
