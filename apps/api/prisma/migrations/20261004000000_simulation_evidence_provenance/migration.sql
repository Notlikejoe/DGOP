-- Historical simulated portal publications cannot be operational compliance
-- proof, even where an independent evidence decision previously approved them.
-- Keep the decision and file lineage; flag the provenance for review.
UPDATE ndi_evidence AS evidence
SET provenance = 'generated_simulation',
    "reviewComment" = COALESCE(evidence."reviewComment", '') || E'\nSimulation provenance correction: operational credit excluded; review required.',
    "updatedAt" = NOW()
FROM open_data_publications AS publication
WHERE publication."evidenceId" = evidence.id
  AND publication."syncStatus" = 'simulated'
  AND evidence.provenance = 'operational';
