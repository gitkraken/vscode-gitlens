/** not sure about file location. I thought about git/formatters, or git/utils */

/**
 * use `\n` symbol is presented to split commit message to description and title
 */
export function splitGitCommitMessage(commitMessage?: string) {
	if (!commitMessage) {
		return {
			title: '',
		};
	}
	const message = commitMessage.trim();
	const index = message.indexOf('\n');
	if (index < 0) {
		return {
			title: message,
		};
	}
	return {
		title: message.substring(0, index),
		description: message.substring(index + 1).trim(),
	};
}
