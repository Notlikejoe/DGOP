-- Add execution-monitor terminal/control states required by the v5.1 Workflow Canvas API.
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'failed';
