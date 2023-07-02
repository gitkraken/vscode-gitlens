import { fromNow } from '../../../../../system/date';

export function fromDateRange(date: Date, startDate = new Date()) {
	const seconds = Math.floor((startDate.getTime() - date.getTime()) / 1000);
	let status = 'ok';
	if (Math.floor(seconds / 31536000) >= 1) {
		status = 'danger';
	} else if (Math.floor(seconds / 2592000) >= 1) {
		status = 'danger';
	} else if (Math.floor(seconds / 604800) >= 1) {
		status = 'danger';
	} else if (Math.floor(seconds / 86400) >= 1) {
		status = 'warning';
	}

	return {
		label: fromNow(date, true),
		tooltip: fromNow(date),
		status: status,
	};
}
