export function parseSummarizeResult(result: string): { readonly summary: string; readonly body: string } {
	result = result.trim();
	const summary = result.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/)?.[1]?.trim() ?? undefined;
	if (summary != null) {
		result = result.replace(/<summary>[\s\S]*?(?:<\/summary>|$)/, '').trim();
	}

	let body = result.match(/<body>([\s\S]*?)(?:<\/body>|$)/)?.[1]?.trim() ?? undefined;
	if (body != null) {
		result = result.replace(/<body>[\s\S]*?(?:<\/body>|$)/, '').trim();
	}

	// Check for self-closing body tag
	if (body == null && result.includes('<body/>')) {
		body = '';
	}

	// If both tags are present, return them
	if (summary != null && body != null) return { summary: summary, body: body };

	// If both tags are missing, split the result
	if (summary == null && body == null) return splitMessageIntoSummaryAndBody(result);

	// If only summary tag is present, use any remaining text as the body
	if (summary && body == null) {
		return result ? { summary: summary, body: result } : splitMessageIntoSummaryAndBody(summary);
	}

	// If only body tag is present, use the remaining text as the summary
	if (summary == null && body) {
		return result ? { summary: result, body: body } : splitMessageIntoSummaryAndBody(body);
	}

	return { summary: summary ?? '', body: body ?? '' };
}
export function splitMessageIntoSummaryAndBody(message: string): { readonly summary: string; readonly body: string } {
	message = message.replace(/```([\s\S]*?)```/, '$1').trim();
	const index = message.indexOf('\n');
	if (index === -1) return { summary: message, body: '' };

	return {
		summary: message.substring(0, index).trim(),
		body: message.substring(index + 1).trim(),
	};
}
