import {
  DataQualityDimension,
  DataQualityPriority,
  DataQualitySeverity,
} from '@prisma/client';

const MISSING_VALUES = new Set(['', 'null', 'nil', 'none', 'n/a', 'na', 'undefined', '-']);
const DQ_DIMENSIONS: DataQualityDimension[] = [
  DataQualityDimension.completeness,
  DataQualityDimension.accuracy,
  DataQualityDimension.validity,
  DataQualityDimension.consistency,
  DataQualityDimension.timeliness,
  DataQualityDimension.uniqueness,
];

const PRIORITY_BY_SEVERITY: Record<DataQualitySeverity, DataQualityPriority> = {
  [DataQualitySeverity.critical]: DataQualityPriority.P1,
  [DataQualitySeverity.high]: DataQualityPriority.P2,
  [DataQualitySeverity.medium]: DataQualityPriority.P3,
  [DataQualitySeverity.low]: DataQualityPriority.P4,
};

export type ProfilingSemanticType =
  | 'identifier'
  | 'national_id'
  | 'email'
  | 'phone'
  | 'url'
  | 'date'
  | 'amount'
  | 'number'
  | 'boolean'
  | 'code'
  | 'category'
  | 'text';

export interface ProfilingColumnReport {
  columnName: string;
  dataType: string;
  semanticType: ProfilingSemanticType;
  completenessPct: number;
  uniquenessPct: number;
  validityPct: number;
  consistencyPct: number;
  accuracyPct: number;
  timelinessPct: number;
  score: number;
  pattern: string | null;
  anomalyCount: number;
  recommendation: string | null;
  dimension: DataQualityDimension | null;
  severity: DataQualitySeverity;
  stats: {
    rowCount: number;
    nullCount: number;
    nonNullCount: number;
    distinctCount: number;
    duplicateCount: number;
    invalidCount: number;
    outlierCount: number;
    rarePatternCount: number;
    min?: number | string;
    max?: number | string;
    mean?: number;
    standardDeviation?: number;
    minLength?: number;
    maxLength?: number;
    topValues: { value: string; count: number; pct: number }[];
    patternFrequencies: { pattern: string; count: number; pct: number }[];
  };
}

export interface ProfilingRuleRecommendation {
  id: string;
  columnName: string;
  dimension: DataQualityDimension;
  severity: DataQualitySeverity;
  priority: DataQualityPriority;
  confidence: number;
  titleEn: string;
  titleAr: string;
  thresholdExpression: string;
  reason: string;
  definitionJson: Record<string, unknown>;
}

export interface ProfilingIssueRecommendation {
  columnName: string;
  title: string;
  description: string;
  dimension: DataQualityDimension;
  severity: DataQualitySeverity;
  priority: DataQualityPriority;
  anomalyCount: number;
}

export interface ProfilingRelationship {
  sourceColumn: string;
  targetDataset?: string;
  targetColumn: string;
  relationshipType: 'candidate_key' | 'lookup' | 'functional_dependency' | 'referential_overlap';
  overlapPct?: number;
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:M';
  confidence: number;
  suggestedAction: string;
}

export interface ProfilingRunReport {
  datasetName: string;
  rowCount: number;
  columnCount: number;
  qualityScore: number;
  anomalyCount: number;
  recommendedRules: number;
  columns: ProfilingColumnReport[];
  dimensionScores: Record<DataQualityDimension, { score: number; totalChecks: number; failedChecks: number }>;
  recommendations: ProfilingRuleRecommendation[];
  issueRecommendations: ProfilingIssueRecommendation[];
  relationships: ProfilingRelationship[];
  crossColumnFindings: ProfilingRelationship[];
  summary: {
    engine: 'native_csv_profiler';
    profileDepth: 'column_cross_column_cross_table';
    strongestDimension: DataQualityDimension | null;
    weakestDimension: DataQualityDimension | null;
    criticalColumns: number;
    generatedAt: string;
  };
}

