CREATE TYPE "WorkflowDelegationStatus" AS ENUM ('pending', 'active', 'paused', 'expired', 'revoked');
CREATE TYPE "WorkflowAttachmentKind" AS ENUM ('evidence', 'decision_note', 'supporting_document');
CREATE TYPE "WorkflowSlaBreachPolicy" AS ENUM ('notify', 'escalate', 'block');
CREATE TYPE "GovernanceNotificationChannel" AS ENUM ('in_app', 'email', 'sms', 'teams', 'webhook');
CREATE TYPE "GovernanceNotificationDeliveryStatus" AS ENUM ('planned', 'sent', 'failed', 'skipped');
CREATE TYPE "GovernanceLifecycleStatus" AS ENUM ('draft', 'active', 'under_review', 'approved', 'retired');
CREATE TYPE "GovernancePolicyLevel" AS ENUM ('principle', 'policy', 'standard', 'procedure', 'guideline');
CREATE TYPE "GovernanceMaturityDimension" AS ENUM ('operating_model', 'people_capability', 'process_controls', 'technology_evidence');
CREATE TYPE "GovernanceCouncilMemberRole" AS ENUM ('lead_steward', 'business_steward', 'technical_steward', 'privacy_steward', 'executive_sponsor');

CREATE TABLE "workflow_delegations" (
  "id" TEXT NOT NULL,
  "delegatorUserId" TEXT NOT NULL,
  "delegateUserId" TEXT NOT NULL,
  "roleCode" TEXT NOT NULL,
  "assetId" TEXT,
  "reason" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "WorkflowDelegationStatus" NOT NULL DEFAULT 'active',
  "approvedBy" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_delegations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_task_comments" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "taskId" TEXT,
  "body" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'internal',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_task_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_task_attachments" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "taskId" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "storageUrl" TEXT NOT NULL,
  "checksum" TEXT,
  "sizeBytes" INTEGER,
  "kind" "WorkflowAttachmentKind" NOT NULL DEFAULT 'evidence',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_task_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_sla_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "caseType" TEXT NOT NULL,
  "stageKind" TEXT,
  "targetBusinessDays" INTEGER NOT NULL,
  "warningAtPercent" INTEGER NOT NULL DEFAULT 50,
  "escalationAtPercent" INTEGER NOT NULL DEFAULT 80,
  "breachPolicy" "WorkflowSlaBreachPolicy" NOT NULL DEFAULT 'escalate',
  "targetRoleCode" TEXT,
  "calendarCode" TEXT NOT NULL DEFAULT 'ksa_business',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_sla_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_notification_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceType" TEXT,
  "titleTemplate" TEXT NOT NULL,
  "messageTemplate" TEXT NOT NULL,
  "severity" "GovernanceNotificationSeverity" NOT NULL DEFAULT 'info',
  "defaultChannelsJson" JSONB,
  "digestCadence" TEXT NOT NULL DEFAULT 'immediate',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_notification_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "roleCode" TEXT,
  "channel" "GovernanceNotificationChannel" NOT NULL,
  "minimumSeverity" "GovernanceNotificationSeverity" NOT NULL DEFAULT 'info',
  "digestCadence" TEXT NOT NULL DEFAULT 'immediate',
  "quietHoursJson" JSONB,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_notification_delivery_attempts" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" "GovernanceNotificationChannel" NOT NULL,
  "status" "GovernanceNotificationDeliveryStatus" NOT NULL DEFAULT 'planned',
  "provider" TEXT,
  "target" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_notification_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "searchable_object_registry" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "routeTemplate" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "fieldsJson" JSONB NOT NULL,
  "rankWeight" INTEGER NOT NULL DEFAULT 50,
  "indexStrategy" TEXT NOT NULL DEFAULT 'database',
  "includeInAutocomplete" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "searchable_object_registry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "search_index_records" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "keywords" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "permission" TEXT,
  "contentHash" TEXT,
  "visibilityJson" JSONB,
  "lastIndexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "search_index_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_searches" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "filtersJson" JSONB,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "search_analytics_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "query" TEXT NOT NULL,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "selectedEntityType" TEXT,
  "selectedEntityId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'global_search',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "search_analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_charters" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "purpose" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "eightElementsJson" JSONB NOT NULL,
  "sponsorRoleCode" TEXT,
  "ownerRoleCode" TEXT,
  "status" "GovernanceLifecycleStatus" NOT NULL DEFAULT 'draft',
  "reviewDueAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_charters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_policies" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "titleEn" TEXT NOT NULL,
  "titleAr" TEXT,
  "level" "GovernancePolicyLevel" NOT NULL,
  "parentCode" TEXT,
  "domainId" TEXT,
  "ownerRoleCode" TEXT,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "status" "GovernanceLifecycleStatus" NOT NULL DEFAULT 'draft',
  "effectiveAt" TIMESTAMP(3),
  "reviewDueAt" TIMESTAMP(3),
  "body" TEXT,
  "controlsJson" JSONB,
  "approvalCaseId" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_domain_councils" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT,
  "domainId" TEXT,
  "leadStewardRoleCode" TEXT,
  "cadence" TEXT NOT NULL DEFAULT 'monthly',
  "quorum" INTEGER NOT NULL DEFAULT 3,
  "status" "GovernanceLifecycleStatus" NOT NULL DEFAULT 'active',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_domain_councils_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_domain_council_members" (
  "id" TEXT NOT NULL,
  "councilId" TEXT NOT NULL,
  "personEmail" TEXT,
  "roleCode" TEXT,
  "memberRole" "GovernanceCouncilMemberRole" NOT NULL,
  "votingWeight" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_domain_council_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_decision_rights" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "decisionArea" TEXT NOT NULL,
  "decisionType" TEXT NOT NULL,
  "ownerRoleCode" TEXT NOT NULL,
  "consultedRoleCodesJson" JSONB,
  "timeframeBusinessDays" INTEGER NOT NULL DEFAULT 5,
  "escalationLevel" "GovernanceEscalationLevel" NOT NULL DEFAULT 'domain_council',
  "evidenceRequiredJson" JSONB,
  "status" "GovernanceLifecycleStatus" NOT NULL DEFAULT 'active',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_decision_rights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_maturity_assessments" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "overallScore" INTEGER NOT NULL DEFAULT 0,
  "status" "GovernanceLifecycleStatus" NOT NULL DEFAULT 'under_review',
  "assessedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_maturity_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_maturity_assessment_dimensions" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "dimension" "GovernanceMaturityDimension" NOT NULL,
  "score" INTEGER NOT NULL,
  "evidenceJson" JSONB,
  "gapsJson" JSONB,
  "actionsJson" JSONB,
  CONSTRAINT "governance_maturity_assessment_dimensions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "continuous_improvement_items" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "maturityAssessmentId" TEXT,
  "ownerRoleCode" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "status" "GovernanceLifecycleStatus" NOT NULL DEFAULT 'draft',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "evidenceJson" JSONB,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "continuous_improvement_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_delegations_delegatorUserId_delegateUserId_roleCode_assetId_startsAt_key"
  ON "workflow_delegations"("delegatorUserId", "delegateUserId", "roleCode", "assetId", "startsAt");
CREATE INDEX "workflow_delegations_delegatorUserId_idx" ON "workflow_delegations"("delegatorUserId");
CREATE INDEX "workflow_delegations_delegateUserId_idx" ON "workflow_delegations"("delegateUserId");
CREATE INDEX "workflow_delegations_roleCode_idx" ON "workflow_delegations"("roleCode");
CREATE INDEX "workflow_delegations_assetId_idx" ON "workflow_delegations"("assetId");
CREATE INDEX "workflow_delegations_status_startsAt_expiresAt_idx" ON "workflow_delegations"("status", "startsAt", "expiresAt");

CREATE INDEX "workflow_task_comments_caseId_idx" ON "workflow_task_comments"("caseId");
CREATE INDEX "workflow_task_comments_taskId_idx" ON "workflow_task_comments"("taskId");
CREATE INDEX "workflow_task_attachments_caseId_idx" ON "workflow_task_attachments"("caseId");
CREATE INDEX "workflow_task_attachments_taskId_idx" ON "workflow_task_attachments"("taskId");
CREATE INDEX "workflow_task_attachments_checksum_idx" ON "workflow_task_attachments"("checksum");
CREATE UNIQUE INDEX "workflow_sla_templates_code_key" ON "workflow_sla_templates"("code");
CREATE INDEX "workflow_sla_templates_caseType_idx" ON "workflow_sla_templates"("caseType");
CREATE INDEX "workflow_sla_templates_stageKind_idx" ON "workflow_sla_templates"("stageKind");
CREATE INDEX "workflow_sla_templates_isActive_idx" ON "workflow_sla_templates"("isActive");

CREATE UNIQUE INDEX "governance_notification_templates_code_key" ON "governance_notification_templates"("code");
CREATE INDEX "governance_notification_templates_sourceType_idx" ON "governance_notification_templates"("sourceType");
CREATE INDEX "governance_notification_templates_isActive_idx" ON "governance_notification_templates"("isActive");
CREATE UNIQUE INDEX "governance_notification_preferences_userId_roleCode_channel_key" ON "governance_notification_preferences"("userId", "roleCode", "channel");
CREATE INDEX "governance_notification_preferences_userId_idx" ON "governance_notification_preferences"("userId");
CREATE INDEX "governance_notification_preferences_roleCode_idx" ON "governance_notification_preferences"("roleCode");
CREATE INDEX "governance_notification_delivery_attempts_notificationId_idx" ON "governance_notification_delivery_attempts"("notificationId");
CREATE INDEX "governance_notification_delivery_attempts_channel_idx" ON "governance_notification_delivery_attempts"("channel");
CREATE INDEX "governance_notification_delivery_attempts_status_idx" ON "governance_notification_delivery_attempts"("status");

CREATE UNIQUE INDEX "searchable_object_registry_code_key" ON "searchable_object_registry"("code");
CREATE INDEX "searchable_object_registry_entityType_idx" ON "searchable_object_registry"("entityType");
CREATE INDEX "searchable_object_registry_permission_idx" ON "searchable_object_registry"("permission");
CREATE INDEX "searchable_object_registry_isActive_idx" ON "searchable_object_registry"("isActive");
CREATE UNIQUE INDEX "search_index_records_entityType_entityId_key" ON "search_index_records"("entityType", "entityId");
CREATE INDEX "search_index_records_entityType_idx" ON "search_index_records"("entityType");
CREATE INDEX "search_index_records_permission_idx" ON "search_index_records"("permission");
CREATE UNIQUE INDEX "saved_searches_userId_name_key" ON "saved_searches"("userId", "name");
CREATE INDEX "saved_searches_userId_idx" ON "saved_searches"("userId");
CREATE INDEX "search_analytics_events_userId_idx" ON "search_analytics_events"("userId");
CREATE INDEX "search_analytics_events_createdAt_idx" ON "search_analytics_events"("createdAt");

CREATE UNIQUE INDEX "governance_charters_code_key" ON "governance_charters"("code");
CREATE INDEX "governance_charters_status_idx" ON "governance_charters"("status");
CREATE UNIQUE INDEX "governance_policies_code_key" ON "governance_policies"("code");
CREATE INDEX "governance_policies_level_idx" ON "governance_policies"("level");
CREATE INDEX "governance_policies_domainId_idx" ON "governance_policies"("domainId");
CREATE INDEX "governance_policies_status_idx" ON "governance_policies"("status");
CREATE INDEX "governance_policies_parentCode_idx" ON "governance_policies"("parentCode");
CREATE UNIQUE INDEX "data_domain_councils_code_key" ON "data_domain_councils"("code");
CREATE INDEX "data_domain_councils_domainId_idx" ON "data_domain_councils"("domainId");
CREATE INDEX "data_domain_councils_status_idx" ON "data_domain_councils"("status");
CREATE INDEX "data_domain_council_members_councilId_idx" ON "data_domain_council_members"("councilId");
CREATE INDEX "data_domain_council_members_roleCode_idx" ON "data_domain_council_members"("roleCode");
CREATE UNIQUE INDEX "governance_decision_rights_code_key" ON "governance_decision_rights"("code");
CREATE INDEX "governance_decision_rights_decisionArea_idx" ON "governance_decision_rights"("decisionArea");
CREATE INDEX "governance_decision_rights_ownerRoleCode_idx" ON "governance_decision_rights"("ownerRoleCode");
CREATE INDEX "governance_decision_rights_status_idx" ON "governance_decision_rights"("status");
CREATE UNIQUE INDEX "governance_maturity_assessments_code_key" ON "governance_maturity_assessments"("code");
CREATE INDEX "governance_maturity_assessments_scopeType_scopeId_idx" ON "governance_maturity_assessments"("scopeType", "scopeId");
CREATE INDEX "governance_maturity_assessments_status_idx" ON "governance_maturity_assessments"("status");
CREATE UNIQUE INDEX "governance_maturity_assessment_dimensions_assessmentId_dimension_key" ON "governance_maturity_assessment_dimensions"("assessmentId", "dimension");
CREATE INDEX "governance_maturity_assessment_dimensions_assessmentId_idx" ON "governance_maturity_assessment_dimensions"("assessmentId");
CREATE UNIQUE INDEX "continuous_improvement_items_code_key" ON "continuous_improvement_items"("code");
CREATE INDEX "continuous_improvement_items_status_idx" ON "continuous_improvement_items"("status");
CREATE INDEX "continuous_improvement_items_priority_idx" ON "continuous_improvement_items"("priority");
CREATE INDEX "continuous_improvement_items_maturityAssessmentId_idx" ON "continuous_improvement_items"("maturityAssessmentId");

ALTER TABLE "workflow_task_comments"
  ADD CONSTRAINT "workflow_task_comments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_task_comments"
  ADD CONSTRAINT "workflow_task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_task_attachments"
  ADD CONSTRAINT "workflow_task_attachments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "workflow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_task_attachments"
  ADD CONSTRAINT "workflow_task_attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governance_notification_delivery_attempts"
  ADD CONSTRAINT "governance_notification_delivery_attempts_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "governance_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_domain_council_members"
  ADD CONSTRAINT "data_domain_council_members_councilId_fkey" FOREIGN KEY ("councilId") REFERENCES "data_domain_councils"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "governance_maturity_assessment_dimensions"
  ADD CONSTRAINT "governance_maturity_assessment_dimensions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "governance_maturity_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "continuous_improvement_items"
  ADD CONSTRAINT "continuous_improvement_items_maturityAssessmentId_fkey" FOREIGN KEY ("maturityAssessmentId") REFERENCES "governance_maturity_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "MdmGoldenRecordStatus" AS ENUM ('proposed', 'active', 'superseded', 'rejected');

CREATE TABLE "mdm_match_rules" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domainId" TEXT,
  "thresholdScore" INTEGER NOT NULL DEFAULT 85,
  "blockingJson" JSONB NOT NULL,
  "weightsJson" JSONB NOT NULL,
  "survivorshipJson" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mdm_match_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mdm_golden_records" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assetId" TEXT,
  "domainId" TEXT,
  "clusterKey" TEXT NOT NULL,
  "sourceRecordIdsJson" JSONB NOT NULL,
  "masteredRecordJson" JSONB NOT NULL,
  "survivorshipRulesJson" JSONB,
  "status" "MdmGoldenRecordStatus" NOT NULL DEFAULT 'proposed',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mdm_golden_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mdm_merge_split_events" (
  "id" TEXT NOT NULL,
  "goldenRecordId" TEXT,
  "matchCandidateId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mdm_merge_split_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mdm_match_rules_code_key" ON "mdm_match_rules"("code");
CREATE INDEX "mdm_match_rules_domainId_idx" ON "mdm_match_rules"("domainId");
CREATE INDEX "mdm_match_rules_isActive_idx" ON "mdm_match_rules"("isActive");
CREATE UNIQUE INDEX "mdm_golden_records_code_key" ON "mdm_golden_records"("code");
CREATE INDEX "mdm_golden_records_assetId_idx" ON "mdm_golden_records"("assetId");
CREATE INDEX "mdm_golden_records_domainId_idx" ON "mdm_golden_records"("domainId");
CREATE INDEX "mdm_golden_records_clusterKey_idx" ON "mdm_golden_records"("clusterKey");
CREATE INDEX "mdm_golden_records_status_idx" ON "mdm_golden_records"("status");
CREATE INDEX "mdm_merge_split_events_goldenRecordId_idx" ON "mdm_merge_split_events"("goldenRecordId");
CREATE INDEX "mdm_merge_split_events_matchCandidateId_idx" ON "mdm_merge_split_events"("matchCandidateId");
CREATE INDEX "mdm_merge_split_events_action_idx" ON "mdm_merge_split_events"("action");

ALTER TABLE "mdm_merge_split_events"
  ADD CONSTRAINT "mdm_merge_split_events_goldenRecordId_fkey" FOREIGN KEY ("goldenRecordId") REFERENCES "mdm_golden_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mdm_merge_split_events"
  ADD CONSTRAINT "mdm_merge_split_events_matchCandidateId_fkey" FOREIGN KEY ("matchCandidateId") REFERENCES "mdm_match_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
