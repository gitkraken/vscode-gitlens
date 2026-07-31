import * as assert from 'assert';
import type { ConsultedTool } from '../consultation.js';
import { getConsultations, recordConsultation } from '../consultation.js';

suite('coretools/conflict/consultation', () => {
	test('records a consultation against the file it was made for', () => {
		const consultations = new Map<string, ConsultedTool[]>();

		recordConsultation(consultations, { filePath: 'a.ts', tool: 'grep', reason: 'is it still used?' });
		recordConsultation(consultations, { filePath: 'b.ts', tool: 'blame', reason: 'which side is newer?' });

		assert.deepStrictEqual(getConsultations(consultations, 'a.ts'), [
			{ tool: 'grep', reason: 'is it still used?' },
		]);
		assert.deepStrictEqual(getConsultations(consultations, 'b.ts'), [
			{ tool: 'blame', reason: 'which side is newer?' },
		]);
	});

	test('returns undefined for a file that consulted nothing', () => {
		// The common case — AI resolved from the conflict's own context. `undefined` is what makes the row
		// render nothing at all rather than an empty "Consulted" heading.
		assert.strictEqual(getConsultations(new Map(), 'a.ts'), undefined);
	});

	test('collapses a repeated tool+reason pair', () => {
		// Re-reading a file at a second ref repeats the same justification; two identical lines read as a
		// glitch rather than as thoroughness.
		const consultations = new Map<string, ConsultedTool[]>();

		recordConsultation(consultations, { filePath: 'a.ts', tool: 'show_file_at_ref', reason: 'see the whole file' });
		recordConsultation(consultations, { filePath: 'a.ts', tool: 'show_file_at_ref', reason: 'see the whole file' });

		assert.strictEqual(getConsultations(consultations, 'a.ts')?.length, 1);
	});

	test('keeps distinct reasons for the same tool', () => {
		const consultations = new Map<string, ConsultedTool[]>();

		recordConsultation(consultations, { filePath: 'a.ts', tool: 'grep', reason: 'is useTimeout used?' });
		recordConsultation(consultations, { filePath: 'a.ts', tool: 'grep', reason: 'is retryCount used?' });

		assert.strictEqual(getConsultations(consultations, 'a.ts')?.length, 2);
	});

	test('omits an absent or blank reason rather than storing an empty string', () => {
		// `reason` is a required tool argument, but the model is what fills it in — a missing one must
		// leave the field off so the renderer falls back to the tool label.
		const consultations = new Map<string, ConsultedTool[]>();

		recordConsultation(consultations, { filePath: 'a.ts', tool: 'log' });
		recordConsultation(consultations, { filePath: 'b.ts', tool: 'log', reason: '   ' });

		assert.deepStrictEqual(getConsultations(consultations, 'a.ts'), [{ tool: 'log' }]);
		assert.deepStrictEqual(getConsultations(consultations, 'b.ts'), [{ tool: 'log' }]);
	});

	test('caps the list so a long agentic loop can’t grow an unbounded row', () => {
		// A resolution can spend up to `maxSteps` rounds calling several tools each. The earliest calls are
		// the ones that shaped the decision, so the tail is what gets dropped.
		const consultations = new Map<string, ConsultedTool[]>();
		for (let i = 0; i < 40; i++) {
			recordConsultation(consultations, { filePath: 'a.ts', tool: 'grep', reason: `reason ${i}` });
		}

		const consulted = getConsultations(consultations, 'a.ts');
		assert.strictEqual(consulted?.length, 8);
		assert.strictEqual(consulted[0].reason, 'reason 0', 'the earliest calls are the ones kept');
	});
});
