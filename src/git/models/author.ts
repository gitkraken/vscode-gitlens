'use strict';
export interface Account {
	provider: string;
	name: string | undefined;
	email: string | undefined;
	avatarUrl: string;
}