export interface RelatedProfilingDataset {
  name: string;
  rows: Record<string, string>[];
}

function isMissing(value: unknown): boolean {
  return MISSING_VALUES.has(String(value ?? '').trim().toLowerCase());
}

function pct(part: number, total: number, emptyValue = 0): number {
  if (total <= 0) return emptyValue;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function topEntries(values: string[], limit = 5): { value: string; count: number; pct: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count, pct: pct(count, values.length) }));
}

function maskPattern(value: string): string {
  return value
    .trim()
    .split('')
    .map((ch) => {
      if (/[A-Za-z]/.test(ch)) return 'A';
      if (/[0-9]/.test(ch)) return 'N';
      if (/\s/.test(ch)) return '_';
      return 'S';
    })
    .join('');
}

function toNumber(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const looksLikeDate =
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(trimmed) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(trimmed);
  if (!looksLikeDate) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function inferSemanticType(columnName: string, values: string[]): ProfilingSemanticType {
  const name = columnName.toLowerCase();
  if (!values.length) return 'text';
  const total = values.length;
  const email = values.filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).length;
  const url = values.filter((value) => /^https?:\/\//i.test(value)).length;
  const nationalId = values.filter((value) => /^\d{10}$/.test(value.replace(/\D/g, ''))).length;
  const phone = values.filter((value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }).length;
  const dates = values.filter((value) => !!toDate(value)).length;
  const numbers = values.filter((value) => toNumber(value) !== null).length;
  const booleans = values.filter((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value.trim())).length;
  const distinct = new Set(values).size;
  const ratio = (count: number) => count / total;

  if (name.includes('email') || ratio(email) >= 0.8) return 'email';
  if (name.includes('national') || name.includes('nid') || name.includes('iqama') || ratio(nationalId) >= 0.9) return 'national_id';
  if (name.includes('url') || name.includes('link') || ratio(url) >= 0.8) return 'url';
  if (name.includes('date') || name.endsWith('_at') || ratio(dates) >= 0.85) return 'date';
  if (name.includes('phone') || name.includes('mobile') || ratio(phone) >= 0.9) return 'phone';
  if (name.includes('amount') || name.includes('balance') || name.includes('price') || name.includes('cost')) return 'amount';
  if (name.endsWith('id') || name.endsWith('_id') || name.includes('identifier')) return 'identifier';
  if (name.includes('code') || name.includes('status') || name.includes('type')) return 'code';
  if (ratio(booleans) >= 0.9) return 'boolean';
  if (ratio(numbers) >= 0.9) return 'number';
  if (distinct <= Math.max(5, Math.ceil(total * 0.2))) return 'category';
  return 'text';
}

function inferDataType(semanticType: ProfilingSemanticType, values: string[]): string {
  if (semanticType === 'date') return 'date';
  if (semanticType === 'boolean') return 'boolean';
  const numericCount = values.filter((value) => toNumber(value) !== null).length;
  if (values.length && numericCount / values.length >= 0.9) {
    return values.every((value) => /^-?\d+$/.test(value.replace(/,/g, '').trim())) ? 'integer' : 'decimal';
  }
  return 'string';
}

function validityFor(semanticType: ProfilingSemanticType, values: string[], dominantPattern: string | null): number {
  if (!values.length) return 0;
  let valid = values.length;
  if (semanticType === 'email') valid = values.filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).length;
  if (semanticType === 'national_id') valid = values.filter((value) => /^\d{10}$/.test(value.replace(/\D/g, ''))).length;
  if (semanticType === 'phone') valid = values.filter((value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }).length;
  if (semanticType === 'url') valid = values.filter((value) => /^https?:\/\//i.test(value)).length;
  if (semanticType === 'date') valid = values.filter((value) => !!toDate(value)).length;
  if (semanticType === 'amount' || semanticType === 'number') valid = values.filter((value) => toNumber(value) !== null).length;
  if (semanticType === 'boolean') valid = values.filter((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value.trim())).length;
  if (semanticType === 'identifier' && dominantPattern) {
    valid = values.filter((value) => maskPattern(value) === dominantPattern).length;
  }
  return pct(valid, values.length);
}

function severityFor(score: number, anomalyRatio: number): DataQualitySeverity {
  if (score < 60 || anomalyRatio >= 0.35) return DataQualitySeverity.critical;
  if (score < 75 || anomalyRatio >= 0.2) return DataQualitySeverity.high;
  if (score < 90 || anomalyRatio >= 0.05) return DataQualitySeverity.medium;
  return DataQualitySeverity.low;
}

function weakestDimension(column: {
  completenessPct: number;
  uniquenessPct: number;
  validityPct: number;
  consistencyPct: number;
  accuracyPct: number;
  timelinessPct: number;
}): DataQualityDimension | null {
  const scores: [DataQualityDimension, number][] = [
    [DataQualityDimension.completeness, column.completenessPct],
    [DataQualityDimension.accuracy, column.accuracyPct],
    [DataQualityDimension.validity, column.validityPct],
    [DataQualityDimension.consistency, column.consistencyPct],
    [DataQualityDimension.timeliness, column.timelinessPct],
    [DataQualityDimension.uniqueness, column.uniquenessPct],
  ];
  const [dimension, score] = scores.sort((a, b) => a[1] - b[1])[0];
  return score < 95 ? dimension : null;
}

function recommendationFor(column: ProfilingColumnReport): string | null {
  if (column.completenessPct < 95) {
    return `Create a completeness rule for ${column.columnName}; ${column.stats.nullCount} values are missing.`;
  }
  if (column.validityPct < 95) {
    return `Create a ${column.semanticType} format validation rule for ${column.columnName}.`;
  }
  if (column.semanticType === 'identifier' || column.semanticType === 'national_id') {
    if (column.uniquenessPct < 98) return `Create a uniqueness rule for ${column.columnName}.`;
  }
  if (column.stats.outlierCount > 0) {
    return `Create an accuracy outlier review rule for ${column.columnName}.`;
  }
  if (column.consistencyPct < 95) {
    return `Create a pattern consistency rule for ${column.columnName}.`;
  }
  if (column.timelinessPct < 95) {
    return `Create a timeliness rule for ${column.columnName}.`;
  }
  return null;
}

function ruleRecommendation(column: ProfilingColumnReport, index: number): ProfilingRuleRecommendation | null {
  if (!column.recommendation || !column.dimension) return null;
  const dimension = column.dimension;
  const severity = column.severity;
  const threshold =
    dimension === DataQualityDimension.completeness ? `${column.columnName}.completeness >= 95%` :
    dimension === DataQualityDimension.uniqueness ? `${column.columnName}.uniqueness >= 98%` :
    dimension === DataQualityDimension.timeliness ? `${column.columnName}.date is current and not future` :
    dimension === DataQualityDimension.accuracy ? `${column.columnName}.outliers <= 0` :
    `${column.columnName}.validity >= 95%`;
  return {
    id: `profile-rec-${index + 1}`,
    columnName: column.columnName,
    dimension,
    severity,
    priority: PRIORITY_BY_SEVERITY[severity],
    confidence: Math.max(50, Math.min(99, 100 - column.score + column.anomalyCount)),
    titleEn: `${column.columnName} ${dimension} rule`,
    titleAr: `${column.columnName} - قاعدة ${dimension}`,
    thresholdExpression: threshold,
    reason: column.recommendation,
    definitionJson: {
      source: 'profiling_engine',
      semanticType: column.semanticType,
      pattern: column.pattern,
      statistics: column.stats,
      dimension,
    },
  };
}

function issueRecommendation(column: ProfilingColumnReport): ProfilingIssueRecommendation | null {
  if (!column.dimension || column.severity === DataQualitySeverity.low) return null;
  return {
    columnName: column.columnName,
    title: `Profiling anomaly in ${column.columnName}`,
    description: `${column.recommendation ?? 'Profiling detected a threshold breach.'} Score: ${column.score}%.`,
    dimension: column.dimension,
    severity: column.severity,
    priority: PRIORITY_BY_SEVERITY[column.severity],
    anomalyCount: column.anomalyCount,
  };
}

function profileColumn(columnName: string, rows: Record<string, string>[]): ProfilingColumnReport {
  const rowCount = rows.length;
  const rawValues = rows.map((row) => String(row[columnName] ?? ''));
  const values = rawValues.map((value) => value.trim()).filter((value) => !isMissing(value));
  const nullCount = rowCount - values.length;
  const distinctCount = new Set(values).size;
  const duplicateCount = Math.max(0, values.length - distinctCount);
  const topValues = topEntries(values);
  const patterns = values.map(maskPattern);
  const patternFrequencies = topEntries(patterns).map((entry) => ({
    pattern: entry.value,
    count: entry.count,
    pct: entry.pct,
  }));
  const dominantPattern = patternFrequencies[0]?.pattern ?? null;
  const semanticType = inferSemanticType(columnName, values);
  const dataType = inferDataType(semanticType, values);
  const patternSensitive =
    ['identifier', 'national_id', 'phone'].includes(semanticType) ||
    (semanticType === 'code' && columnName.toLowerCase().includes('code'));
  const completenessPct = pct(values.length, rowCount);
  const uniquenessPct = ['identifier', 'national_id', 'email', 'phone', 'url'].includes(semanticType)
    ? pct(distinctCount, values.length, 100)
    : 100;
  const validityPct = validityFor(semanticType, values, dominantPattern);
  const rarePatternCount = dominantPattern
    ? patterns.filter((pattern) => pattern !== dominantPattern).length
    : 0;
  const consistencyPct = dominantPattern && patternSensitive
    ? pct(values.length - rarePatternCount, values.length, 100)
    : 100;
  const numericValues = values.map(toNumber).filter((value): value is number => value !== null);
  const mean = numericValues.length
    ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
    : 0;
  const deviation = standardDeviation(numericValues, mean);
  const outlierCount = deviation > 0
    ? numericValues.filter((value) => Math.abs(value - mean) > deviation * 3).length
    : 0;
  const accuracyPct = numericValues.length ? pct(numericValues.length - outlierCount, numericValues.length, 100) : 100;
  const dateValues = values.map(toDate).filter((value): value is Date => value !== null);
  const futureDates = dateValues.filter((value) => value.getTime() > Date.now()).length;
  const timelinessPct = semanticType === 'date' ? pct(dateValues.length - futureDates, dateValues.length, 100) : 100;
  const invalidCount = values.length - Math.round((validityPct / 100) * values.length);
  const anomalyCount = nullCount + invalidCount + outlierCount + (consistencyPct < 95 ? rarePatternCount : 0) + futureDates;
  const score = Math.round((completenessPct + uniquenessPct + validityPct + consistencyPct + accuracyPct + timelinessPct) / 6);
  const severity = severityFor(score, rowCount ? anomalyCount / rowCount : 0);
  const dimension = weakestDimension({ completenessPct, uniquenessPct, validityPct, consistencyPct, accuracyPct, timelinessPct });
  const lengths = values.map((value) => value.length);
  const sortedValues = [...values].sort();
  const stats: ProfilingColumnReport['stats'] = {
    rowCount,
    nullCount,
    nonNullCount: values.length,
    distinctCount,
    duplicateCount,
    invalidCount,
    outlierCount,
    rarePatternCount,
    topValues,
    patternFrequencies,
  };
  if (numericValues.length) {
    stats.min = Math.min(...numericValues);
    stats.max = Math.max(...numericValues);
    stats.mean = round(mean);
    stats.standardDeviation = round(deviation);
  } else if (sortedValues.length) {
    stats.min = sortedValues[0];
    stats.max = sortedValues[sortedValues.length - 1];
  }
  if (lengths.length) {
    stats.minLength = Math.min(...lengths);
    stats.maxLength = Math.max(...lengths);
  }
  const report: ProfilingColumnReport = {
    columnName,
    dataType,
    semanticType,
    completenessPct,
    uniquenessPct,
    validityPct,
    consistencyPct,
    accuracyPct,
    timelinessPct,
    score,
    pattern: dominantPattern,
    anomalyCount,
    recommendation: null,
    dimension,
    severity,
    stats,
  };
  report.recommendation = recommendationFor(report);
  return report;
}

function discoverFunctionalDependencies(columns: ProfilingColumnReport[], rows: Record<string, string>[]): ProfilingRelationship[] {
  const findings: ProfilingRelationship[] = [];
  for (const source of columns) {
    for (const target of columns) {
      if (source.columnName === target.columnName) continue;
      const groups = new Map<string, Set<string>>();
      for (const row of rows) {
        const sourceValue = String(row[source.columnName] ?? '').trim();
        const targetValue = String(row[target.columnName] ?? '').trim();
        if (isMissing(sourceValue) || isMissing(targetValue)) continue;
        const set = groups.get(sourceValue) ?? new Set<string>();
        set.add(targetValue);
        groups.set(sourceValue, set);
      }
      if (groups.size < 3) continue;
      const deterministic = [...groups.values()].filter((set) => set.size === 1).length;
      const confidence = pct(deterministic, groups.size);
      if (confidence >= 95 && source.uniquenessPct < 98) {
        findings.push({
          sourceColumn: source.columnName,
          targetColumn: target.columnName,
          relationshipType: 'functional_dependency',
          cardinality: 'N:1',
          confidence,
          suggestedAction: `Validate ${target.columnName} when ${source.columnName} changes.`,
        });
      }
    }
  }
  return findings.slice(0, 12);
}

function discoverCrossTableRelationships(
  columns: ProfilingColumnReport[],
  rows: Record<string, string>[],
  relatedDatasets: RelatedProfilingDataset[],
): ProfilingRelationship[] {
  const relationships: ProfilingRelationship[] = [];
  for (const source of columns) {
    const sourceValues = new Set(rows.map((row) => String(row[source.columnName] ?? '').trim()).filter((value) => !isMissing(value)));
    if (sourceValues.size < 3) continue;
    for (const dataset of relatedDatasets) {
      const targetColumns = Object.keys(dataset.rows[0] ?? {});
      for (const targetColumn of targetColumns) {
        const targetValues = new Set(dataset.rows.map((row) => String(row[targetColumn] ?? '').trim()).filter((value) => !isMissing(value)));
        if (targetValues.size < 3) continue;
        const overlap = [...sourceValues].filter((value) => targetValues.has(value)).length;
        const overlapPct = pct(overlap, sourceValues.size);
        if (overlapPct >= 70) {
          relationships.push({
            sourceColumn: source.columnName,
            targetDataset: dataset.name,
            targetColumn,
            relationshipType: overlapPct >= 95 ? 'referential_overlap' : 'lookup',
            overlapPct,
            cardinality: source.uniquenessPct >= 98 ? '1:N' : 'N:1',
            confidence: Math.min(99, overlapPct),
            suggestedAction: overlapPct >= 95
              ? `Create a formal relationship from ${source.columnName} to ${dataset.name}.${targetColumn}.`
              : `Create a referential gap rule for values missing from ${dataset.name}.${targetColumn}.`,
          });
        }
      }
    }
  }
  return relationships.slice(0, 16);
}

function dimensionScores(columns: ProfilingColumnReport[]): ProfilingRunReport['dimensionScores'] {
  const out = {} as ProfilingRunReport['dimensionScores'];
  for (const dimension of DQ_DIMENSIONS) {
    const values = columns.map((column) => {
      if (dimension === DataQualityDimension.completeness) return column.completenessPct;
      if (dimension === DataQualityDimension.accuracy) return column.accuracyPct;
      if (dimension === DataQualityDimension.validity) return column.validityPct;
      if (dimension === DataQualityDimension.consistency) return column.consistencyPct;
      if (dimension === DataQualityDimension.timeliness) return column.timelinessPct;
      return column.uniquenessPct;
    });
    const failedChecks = values.filter((score) => score < 95).length;
    out[dimension] = {
      score: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
      totalChecks: values.length,
      failedChecks,
    };
  }
  return out;
}

function isCandidateKeyColumn(column: ProfilingColumnReport): boolean {
  const name = column.columnName.toLowerCase();
  const identifierLike =
    ['identifier', 'national_id', 'email', 'phone', 'url'].includes(column.semanticType) ||
    name.endsWith('code') ||
    name.endsWith('_code');
  return (
    identifierLike &&
    column.completenessPct >= 95 &&
    column.uniquenessPct >= 98 &&
    column.stats.distinctCount === column.stats.nonNullCount &&
    column.stats.nonNullCount > 1
  );
}

export function profileCsvRows(
  rows: Record<string, string>[],
  options: { datasetName?: string; relatedDatasets?: RelatedProfilingDataset[] } = {},
): ProfilingRunReport {
  if (!rows.length) {
    throw new Error('Profiling requires at least one data row');
  }
  const columnNames = Object.keys(rows[0] ?? {});
  if (!columnNames.length) {
    throw new Error('Profiling requires at least one column');
  }
  const columns = columnNames.map((columnName) => profileColumn(columnName, rows));
  const dimensions = dimensionScores(columns);
  const qualityScore = Math.round(DQ_DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension].score, 0) / DQ_DIMENSIONS.length);
  const recommendations = columns
    .map((column, index) => ruleRecommendation(column, index))
    .filter((recommendation): recommendation is ProfilingRuleRecommendation => !!recommendation);
  const issueRecommendations = columns
    .map(issueRecommendation)
    .filter((recommendation): recommendation is ProfilingIssueRecommendation => !!recommendation)
    .slice(0, 10);
  const crossColumnFindings = discoverFunctionalDependencies(columns, rows);
  const relationships = [
    ...columns
      .filter(isCandidateKeyColumn)
      .map((column): ProfilingRelationship => ({
        sourceColumn: column.columnName,
        targetColumn: column.columnName,
        relationshipType: 'candidate_key',
        cardinality: '1:1',
        confidence: Math.min(column.uniquenessPct, column.completenessPct),
        suggestedAction: `Consider ${column.columnName} as a candidate key or business identifier.`,
      })),
    ...discoverCrossTableRelationships(columns, rows, options.relatedDatasets ?? []),
  ].slice(0, 20);
  const sortedDimensions = DQ_DIMENSIONS
    .map((dimension) => ({ dimension, score: dimensions[dimension].score }))
    .sort((a, b) => a.score - b.score);

  return {
    datasetName: options.datasetName?.trim() || 'Profiled dataset',
    rowCount: rows.length,
    columnCount: columnNames.length,
    qualityScore,
    anomalyCount: columns.reduce((sum, column) => sum + column.anomalyCount, 0),
    recommendedRules: recommendations.length,
    columns,
    dimensionScores: dimensions,
    recommendations,
    issueRecommendations,
    relationships,
    crossColumnFindings,
    summary: {
      engine: 'native_csv_profiler',
      profileDepth: 'column_cross_column_cross_table',
      strongestDimension: sortedDimensions[sortedDimensions.length - 1]?.dimension ?? null,
      weakestDimension: sortedDimensions[0]?.dimension ?? null,
      criticalColumns: columns.filter((column) => column.severity === DataQualitySeverity.critical).length,
      generatedAt: new Date().toISOString(),
    },
  };
}
