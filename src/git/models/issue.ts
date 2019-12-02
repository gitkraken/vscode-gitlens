'use strict';

export interface Issue {
	id: number;
	date: Date;
	title: string;
	closed: boolean;
	closedDate?: Date;
}
