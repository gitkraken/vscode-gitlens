export type ResourceUsageUnit = 'bytes' | 'count';
export type ResourceUsageMetric = `${string}.${ResourceUsageUnit}`;

/** A flat resource-usage snapshot whose metric names carry their units. */
export type ResourceUsage = Partial<Record<ResourceUsageMetric, number>>;
