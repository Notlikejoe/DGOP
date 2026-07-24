INSERT INTO "permissions" ("id", "resource", "action", "descriptionEn", "descriptionAr", "createdAt")
VALUES
  ('perm-search-create', 'search', 'create', 'Create and update personal saved searches.', NULL, CURRENT_TIMESTAMP),
  ('perm-search-analytics', 'search', 'analytics', 'Record search interaction analytics.', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."deletedAt" IS NULL
  AND r."isActive" = true
  AND p."resource" = 'search'
  AND p."action" IN ('create', 'analytics')
ON CONFLICT DO NOTHING;
