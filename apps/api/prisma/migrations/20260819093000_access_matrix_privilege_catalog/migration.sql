-- Volume 2, Section 22: complete type-specific business privilege catalogues.
-- Legacy v6 preview permissions remain readable by historical grants, but are
-- removed from new-grant selection in favor of the normative catalogues below.
UPDATE "access_permission_catalog"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'dataset.read', 'dataset.export', 'dataset.update_metadata',
  'file.read', 'file.download', 'file.transfer',
  'document_record.read', 'document_record.certify', 'document_record.dispose',
  'api_data_feed.consume', 'api_data_feed.subscribe', 'api_data_feed.manage_consumer',
  'bi_report_dashboard.view', 'bi_report_dashboard.export', 'bi_report_dashboard.certify',
  'ai_data_product.invoke', 'ai_data_product.use_training_data', 'ai_data_product.inspect_model_card'
);

WITH permission_rows AS (
  SELECT * FROM jsonb_to_recordset($json$
  [
    {"assetType":"dataset","action":"discover","nameEn":"Discover","nameAr":"اكتشاف","description":"Find the asset in search and catalogue.","risk":"low"},
    {"assetType":"dataset","action":"view_metadata","nameEn":"View metadata","nameAr":"عرض البيانات الوصفية","description":"View definitions, ownership, classification, and lineage.","risk":"low"},
    {"assetType":"dataset","action":"preview_masked","nameEn":"Preview masked data","nameAr":"معاينة البيانات المقنعة","description":"View a limited masked data sample.","risk":"medium"},
    {"assetType":"dataset","action":"query_read","nameEn":"Query / read","nameAr":"الاستعلام والقراءة","description":"Query or read authorized records.","risk":"medium"},
    {"assetType":"dataset","action":"insert","nameEn":"Insert / create","nameAr":"الإضافة والإنشاء","description":"Create authorized records.","risk":"medium"},
    {"assetType":"dataset","action":"update","nameEn":"Update / write","nameAr":"التحديث والكتابة","description":"Modify authorized records.","risk":"medium"},
    {"assetType":"dataset","action":"delete","nameEn":"Delete","nameAr":"الحذف","description":"Delete authorized records.","risk":"high"},
    {"assetType":"dataset","action":"export","nameEn":"Export data","nameAr":"تصدير البيانات","description":"Extract or download governed data.","risk":"high"},
    {"assetType":"dataset","action":"share","nameEn":"Share","nameAr":"المشاركة","description":"Redistribute the dataset to an approved location.","risk":"high"},
    {"assetType":"dataset","action":"execute","nameEn":"Execute","nameAr":"التنفيذ","description":"Execute an authorized view, procedure, or data service.","risk":"medium"},

    {"assetType":"file","action":"discover","nameEn":"Discover","nameAr":"اكتشاف","description":"Find the governed file asset.","risk":"low"},
    {"assetType":"file","action":"view_metadata","nameEn":"View metadata","nameAr":"عرض البيانات الوصفية","description":"View the file description and metadata.","risk":"low"},
    {"assetType":"file","action":"preview","nameEn":"Preview","nameAr":"معاينة","description":"Preview file content.","risk":"low"},
    {"assetType":"file","action":"download","nameEn":"Download / read","nameAr":"التنزيل والقراءة","description":"Download the governed file.","risk":"medium"},
    {"assetType":"file","action":"upload_version","nameEn":"Upload version","nameAr":"رفع إصدار","description":"Upload a controlled new version.","risk":"medium"},
    {"assetType":"file","action":"edit_replace","nameEn":"Edit / replace","nameAr":"التعديل والاستبدال","description":"Modify or replace file content.","risk":"medium"},
    {"assetType":"file","action":"delete","nameEn":"Delete","nameAr":"الحذف","description":"Delete the file where policy permits.","risk":"high"},
    {"assetType":"file","action":"share","nameEn":"Share","nameAr":"المشاركة","description":"Share or redistribute the file.","risk":"high"},

    {"assetType":"document_record","action":"discover","nameEn":"Discover","nameAr":"اكتشاف","description":"Find the document or record.","risk":"low"},
    {"assetType":"document_record","action":"view_metadata","nameEn":"View metadata","nameAr":"عرض البيانات الوصفية","description":"View controlled record metadata.","risk":"low"},
    {"assetType":"document_record","action":"view","nameEn":"View / read","nameAr":"العرض والقراءة","description":"Open and read the document or record.","risk":"low"},
    {"assetType":"document_record","action":"download","nameEn":"Download","nameAr":"التنزيل","description":"Download an authorized copy.","risk":"medium"},
    {"assetType":"document_record","action":"print","nameEn":"Print","nameAr":"الطباعة","description":"Print the document where policy permits.","risk":"medium"},
    {"assetType":"document_record","action":"edit","nameEn":"Edit / write","nameAr":"التعديل والكتابة","description":"Edit controlled content.","risk":"medium"},
    {"assetType":"document_record","action":"create_version","nameEn":"Create version","nameAr":"إنشاء إصدار","description":"Create a new controlled version.","risk":"medium"},
    {"assetType":"document_record","action":"delete","nameEn":"Delete","nameAr":"الحذف","description":"Delete where retention rules allow.","risk":"high"},
    {"assetType":"document_record","action":"share","nameEn":"Share","nameAr":"المشاركة","description":"Share internally or externally where authorized.","risk":"high"},

    {"assetType":"api_data_feed","action":"discover","nameEn":"Discover","nameAr":"اكتشاف","description":"Find the API or data feed.","risk":"low"},
    {"assetType":"api_data_feed","action":"view_documentation","nameEn":"View documentation","nameAr":"عرض التوثيق","description":"View interface documentation.","risk":"low"},
    {"assetType":"api_data_feed","action":"invoke_consume","nameEn":"Invoke / consume","nameAr":"الاستدعاء والاستهلاك","description":"Invoke the API or consume the feed.","risk":"medium"},
    {"assetType":"api_data_feed","action":"subscribe","nameEn":"Subscribe","nameAr":"الاشتراك","description":"Subscribe to recurring delivery.","risk":"medium"},
    {"assetType":"api_data_feed","action":"submit_publish","nameEn":"Submit / publish","nameAr":"الإرسال والنشر","description":"Submit data or publish messages.","risk":"medium"},
    {"assetType":"api_data_feed","action":"bulk_consume","nameEn":"Bulk consume","nameAr":"الاستهلاك المجمع","description":"Perform high-volume consumption.","risk":"high"},
    {"assetType":"api_data_feed","action":"download_payload","nameEn":"Download payload","nameAr":"تنزيل الحمولة","description":"Retain or download received payloads.","risk":"high"},
    {"assetType":"api_data_feed","action":"manage_subscription","nameEn":"Manage subscription","nameAr":"إدارة الاشتراك","description":"Pause, resume, or modify a subscription.","risk":"high"},
    {"assetType":"api_data_feed","action":"manage_credential","nameEn":"Manage credential","nameAr":"إدارة بيانات الاعتماد","description":"Manage a permitted technical credential.","risk":"high"},

    {"assetType":"bi_report_dashboard","action":"discover","nameEn":"Discover","nameAr":"اكتشاف","description":"Find the BI asset.","risk":"low"},
    {"assetType":"bi_report_dashboard","action":"view","nameEn":"View / read","nameAr":"العرض والقراءة","description":"Open the report or dashboard.","risk":"low"},
    {"assetType":"bi_report_dashboard","action":"interact","nameEn":"Interact","nameAr":"التفاعل","description":"Filter, sort, navigate, and use slicers.","risk":"low"},
    {"assetType":"bi_report_dashboard","action":"drill_through","nameEn":"Drill through","nameAr":"التعمق","description":"Navigate to detailed records.","risk":"medium"},
    {"assetType":"bi_report_dashboard","action":"export_data","nameEn":"Export data","nameAr":"تصدير البيانات","description":"Export underlying or summarized data.","risk":"high"},
    {"assetType":"bi_report_dashboard","action":"export_report","nameEn":"Export report","nameAr":"تصدير التقرير","description":"Export the report to an approved format.","risk":"medium"},
    {"assetType":"bi_report_dashboard","action":"build","nameEn":"Build / author","nameAr":"البناء والتأليف","description":"Create a report using the governed semantic model.","risk":"medium"},
    {"assetType":"bi_report_dashboard","action":"reshare","nameEn":"Reshare","nameAr":"إعادة المشاركة","description":"Share the report with additional audiences.","risk":"high"},
    {"assetType":"bi_report_dashboard","action":"publish","nameEn":"Publish / write","nameAr":"النشر والكتابة","description":"Publish or replace report content.","risk":"high"},

    {"assetType":"ai_data_product","action":"discover","nameEn":"Discover","nameAr":"اكتشاف","description":"Find the AI data product.","risk":"low"},
    {"assetType":"ai_data_product","action":"view_product_card","nameEn":"View product card","nameAr":"عرض بطاقة المنتج","description":"View intended use, limitations, and ownership.","risk":"low"},
    {"assetType":"ai_data_product","action":"use_invoke","nameEn":"Use / invoke","nameAr":"الاستخدام والاستدعاء","description":"Use or invoke the AI product.","risk":"medium"},
    {"assetType":"ai_data_product","action":"submit_input","nameEn":"Submit input","nameAr":"إرسال المدخلات","description":"Submit approved prompts, records, or documents.","risk":"medium"},
    {"assetType":"ai_data_product","action":"view_output","nameEn":"View output","nameAr":"عرض المخرجات","description":"View predictions, recommendations, or generated output.","risk":"low"},
    {"assetType":"ai_data_product","action":"export_output","nameEn":"Export output","nameAr":"تصدير المخرجات","description":"Download or extract generated output.","risk":"high"},
    {"assetType":"ai_data_product","action":"contribute_data","nameEn":"Contribute data","nameAr":"المساهمة بالبيانات","description":"Add approved data to the product.","risk":"medium"},
    {"assetType":"ai_data_product","action":"evaluate","nameEn":"Evaluate","nameAr":"التقييم","description":"Submit feedback or perform evaluation.","risk":"low"},
    {"assetType":"ai_data_product","action":"view_evidence","nameEn":"View evidence","nameAr":"عرض الأدلة","description":"View performance, quality, lineage, or governance evidence.","risk":"low"},
    {"assetType":"ai_data_product","action":"configure_product","nameEn":"Configure product","nameAr":"تهيئة المنتج","description":"Change permitted non-technical product settings.","risk":"high"},
    {"assetType":"ai_data_product","action":"operate_product","nameEn":"Operate product","nameAr":"تشغيل المنتج","description":"Start, stop, or administer product operation.","risk":"high"}
  ]$json$::jsonb) AS row(
    "assetType" text, "action" text, "nameEn" text, "nameAr" text, "description" text, "risk" text
  )
)
INSERT INTO "access_permission_catalog" (
  "id", "code", "asset_type", "action", "nameEn", "nameAr", "description", "risk_level", "version", "isActive", "createdBy", "createdAt", "updatedAt"
)
SELECT
  concat('apc-v2-', "assetType", '-', "action"),
  concat("assetType", '.', "action"),
  "assetType", "action", "nameEn", "nameAr", "description", "risk", 1, true, 'system:volume2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permission_rows
