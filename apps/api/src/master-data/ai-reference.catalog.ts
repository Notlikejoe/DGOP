// FD §7.2–7.3. Adoption aliases resolve to canonical concepts without duplicate lists.
export const AI_REFERENCE_ALIASES: Readonly<Record<string,string>> = {
  L_YN:'R_YN', L_TIER:'R_SDAIA_TIER', L_TIER_SCORE:'R_SDAIA_SCORE', L_FUNCTIONS:'R_DEPT',
};
export const AI_REFERENCE_CODES = [
  'L_HUMAN','L_STAGE','L_MODEL','L_AVAIL','L_YN','L_CLASS','L_BUDGET','L_COMPLETENESS','L_DECISION',
  'L_TIER','L_TIER_SCORE','L_STREAMS','L_PROGRAMS','L_FUNCTIONS',
  'R_DEPT','R_TECH','R_LIFECYCLE','R_YN','R_RELIANCE','R_HITL','R_UCSTATUS','R_RISKCAT',
  'R_CTRLEFF','R_STRATEGY','R_TREATSTATUS','R_ACTTYPE','R_PRIORITY','R_LEVEL','R_SCORE14',
  'R_IMPD','R_CADENCE','R_SDAIA_TIER','R_MINSCORE','R_LEVEL_DAYS','R_ETHICS','R_SDAIA_SCORE',
  'R_SOURCE','R_INTENT','R_TIMING','R_CATMAP',
] as const;
export const AI_REGULATORY_LISTS = new Set(['R_ETHICS','R_RISKCAT','R_SDAIA_TIER','R_LEVEL_DAYS','R_MINSCORE']);
export function canonicalAiReference(code:string): string {
  if (!(AI_REFERENCE_CODES as readonly string[]).includes(code)) throw new Error('Unknown AI reference list');
  return AI_REFERENCE_ALIASES[code] ?? code;
}
