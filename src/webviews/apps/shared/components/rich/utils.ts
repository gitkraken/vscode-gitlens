export function getAutolinkIcon(
	type: 'autolink' | 'issue' | 'pr' = 'autolink',
	status: 'opened' | 'closed' | 'merged' = 'merged',
): { icon: string; modifier: string } {
	let icon;
	let state;
	switch (type) {
		case 'issue':
			state = status === 'closed' ? 'merged' : 'opened';
			icon = status === 'closed' ? 'pass' : 'issues';
			break;
		case 'pr':
			state = status;
			switch (status) {
				case 'merged':
					icon = 'git-merge';
					break;
				case 'closed':
					icon = 'git-pull-request-closed';
					break;
				case 'opened':
				default:
					icon = 'git-pull-request';
					break;
			}
			break;
		case 'autolink':
		default:
			state = 'opened';
			icon = 'link';
			break;
	}

	return { icon: icon, modifier: state };
}