ON CONFLICT ("code") DO UPDATE SET
  "asset_type" = EXCLUDED."asset_type",
  "action" = EXCLUDED."action",
  "nameEn" = EXCLUDED."nameEn",
  "nameAr" = EXCLUDED."nameAr",
  "description" = EXCLUDED."description",
  "risk_level" = EXCLUDED."risk_level",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "access_permission_profiles"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'dataset.viewer', 'dataset.steward', 'file.reader', 'file.transfer_operator',
  'document_record.viewer', 'document_record.manager', 'api_data_feed.consumer',
  'api_data_feed.manager', 'bi_report_dashboard.viewer', 'bi_report_dashboard.certifier',
  'ai_data_product.user', 'ai_data_product.trainer'
);

-- Two preview profile codes overlap the normative names. Preserve their
-- historical identities under explicit legacy codes so all active v2 profile
-- identifiers satisfy the UUID API contract.
UPDATE "access_permission_profiles"
SET "code" = concat("code", '.legacy_v1'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('api_data_feed.consumer', 'bi_report_dashboard.viewer')
  AND "id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

WITH profile_rows AS (
  SELECT * FROM jsonb_to_recordset($json$
  [
    {"id":"78000000-0000-4000-8001-000000000001","assetType":"dataset","code":"dataset.metadata_viewer","nameEn":"Metadata Viewer","nameAr":"عارض البيانات الوصفية","permissions":["dataset.discover","dataset.view_metadata"]},
    {"id":"78000000-0000-4000-8001-000000000002","assetType":"dataset","code":"dataset.reader","nameEn":"Reader","nameAr":"قارئ","permissions":["dataset.discover","dataset.view_metadata","dataset.query_read"]},
    {"id":"78000000-0000-4000-8001-000000000003","assetType":"dataset","code":"dataset.analyst","nameEn":"Analyst","nameAr":"محلل","permissions":["dataset.discover","dataset.view_metadata","dataset.preview_masked","dataset.query_read"]},
    {"id":"78000000-0000-4000-8001-000000000004","assetType":"dataset","code":"dataset.contributor","nameEn":"Contributor","nameAr":"مساهم","permissions":["dataset.discover","dataset.view_metadata","dataset.query_read","dataset.insert","dataset.update"]},
    {"id":"78000000-0000-4000-8001-000000000005","assetType":"dataset","code":"dataset.maintainer","nameEn":"Maintainer","nameAr":"مسؤول صيانة","permissions":["dataset.discover","dataset.view_metadata","dataset.query_read","dataset.insert","dataset.update","dataset.delete"]},

    {"id":"78000000-0000-4000-8002-000000000001","assetType":"file","code":"file.metadata_viewer","nameEn":"Metadata Viewer","nameAr":"عارض البيانات الوصفية","permissions":["file.discover","file.view_metadata"]},
    {"id":"78000000-0000-4000-8002-000000000002","assetType":"file","code":"file.viewer","nameEn":"Viewer","nameAr":"عارض","permissions":["file.discover","file.view_metadata","file.preview"]},
    {"id":"78000000-0000-4000-8002-000000000003","assetType":"file","code":"file.downloader","nameEn":"Downloader","nameAr":"منزّل","permissions":["file.discover","file.view_metadata","file.preview","file.download"]},
    {"id":"78000000-0000-4000-8002-000000000004","assetType":"file","code":"file.contributor","nameEn":"Contributor","nameAr":"مساهم","permissions":["file.discover","file.view_metadata","file.preview","file.download","file.upload_version","file.edit_replace"]},
    {"id":"78000000-0000-4000-8002-000000000005","assetType":"file","code":"file.file_manager","nameEn":"File Manager","nameAr":"مدير الملفات","permissions":["file.discover","file.view_metadata","file.preview","file.download","file.upload_version","file.edit_replace","file.delete"]},

    {"id":"78000000-0000-4000-8003-000000000001","assetType":"document_record","code":"document_record.metadata_viewer","nameEn":"Metadata Viewer","nameAr":"عارض البيانات الوصفية","permissions":["document_record.discover","document_record.view_metadata"]},
    {"id":"78000000-0000-4000-8003-000000000002","assetType":"document_record","code":"document_record.reader","nameEn":"Reader","nameAr":"قارئ","permissions":["document_record.discover","document_record.view_metadata","document_record.view"]},
    {"id":"78000000-0000-4000-8003-000000000003","assetType":"document_record","code":"document_record.editor","nameEn":"Editor","nameAr":"محرر","permissions":["document_record.discover","document_record.view_metadata","document_record.view","document_record.download","document_record.edit","document_record.create_version"]},
    {"id":"78000000-0000-4000-8003-000000000004","assetType":"document_record","code":"document_record.records_manager","nameEn":"Records Manager","nameAr":"مدير السجلات","permissions":["document_record.discover","document_record.view_metadata","document_record.view","document_record.download","document_record.print","document_record.edit","document_record.create_version","document_record.delete"]},

    {"id":"78000000-0000-4000-8004-000000000001","assetType":"api_data_feed","code":"api_data_feed.documentation_viewer","nameEn":"Documentation Viewer","nameAr":"عارض التوثيق","permissions":["api_data_feed.discover","api_data_feed.view_documentation"]},
    {"id":"78000000-0000-4000-8004-000000000002","assetType":"api_data_feed","code":"api_data_feed.consumer","nameEn":"Consumer","nameAr":"مستهلك","permissions":["api_data_feed.discover","api_data_feed.view_documentation","api_data_feed.invoke_consume"]},
    {"id":"78000000-0000-4000-8004-000000000003","assetType":"api_data_feed","code":"api_data_feed.subscriber","nameEn":"Subscriber","nameAr":"مشترك","permissions":["api_data_feed.discover","api_data_feed.view_documentation","api_data_feed.invoke_consume","api_data_feed.subscribe"]},
    {"id":"78000000-0000-4000-8004-000000000004","assetType":"api_data_feed","code":"api_data_feed.producer","nameEn":"Producer","nameAr":"ناشر بيانات","permissions":["api_data_feed.discover","api_data_feed.view_documentation","api_data_feed.invoke_consume","api_data_feed.submit_publish"]},
    {"id":"78000000-0000-4000-8004-000000000005","assetType":"api_data_feed","code":"api_data_feed.api_operator","nameEn":"API Operator","nameAr":"مشغل واجهة البرمجة","permissions":["api_data_feed.discover","api_data_feed.view_documentation","api_data_feed.invoke_consume","api_data_feed.subscribe","api_data_feed.submit_publish","api_data_feed.manage_subscription","api_data_feed.manage_credential"]},

    {"id":"78000000-0000-4000-8005-000000000001","assetType":"bi_report_dashboard","code":"bi_report_dashboard.viewer","nameEn":"Viewer","nameAr":"عارض","permissions":["bi_report_dashboard.discover","bi_report_dashboard.view"]},
    {"id":"78000000-0000-4000-8005-000000000002","assetType":"bi_report_dashboard","code":"bi_report_dashboard.explorer","nameEn":"Explorer","nameAr":"مستكشف","permissions":["bi_report_dashboard.discover","bi_report_dashboard.view","bi_report_dashboard.interact","bi_report_dashboard.drill_through"]},
    {"id":"78000000-0000-4000-8005-000000000003","assetType":"bi_report_dashboard","code":"bi_report_dashboard.data_exporter","nameEn":"Data Exporter","nameAr":"مصدّر البيانات","permissions":["bi_report_dashboard.discover","bi_report_dashboard.view","bi_report_dashboard.interact","bi_report_dashboard.export_data","bi_report_dashboard.export_report"]},
    {"id":"78000000-0000-4000-8005-000000000004","assetType":"bi_report_dashboard","code":"bi_report_dashboard.report_builder","nameEn":"Report Builder","nameAr":"منشئ التقارير","permissions":["bi_report_dashboard.discover","bi_report_dashboard.view","bi_report_dashboard.interact","bi_report_dashboard.drill_through","bi_report_dashboard.build"]},
    {"id":"78000000-0000-4000-8005-000000000005","assetType":"bi_report_dashboard","code":"bi_report_dashboard.publisher","nameEn":"Publisher","nameAr":"ناشر","permissions":["bi_report_dashboard.discover","bi_report_dashboard.view","bi_report_dashboard.interact","bi_report_dashboard.build","bi_report_dashboard.publish"]},

    {"id":"78000000-0000-4000-8006-000000000001","assetType":"ai_data_product","code":"ai_data_product.product_viewer","nameEn":"Product Viewer","nameAr":"عارض المنتج","permissions":["ai_data_product.discover","ai_data_product.view_product_card","ai_data_product.view_output","ai_data_product.view_evidence"]},
    {"id":"78000000-0000-4000-8006-000000000002","assetType":"ai_data_product","code":"ai_data_product.consumer","nameEn":"Consumer","nameAr":"مستهلك","permissions":["ai_data_product.discover","ai_data_product.view_product_card","ai_data_product.use_invoke","ai_data_product.submit_input","ai_data_product.view_output"]},
    {"id":"78000000-0000-4000-8006-000000000003","assetType":"ai_data_product","code":"ai_data_product.evaluator","nameEn":"Evaluator","nameAr":"مقيّم","permissions":["ai_data_product.discover","ai_data_product.view_product_card","ai_data_product.use_invoke","ai_data_product.view_output","ai_data_product.evaluate","ai_data_product.view_evidence"]},
    {"id":"78000000-0000-4000-8006-000000000004","assetType":"ai_data_product","code":"ai_data_product.data_contributor","nameEn":"Data Contributor","nameAr":"مساهم بالبيانات","permissions":["ai_data_product.discover","ai_data_product.view_product_card","ai_data_product.use_invoke","ai_data_product.submit_input","ai_data_product.view_output","ai_data_product.contribute_data","ai_data_product.view_evidence"]},
    {"id":"78000000-0000-4000-8006-000000000005","assetType":"ai_data_product","code":"ai_data_product.product_operator","nameEn":"Product Operator","nameAr":"مشغل المنتج","permissions":["ai_data_product.discover","ai_data_product.view_product_card","ai_data_product.use_invoke","ai_data_product.submit_input","ai_data_product.view_output","ai_data_product.view_evidence","ai_data_product.configure_product","ai_data_product.operate_product"]}
  ]$json$::jsonb) AS row(
    "id" text, "assetType" text, "code" text, "nameEn" text, "nameAr" text, "permissions" jsonb
  )
)
INSERT INTO "access_permission_profiles" (
  "id", "code", "asset_type", "nameEn", "nameAr", "description", "version", "permission_codes_json", "isActive", "createdBy", "createdAt", "updatedAt"
)
SELECT
  "id", "code", "assetType", "nameEn", "nameAr",
  concat("nameEn", ' standard access profile for ', replace("assetType", '_', ' '), '.'),
  1, "permissions", true, 'system:volume2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM profile_rows
ON CONFLICT ("code") DO UPDATE SET
  "asset_type" = EXCLUDED."asset_type",
  "nameEn" = EXCLUDED."nameEn",
  "nameAr" = EXCLUDED."nameAr",
  "description" = EXCLUDED."description",
  "permission_codes_json" = EXCLUDED."permission_codes_json",
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Provide a small, clearly identified six-type sample inventory so the matrix
-- can demonstrate type-specific privilege behavior in clean pilot databases.
WITH asset_rows AS (
  SELECT * FROM jsonb_to_recordset($json$
  [
    {"id":"79000000-0000-4000-8001-000000000001","code":"SAMPLE-DS-001","nameEn":"Customer Master Dataset","nameAr":"مجموعة بيانات العملاء الرئيسية","assetType":"dataset"},
    {"id":"79000000-0000-4000-8001-000000000002","code":"SAMPLE-FL-001","nameEn":"Monthly Payroll File","nameAr":"ملف الرواتب الشهري","assetType":"file"},
    {"id":"79000000-0000-4000-8001-000000000003","code":"SAMPLE-DR-001","nameEn":"Employment Contract Records","nameAr":"سجلات عقود الموظفين","assetType":"document_record"},
    {"id":"79000000-0000-4000-8001-000000000004","code":"SAMPLE-API-001","nameEn":"Employee Verification API","nameAr":"واجهة التحقق من الموظفين","assetType":"api_data_feed"},
    {"id":"79000000-0000-4000-8001-000000000005","code":"SAMPLE-BI-001","nameEn":"Workforce Performance Dashboard","nameAr":"لوحة أداء القوى العاملة","assetType":"bi_report_dashboard"},
    {"id":"79000000-0000-4000-8001-000000000006","code":"SAMPLE-AI-001","nameEn":"Skills Recommendation Product","nameAr":"منتج توصية المهارات","assetType":"ai_data_product"}
  ]$json$::jsonb) AS row("id" text, "code" text, "nameEn" text, "nameAr" text, "assetType" text)
)
INSERT INTO "data_assets" (
  "id", "code", "nameEn", "nameAr", "description", "asset_type", "asset_subtype",
  "v6_lifecycle_state", "lifecycle_phase", "lifecycleStatus", "ownerStatus", "createdAt", "updatedAt"
)
SELECT
  "id", "code", "nameEn", "nameAr", 'Volume 2 access-matrix sample asset.', "assetType", 'sample',
  'active', 'operate', 'active', 'unassigned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM asset_rows
ON CONFLICT ("code") DO UPDATE SET
  "nameEn" = EXCLUDED."nameEn",
  "nameAr" = EXCLUDED."nameAr",
  "asset_type" = EXCLUDED."asset_type",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH grant_rows AS (
  SELECT * FROM jsonb_to_recordset($json$
  [
    {"id":"7a000000-0000-4000-8001-000000000001","code":"AGR-SAMPLE-001","assetCode":"SAMPLE-DS-001","principalType":"role","principalId":"data_owner","profileCode":"dataset.analyst","enforcement":"enforced"},
    {"id":"7a000000-0000-4000-8001-000000000002","code":"AGR-SAMPLE-002","assetCode":"SAMPLE-DS-001","principalType":"group","principalId":"GRP-ANALYTICS","profileCode":"dataset.contributor","enforcement":"pending"},
    {"id":"7a000000-0000-4000-8001-000000000003","code":"AGR-SAMPLE-003","assetCode":"SAMPLE-FL-001","principalType":"group","principalId":"GRP-DATA-CONSUMERS","profileCode":"file.downloader","enforcement":"enforced"},
    {"id":"7a000000-0000-4000-8001-000000000004","code":"AGR-SAMPLE-004","assetCode":"SAMPLE-FL-001","principalType":"role","principalId":"operational_data_steward","profileCode":"file.contributor","enforcement":"pending"},
    {"id":"7a000000-0000-4000-8001-000000000005","code":"AGR-SAMPLE-005","assetCode":"SAMPLE-DR-001","principalType":"role","principalId":"privacy_officer","profileCode":"document_record.reader","enforcement":"enforced"},
    {"id":"7a000000-0000-4000-8001-000000000006","code":"AGR-SAMPLE-006","assetCode":"SAMPLE-DR-001","principalType":"group","principalId":"GRP-PRIVACY-REVIEWERS","profileCode":"document_record.records_manager","enforcement":"failed"},
    {"id":"7a000000-0000-4000-8001-000000000007","code":"AGR-SAMPLE-007","assetCode":"SAMPLE-API-001","principalType":"role","principalId":"technical_steward","profileCode":"api_data_feed.api_operator","enforcement":"pending"},
    {"id":"7a000000-0000-4000-8001-000000000008","code":"AGR-SAMPLE-008","assetCode":"SAMPLE-API-001","principalType":"group","principalId":"GRP-DATA-CONSUMERS","profileCode":"api_data_feed.consumer","enforcement":"enforced"},
    {"id":"7a000000-0000-4000-8001-000000000009","code":"AGR-SAMPLE-009","assetCode":"SAMPLE-BI-001","principalType":"role","principalId":"executive","profileCode":"bi_report_dashboard.viewer","enforcement":"enforced"},
    {"id":"7a000000-0000-4000-8001-000000000010","code":"AGR-SAMPLE-010","assetCode":"SAMPLE-BI-001","principalType":"group","principalId":"GRP-ANALYTICS","profileCode":"bi_report_dashboard.explorer","enforcement":"enforced"},
    {"id":"7a000000-0000-4000-8001-000000000011","code":"AGR-SAMPLE-011","assetCode":"SAMPLE-AI-001","principalType":"role","principalId":"data_owner","profileCode":"ai_data_product.consumer","enforcement":"pending"},
    {"id":"7a000000-0000-4000-8001-000000000012","code":"AGR-SAMPLE-012","assetCode":"SAMPLE-AI-001","principalType":"role","principalId":"auditor","profileCode":"ai_data_product.evaluator","enforcement":"enforced"}
  ]$json$::jsonb) AS row(
    "id" text, "code" text, "assetCode" text, "principalType" text, "principalId" text, "profileCode" text, "enforcement" text
  )
)
INSERT INTO "access_grants" (
  "id", "code", "assetId", "principal_type", "principal_id", "permission_code", "profileId",
  "status", "starts_at", "expires_at", "justification", "version", "owner_decision",
  "owner_decision_by", "owner_decision_at", "enforcement_status", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT
  row."id", row."code", asset."id", row."principalType", row."principalId",
  profile."permission_codes_json"->>0, profile."id", 'active', CURRENT_TIMESTAMP - INTERVAL '30 days',
  CURRENT_TIMESTAMP + INTERVAL '90 days', 'Pilot sample authorization for the Volume 2 access matrix.',
  1, 'approved', 'system:volume2', CURRENT_TIMESTAMP, row."enforcement",
  'system:volume2', 'system:volume2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM grant_rows row
JOIN "data_assets" asset ON asset."code" = row."assetCode"
JOIN "access_permission_profiles" profile ON profile."code" = row."profileCode"
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "access_grant_permissions" ("id", "grant_id", "permission_code", "source", "created_at")
SELECT
  concat('agp-v2-', substr(md5(grant_row."id" || permission."code"), 1, 24)),
  grant_row."id", permission."code", 'profile', CURRENT_TIMESTAMP
FROM "access_grants" grant_row
JOIN "access_permission_profiles" profile ON profile."id" = grant_row."profileId"
CROSS JOIN LATERAL jsonb_array_elements_text(profile."permission_codes_json") AS permission("code")
WHERE grant_row."code" LIKE 'AGR-SAMPLE-%'
ON CONFLICT ("grant_id", "permission_code") DO NOTHING;

INSERT INTO "access_grant_versions" ("id", "grant_id", "version", "snapshot_json", "change_reason", "changed_by", "created_at")
SELECT
  concat('agv-v2-', substr(md5(grant_row."id"), 1, 24)), grant_row."id", 1,
  jsonb_build_object(
    'code', grant_row."code",
    'assetId', grant_row."assetId",
    'principalType', grant_row."principal_type",
    'principalId', grant_row."principal_id",
    'permissionCodes', profile."permission_codes_json",
    'profileId', grant_row."profileId",
    'status', grant_row."status",
    'startsAt', grant_row."starts_at",
    'expiresAt', grant_row."expires_at",
    'justification', grant_row."justification",
    'ownerDecision', grant_row."owner_decision",
    'enforcementStatus', grant_row."enforcement_status"
  ),
  'Initial Volume 2 sample authorization', 'system:volume2', CURRENT_TIMESTAMP
FROM "access_grants" grant_row
JOIN "access_permission_profiles" profile ON profile."id" = grant_row."profileId"
WHERE grant_row."code" LIKE 'AGR-SAMPLE-%'
ON CONFLICT ("grant_id", "version") DO NOTHING;
