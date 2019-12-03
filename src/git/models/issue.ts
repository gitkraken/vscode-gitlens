'use strict';

export interface Issue {
	provider: string;
	id: number;
	date: Date;
	title: string;
	closed: boolean;
	closedDate?: Date;
}
