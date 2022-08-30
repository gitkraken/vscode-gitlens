export interface GitUser {
	name: string | undefined;
	email: string | undefined;

	id?: string | undefined;
	username?: string | undefined;
}

export function isUserMatch(
	user: GitUser | undefined,
	name: string | undefined,
	email: string | undefined,
	username?: string | undefined,
): boolean {
	return (
		user != null &&
		// Name or e-mail is provided
		(user.name != null || user.email != null || user.username != null) &&
		// Match on name if provided
		(user.name == null || user.name === name) &&
		// Match on email if provided
		(user.email == null || user.email === email) &&
		// Match on username if provided
		(user.username == null || user.username === username)
	);
}
