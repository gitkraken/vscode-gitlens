export function isAiAllAccessPromotionActive(): boolean {
	// AI All Access promotion runs from July 8th through July 12th, 2025
	const now = Date.now();
	const startDate = new Date('2025-07-07T23:59:59-00:00').getTime(); // July 8th, 2025 UTC
	const endDate = new Date('2025-07-12T10:00:00-00:00').getTime(); // July 12th, 2025 UTC

	return now >= startDate && now <= endDate;
}
