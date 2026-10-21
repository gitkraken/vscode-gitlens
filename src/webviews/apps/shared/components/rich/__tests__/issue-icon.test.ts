import * as assert from 'node:assert';
import type { TemplateResult } from 'lit';
import { IssueIcon } from '../issue-icon.js';

suite('Unclassified issue icon', () => {
	for (const previousState of [undefined, 'opened', 'closed'] as const) {
		test(`keeps a generic text alternative after ${previousState ?? 'an initial unknown state'}`, () => {
			const icon = new IssueIcon();
			icon.state = previousState;
			icon.render();
			icon.state = undefined;

			const template = icon.render() as TemplateResult;
			const labelBinding = template.strings.findIndex(part => part.endsWith('aria-label='));
			assert.notStrictEqual(labelBinding, -1);
			assert.strictEqual(template.values[labelBinding], icon.label);
		});
	}
});
