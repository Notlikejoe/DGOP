import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ApprovalStatus,
  AssignmentTargetType,
  Prisma,
  WorkflowDelegationStatus,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { parsePageParams, toPaged } from "../common/pagination";
import {
  formatBusinessSequence,
  nextAvailableBusinessCode,
} from "../common/business-sequence";
import { PrismaService } from "../prisma/prisma.service";
import { ScopeService, EffectiveScope } from "./scope.service";
import { OwnerDelegateValidationService } from "./owner-delegate-validation.service";
import { isManagedDemoProfile } from '../common/demo-profile';
import { isSystemAdministrator } from '../auth/system-admin';
import { enforcementOperationAllowed, enforcementGrantOutcome, REMOVAL_STATES, type EnforcementOperation } from './access-enforcement.logic';
import {
  AccessMatrixQueryDto,
  BulkCreateAccessGrantDto,
  CreateAccessGrantDto,
  CompleteManualAccessEnforcementDto,
  CompleteAccessEnforcementAttemptDto,
  ACCESS_GRANT_PRINCIPAL_TYPES,
  CommitAccessGrantImportDto,
  DecideAccessGrantDto,
  ListEffectiveAccessDto,
  ListAccessGrantsDto,
  RevokeAccessGrantDto,
  DispatchAccessEnforcementDto,
  UpdateAccessGrantEnforcementDto,
  UpdateAccessGrantDto,
  ValidateAccessGrantImportDto,
} from "./access.dto";

const ADMIN_ROLES = ["system_admin", "dmo_admin"];
const ACCESS_GRANT_DEFAULT_PAGE_SIZE = 50;
const ACTIVE_GRANT_STATUSES = new Set(["requested", "active"]);
const TERMINAL_GRANT_STATUSES = ["expired", "rejected", "revoked"] as const;
const DEFAULT_ACCESS_IMPORT_ROW_LIMIT = 10_000;
const ACCESS_MATRIX_MAX_ASSETS = 100;
const ACCESS_MATRIX_MAX_PRINCIPALS = 50;
const ACCESS_MATRIX_MAX_GRANTS = 10_000;
const EFFECTIVE_ACCESS_BATCH_SIZE = 500;

type ImportAction = "create" | "update" | "revoke";
type ImportPlanRow = {
  row: number;
  action: ImportAction | string;
  code: string | null;
  valid: boolean;
  errors: string[];
  values: Record<string, string>;
  existing?: {
    id: string;
    code: string;
    version: number;
    status: string;
    ownerDecision: string;
    assetId: string;
  } | null;
  create?: {
    assetId: string;
    principalType: string;
    principalId: string;
    permissionCode: string;
    profileId: string | null;
    startsAt: Date;
    expiresAt: Date | null;
    justification: string;
  };
  update?: Prisma.AccessGrantUpdateManyMutationInput;
  profileId?: string | null;
};

type ExistingImportGrant = {
  id: string;
  code: string;
  version: number;
  status: string;
  ownerDecision: string;
  assetId: string;
};
type VisibleImportAsset = { id: string; code: string; assetType: string };

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  if (quoted)
    throw new BadRequestException("CSV contains an unterminated quoted value");
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some(Boolean));
}

const grantInclude = {
  asset: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      assetType: true,
      domainId: true,
      orgUnitId: true,
      classificationId: true,
    },
  },
  profile: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      assetType: true,
      version: true,
      permissionCodesJson: true,
    },
  },
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
  permissions: {
    select: {
      permissionCode: true,
      source: true,
      permission: {
        select: { nameEn: true, nameAr: true, riskLevel: true, action: true },
      },
    },
    orderBy: { permissionCode: "asc" as const },
  },
};

type AccessGrantWithInclude = Prisma.AccessGrantGetPayload<{
  include: typeof grantInclude;
}>;
type EffectiveAccessRow = {
  grantId: string;
  grantCode: string;
  grantVersion: number;
  asset: AccessGrantWithInclude["asset"];
  principalType: string;
  principalId: string;
  permissionCode: string;
  permissionCodes: string[];
  grantStatus: string;
  ownerDecision: string;
  enforcementStatus: string;
  startsAt: Date;
  expiresAt: Date | null;
  lifecycleState: string;
  enforcementGap: boolean;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  expansionStatus: string;
  source: string;
  expandedFromRoleCode?: string;
  expandedFromRoleName?: string;
};

const grantDetailInclude = {
  ...grantInclude,
  enforcementAttempts: {
    orderBy: [{ createdAt: "desc" as const }],
    take: 25,
  },
  versions: {
    orderBy: [{ version: "desc" as const }],
    take: 25,
  },
};

@Injectable()
export class AccessGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly ownerDelegate: OwnerDelegateValidationService,
  ) {}

  async listPermissionCatalog(assetType?: string | null) {
    return this.prisma.accessPermissionCatalog.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(assetType ? { assetType } : {}),
      },
      orderBy: [{ assetType: "asc" }, { action: "asc" }, { version: "desc" }],
    });
  }

  async listProfiles(assetType?: string | null) {
    return this.prisma.accessPermissionProfile.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(assetType ? { assetType } : {}),
      },
      orderBy: [{ assetType: "asc" }, { code: "asc" }, { version: "desc" }],
    });
  }

  async listPrincipals(principalType?: string | null) {
    const type = principalType?.trim().toLowerCase();
    if (type && !ACCESS_GRANT_PRINCIPAL_TYPES.includes(type as never)) {
      throw new BadRequestException("Principal type must be role or group");
    }
    const [roles, groups] = await Promise.all([
      !type || type === "role"
        ? this.prisma.role.findMany({
            where: { isActive: true, deletedAt: null },
            select: { code: true, nameEn: true, nameAr: true },
            orderBy: { nameEn: "asc" },
            take: 500,
          })
        : Promise.resolve([]),
      !type || type === "group"
        ? this.prisma.accessPrincipalDirectory.findMany({
            where: { principalType: "group", isActive: true, deletedAt: null },
            select: {
              externalId: true,
              nameEn: true,
              nameAr: true,
              source: true,
              lastSyncedAt: true,
            },
            orderBy: { nameEn: "asc" },
            take: 500,
          })
        : Promise.resolve([]),
    ]);
    return [
      ...roles.map((role) => ({
        type: "role",
        id: role.code,
        label: role.nameEn,
        nameAr: role.nameAr,
        source: "dgop_role_registry",
        active: true,
      })),
      ...groups.map((group) => ({
        type: "group",
        id: group.externalId,
        label: group.nameEn,
        nameAr: group.nameAr,
        source: group.source,
        active: true,
        lastSyncedAt: group.lastSyncedAt,
      })),
    ];
  }

  async listGrants(user: AuthUser, filters: ListAccessGrantsDto) {
    const where: Prisma.AccessGrantWhereInput = {
      asset: await this.assetVisibilityWhereForUser(user),
    };
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.principalId) where.principalId = filters.principalId;
    if (filters.status) where.status = filters.status;
    const page = parsePageParams(
      filters.page ?? 1,
      filters.pageSize ?? ACCESS_GRANT_DEFAULT_PAGE_SIZE,
    )!;
    const [rows, total] = await Promise.all([
      this.prisma.accessGrant.findMany({
        where,
        include: grantInclude,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.accessGrant.count({ where }),
    ]);
    return toPaged(rows, total, page);
  }

  async accessMatrix(user: AuthUser, query: AccessMatrixQueryDto) {
    const assetLimit = Math.min(
      Math.max(query.assetLimit ?? ACCESS_MATRIX_MAX_ASSETS, 1),
      ACCESS_MATRIX_MAX_ASSETS,
    );
    const assetPage = Math.max(query.assetPage ?? 1, 1);
    const principalLimit = Math.min(
      Math.max(query.principalLimit ?? ACCESS_MATRIX_MAX_PRINCIPALS, 1),
      ACCESS_MATRIX_MAX_PRINCIPALS,
    );
    const principalTypes = query.principalType?.length
      ? query.principalType
      : ["role", "group"];
    const principalSelections = (query.principalKey ?? []).map((key) => {
      const separator = key.indexOf(":");
      return { type: key.slice(0, separator), id: key.slice(separator + 1) };
    });
    const selectedPrincipalKeys = new Set(query.principalKey ?? []);
    const selectedRoleIds = principalSelections
      .filter((principal) => principal.type === "role")
      .map((principal) => principal.id);
    const selectedGroupIds = principalSelections
      .filter((principal) => principal.type === "group")
      .map((principal) => principal.id);
    const selectedPrincipalWhere = principalSelections.map((principal) => ({
      principalType: principal.type,
      principalId: principal.id,
    }));
    const grantFilter: Prisma.AccessGrantWhereInput = {
      principalType: { in: principalTypes },
      ...(query.profileId?.length
        ? { profileId: { in: query.profileId } }
        : {}),
      ...(query.permissionCode?.length
        ? {
            permissions: {
              some: { permissionCode: { in: query.permissionCode } },
            },
          }
        : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.enforcementStatus?.length
        ? { enforcementStatus: { in: query.enforcementStatus } }
        : {}),
    };
    const hasGrantFilter = Boolean(
      query.profileId?.length ||
      query.permissionCode?.length ||
      query.status?.length ||
      query.enforcementStatus?.length,
    );
    const assetSearch = query.assetSearch?.trim();
    const assetWhere: Prisma.DataAssetWhereInput = {
      ...(await this.assetVisibilityWhereForUser(user)),
      ...(query.assetType?.length
        ? { assetType: { in: query.assetType } }
        : {}),
      ...(query.domainId ? { domainId: query.domainId } : {}),
      ...(query.classificationId
        ? { classificationId: query.classificationId }
        : {}),
      ...(query.systemId ? { systemId: query.systemId } : {}),
      ...(assetSearch
        ? {
            OR: [
              { code: { contains: assetSearch, mode: "insensitive" } },
              { nameEn: { contains: assetSearch, mode: "insensitive" } },
              { nameAr: { contains: assetSearch, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(hasGrantFilter ? { accessGrants: { some: grantFilter } } : {}),
    };
    const direction = query.sortDirection ?? "asc";
    const assetOrderBy: Prisma.DataAssetOrderByWithRelationInput =
      query.sortBy === "name"
        ? { nameEn: direction }
        : query.sortBy === "asset_type"
          ? { assetType: direction }
          : { code: direction };
    const [assets, totalAssets] = await Promise.all([
      this.prisma.dataAsset.findMany({
        where: assetWhere,
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAr: true,
          assetType: true,
          assetSubtype: true,
          lifecycleStatus: true,
          ownerStatus: true,
          ownerName: true,
          domain: {
            select: { id: true, code: true, nameEn: true, nameAr: true },
          },
          classification: {
            select: { id: true, code: true, nameEn: true, nameAr: true },
          },
          system: {
            select: { id: true, code: true, nameEn: true, nameAr: true },
          },
        },
        orderBy: [assetOrderBy, { id: "asc" }],
        skip: (assetPage - 1) * assetLimit,
        take: assetLimit,
      }),
      this.prisma.dataAsset.count({ where: assetWhere }),
    ]);
    const assetIds = assets.map((asset) => asset.id);
    const principalSearch = query.principalSearch?.trim();
    const [roles, groups, referencedPrincipals, permissions] =
      await Promise.all([
        principalTypes.includes("role") &&
        (!principalSelections.length || selectedRoleIds.length)
          ? this.prisma.role.findMany({
              where: {
                isActive: true,
                deletedAt: null,
                ...(principalSelections.length
                  ? { code: { in: selectedRoleIds } }
                  : {}),
                ...(principalSearch
                  ? {
                      OR: [
                        {
                          code: {
                            contains: principalSearch,
                            mode: "insensitive",
                          },
                        },
                        {
                          nameEn: {
                            contains: principalSearch,
                            mode: "insensitive",
                          },
                        },
                        {
                          nameAr: {
                            contains: principalSearch,
                            mode: "insensitive",
                          },
                        },
                      ],
                    }
                  : {}),
              },
              select: { code: true, nameEn: true, nameAr: true },
              orderBy: [{ code: "asc" }],
              take: principalLimit,
            })
          : Promise.resolve([]),
        principalTypes.includes("group") &&
        (!principalSelections.length || selectedGroupIds.length)
          ? this.prisma.accessPrincipalDirectory.findMany({
              where: {
                principalType: "group",
                isActive: true,
                deletedAt: null,
                ...(principalSelections.length
                  ? { externalId: { in: selectedGroupIds } }
                  : {}),
                ...(principalSearch
                  ? {
                      OR: [
                        {
                          externalId: {
                            contains: principalSearch,
                            mode: "insensitive",
                          },
                        },
                        {
                          nameEn: {
                            contains: principalSearch,
                            mode: "insensitive",
                          },
                        },
                        {
                          nameAr: {
                            contains: principalSearch,
                            mode: "insensitive",
                          },
                        },
                      ],
                    }
                  : {}),
              },
              select: {
                externalId: true,
                nameEn: true,
                nameAr: true,
                source: true,
              },
              orderBy: [{ externalId: "asc" }],
              take: principalLimit,
            })
          : Promise.resolve([]),
        assetIds.length
          ? this.prisma.accessGrant.findMany({
              where: {
                assetId: { in: assetIds },
                ...grantFilter,
                ...(selectedPrincipalWhere.length
                  ? { OR: selectedPrincipalWhere }
                  : {}),
                ...(principalSearch
                  ? {
                      principalId: {
                        contains: principalSearch,
                        mode: "insensitive",
                      },
                    }
                  : {}),
              },
              select: {
                principalType: true,
                principalId: true,
              },
              distinct: ["principalType", "principalId"],
              orderBy: [{ principalType: "asc" }, { principalId: "asc" }],
              take: principalLimit,
            })
          : Promise.resolve([]),
        this.prisma.accessPermissionCatalog.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            ...(query.assetType?.length
              ? { assetType: { in: query.assetType } }
              : {}),
          },
          select: {
            code: true,
            assetType: true,
            action: true,
            nameEn: true,
            nameAr: true,
            description: true,
            riskLevel: true,
          },
          orderBy: [{ assetType: "asc" }, { action: "asc" }],
          take: 1_000,
        }),
      ]);

    const principalMap = new Map<
      string,
      {
        type: string;
        id: string;
        label: string;
        nameAr?: string | null;
        source: string;
      }
    >();
    for (const role of roles) {
      principalMap.set(`role:${role.code}`, {
        type: "role",
        id: role.code,
        label: role.nameEn,
        nameAr: role.nameAr,
        source: "dgop_role_registry",
      });
    }
    for (const group of groups) {
      principalMap.set(`group:${group.externalId}`, {
        type: "group",
        id: group.externalId,
        label: group.nameEn,
        nameAr: group.nameAr,
        source: group.source,
      });
    }
    for (const principal of referencedPrincipals) {
      const key = `${principal.principalType}:${principal.principalId}`;
      if (!principalMap.has(key)) {
        principalMap.set(key, {
          type: principal.principalType,
          id: principal.principalId,
          label: principal.principalId,
          source: "grant_reference",
        });
      }
    }
    const referencedPrincipalKeys = new Set(
      referencedPrincipals.map(
        (principal) => `${principal.principalType}:${principal.principalId}`,
      ),
    );
    const principals = [...principalMap.values()]
      .filter(
        (principal) =>
          !selectedPrincipalKeys.size ||
          selectedPrincipalKeys.has(`${principal.type}:${principal.id}`),
      )
      .sort((left, right) => {
        const leftReferenced = referencedPrincipalKeys.has(
          `${left.type}:${left.id}`,
        );
        const rightReferenced = referencedPrincipalKeys.has(
          `${right.type}:${right.id}`,
        );
        if (leftReferenced !== rightReferenced) return leftReferenced ? -1 : 1;
        return `${left.type}:${left.id}`.localeCompare(
          `${right.type}:${right.id}`,
        );
      })
      .slice(0, principalLimit);
    const principalKeys = new Set(
      principals.map((principal) => `${principal.type}:${principal.id}`),
    );
    const principalWhere = principals.map((principal) => ({
      principalType: principal.type,
      principalId: principal.id,
    }));
    const matrixGrantWhere: Prisma.AccessGrantWhereInput = {
      assetId: { in: assetIds },
      ...grantFilter,
      OR: principalWhere,
    };
    const matrixGrantCount =
      assetIds.length && principalWhere.length
        ? await this.prisma.accessGrant.count({ where: matrixGrantWhere })
        : 0;
    if (matrixGrantCount > ACCESS_MATRIX_MAX_GRANTS) {
      throw new BadRequestException(
        `Matrix selection contains ${matrixGrantCount} grants; narrow the asset or principal filters below ${ACCESS_MATRIX_MAX_GRANTS}`,
      );
    }
    const grants = matrixGrantCount
      ? await this.prisma.accessGrant.findMany({
          where: matrixGrantWhere,
          select: {
            id: true,
            code: true,
            assetId: true,
            principalType: true,
            principalId: true,
            permissionCode: true,
            profile: {
              select: {
                id: true,
                code: true,
                nameEn: true,
                nameAr: true,
                version: true,
              },
            },
            permissions: {
              select: {
                permissionCode: true,
                permission: {
                  select: {
                    action: true,
                    nameEn: true,
                    nameAr: true,
                    riskLevel: true,
                  },
                },
              },
            },
            status: true,
            ownerDecision: true,
            enforcementStatus: true,
            startsAt: true,
            expiresAt: true,
            updatedAt: true,
            reviewItems: {
              select: { decision: true, reviewedAt: true, reviewer: true },
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: ACCESS_MATRIX_MAX_GRANTS,
        })
      : [];
    const cellMap = new Map<string, typeof grants>();
    for (const grant of grants) {
      const principalKey = `${grant.principalType}:${grant.principalId}`;
      if (!principalKeys.has(principalKey)) continue;
      const key = `${grant.assetId}:${principalKey}`;
      const rows = cellMap.get(key) ?? [];
      rows.push(grant);
      cellMap.set(key, rows);
    }
    const cells = assets.flatMap((asset) =>
      principals.map((principal) => {
        const rows =
          cellMap.get(`${asset.id}:${principal.type}:${principal.id}`) ?? [];
        const liveRows = rows.filter(
          (grant) => !TERMINAL_GRANT_STATUSES.includes(grant.status as never),
        );
        const visibleRows = liveRows.length ? liveRows : rows.slice(0, 1);
        const enforced = visibleRows.filter(
          (grant) => grant.enforcementStatus === "enforced",
        ).length;
        const permissionRows = visibleRows.flatMap(
          (grant) => grant.permissions,
        );
        const permissionCodes = [
          ...new Set(
            permissionRows.map((permission) => permission.permissionCode),
          ),
        ];
        const highRiskPermissions = [
          ...new Set(
            permissionRows
              .filter(
                (permission) => permission.permission.riskLevel === "high",
              )
              .map((permission) => permission.permissionCode),
          ),
        ];
        const riskLevels = new Set(
          permissionRows.map((permission) => permission.permission.riskLevel),
        );
        const profileRows = visibleRows
          .map((grant) => grant.profile)
          .filter((profile) => profile !== null);
        const profileNames = [
          ...new Set(profileRows.map((profile) => profile.nameEn)),
        ];
        const hasCustom = visibleRows.some((grant) => !grant.profile);
        const displayValue = !visibleRows.length
          ? "No Access"
          : profileNames.length === 1 && !hasCustom
            ? profileNames[0]
            : hasCustom && profileNames.length === 0
              ? "Custom"
              : "Mixed";
        const now = Date.now();
        const expiresSoon = visibleRows.some(
          (grant) =>
            grant.expiresAt &&
            grant.expiresAt.getTime() > now &&
            grant.expiresAt.getTime() <= now + 30 * 86_400_000,
        );
        const accessState = !visibleRows.length
          ? "no_access"
          : visibleRows.some((grant) => grant.status === "revocation_failed")
            ? "revocation_failed"
            : visibleRows.some((grant) => grant.enforcementStatus === "failed")
              ? "enforcement_failed"
              : visibleRows.some(
                    (grant) => grant.status === "pending_revocation",
                  )
                ? "pending_revocation"
                : visibleRows.some(
                      (grant) =>
                        grant.ownerDecision === "pending" ||
                        grant.status === "requested",
                    )
                  ? "under_review"
                  : visibleRows.some(
                        (grant) => grant.enforcementStatus === "pending",
                      )
                    ? "pending_enforcement"
                    : visibleRows.some((grant) => grant.status === "scheduled")
                      ? "scheduled"
                      : expiresSoon
                        ? "expiring"
                        : (visibleRows[0]?.status ?? "active");
        const lastReviewedAt = visibleRows.reduce<Date | null>(
          (latest, grant) => {
            const reviewedAt = grant.reviewItems[0]?.reviewedAt ?? null;
            return reviewedAt && (!latest || reviewedAt > latest)
              ? reviewedAt
              : latest;
          },
          null,
        );
        const lastModifiedAt = visibleRows.reduce<Date | null>(
          (latest, grant) =>
            !latest || grant.updatedAt > latest ? grant.updatedAt : latest,
          null,
        );
        return {
          assetId: asset.id,
          principalType: principal.type,
          principalId: principal.id,
          grantCount: visibleRows.length,
          enforcedCount: enforced,
          displayValue,
          accessState,
          profileNames,
          permissions: permissionCodes,
          privilegeClasses: [
            ...new Set(
              permissionRows.map((permission) =>
                this.permissionClass(permission.permission.action),
              ),
            ),
          ],
          riskLevel: highRiskPermissions.length
            ? "high"
            : riskLevels.has("medium")
              ? "medium"
              : riskLevels.has("low")
                ? "low"
                : "none",
          highRiskPermissions,
          statuses: [...new Set(visibleRows.map((grant) => grant.status))],
          ownerDecisions: [
            ...new Set(visibleRows.map((grant) => grant.ownerDecision)),
          ],
          enforcementStatuses: [
            ...new Set(visibleRows.map((grant) => grant.enforcementStatus)),
          ],
          reviewStatus: visibleRows.some(
            (grant) => grant.reviewItems[0]?.decision === "pending",
          )
            ? "under_review"
            : visibleRows.some((grant) => grant.reviewItems.length)
              ? "reviewed"
              : "not_reviewed",
          lastReviewedAt,
          lastModifiedAt,
          attention: [
            "under_review",
            "pending_enforcement",
            "enforcement_failed",
            "pending_revocation",
            "revocation_failed",
            "expiring",
          ].includes(accessState),
          grants: visibleRows.map((grant) => ({
            id: grant.id,
            code: grant.code,
            permissionCode: grant.permissionCode,
            permissionCodes: this.grantPermissionCodes(grant),
            profile: grant.profile,
            status: grant.status,
            ownerDecision: grant.ownerDecision,
            enforcementStatus: grant.enforcementStatus,
            startsAt: grant.startsAt,
            expiresAt: grant.expiresAt,
            updatedAt: grant.updatedAt,
          })),
        };
      }),
    );
    return {
      assets,
      principals,
      permissions,
      cells,
      summary: {
        assetCount: assets.length,
        totalAssets,
        assetPage,
        assetPageCount: Math.max(Math.ceil(totalAssets / assetLimit), 1),
        principalCount: principals.length,
        grantedCells: cells.filter((cell) => cell.grantCount > 0).length,
        attentionCells: cells.filter((cell) => cell.attention).length,
        highRiskCells: cells.filter((cell) => cell.riskLevel === "high").length,
        readCells: cells.filter((cell) =>
          cell.privilegeClasses.includes("read"),
        ).length,
        writeCells: cells.filter((cell) =>
          cell.privilegeClasses.includes("write"),
        ).length,
      },
      constraints: {
        assetLimit,
        principalLimit,
        maximumAssets: ACCESS_MATRIX_MAX_ASSETS,
        maximumPrincipals: ACCESS_MATRIX_MAX_PRINCIPALS,
        maximumGrants: ACCESS_MATRIX_MAX_GRANTS,
        note: "Matrix cells are derived from the governed authorization record. Oversized selections must be narrowed; No Access is the default state.",
      },
    };
  }

  async listEffectiveAccess(user: AuthUser, filters: ListEffectiveAccessDto) {
    const now = new Date();
    const page = parsePageParams(
      filters.page ?? 1,
      filters.pageSize ?? ACCESS_GRANT_DEFAULT_PAGE_SIZE,
    )!;
    const where: Prisma.AccessGrantWhereInput = {
      asset: await this.assetVisibilityWhereForUser(user),
      ownerDecision: "approved",
      status: { in: ["active", "scheduled", "expired", "revoked"] },
    };
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.principalId) where.principalId = filters.principalId;
    if (filters.principalType) where.principalType = filters.principalType;
    const summary = {
      totalEffectiveRows: 0,
      current: 0,
      scheduled: 0,
      expired: 0,
      revoked: 0,
      enforcementGaps: 0,
      externalUnverified: 0,
    };
    const data: EffectiveAccessRow[] = [];
    let sourceOffset = 0;
    while (true) {
      const grants = await this.prisma.accessGrant.findMany({
        where,
        include: grantInclude,
        orderBy: [
          { assetId: "asc" },
          { principalType: "asc" },
          { principalId: "asc" },
          { permissionCode: "asc" },
          { id: "asc" },
        ],
        skip: sourceOffset,
        take: EFFECTIVE_ACCESS_BATCH_SIZE,
      });
      if (!grants.length) break;

      const userIds = [
        ...new Set(
          grants
            .filter((grant) => grant.principalType === "user")
            .map((grant) => grant.principalId),
        ),
      ];
      const roleCodes = [
        ...new Set(
          grants
            .filter((grant) => grant.principalType === "role")
            .map((grant) => grant.principalId),
        ),
      ];
      const [users, roleMemberships] = await Promise.all([
        userIds.length
          ? this.prisma.user.findMany({
              where: { id: { in: userIds }, isActive: true },
              select: { id: true, email: true, displayName: true },
            })
          : Promise.resolve([]),
        roleCodes.length
          ? this.prisma.userRole.findMany({
              where: {
                role: {
                  code: { in: roleCodes },
                  isActive: true,
                  deletedAt: null,
                },
                user: { isActive: true },
              },
              select: {
                userId: true,
                user: { select: { id: true, email: true, displayName: true } },
                role: { select: { id: true, code: true, nameEn: true } },
              },
              orderBy: [{ roleId: "asc" }, { userId: "asc" }],
            })
          : Promise.resolve([]),
      ]);
      const userById = new Map(users.map((row) => [row.id, row] as const));
      const membershipsByRoleCode = new Map<string, typeof roleMemberships>();
      for (const membership of roleMemberships) {
        const memberships =
          membershipsByRoleCode.get(membership.role.code) ?? [];
        memberships.push(membership);
        membershipsByRoleCode.set(membership.role.code, memberships);
      }

      for (const grant of grants) {
        const lifecycleState = this.effectiveAccessLifecycle(
          grant.startsAt,
          grant.expiresAt,
          grant.status,
          now,
        );
        const enforcementGap =
          grant.enforcementStatus !== "enforced" &&
          lifecycleState === "current";
        const base = {
          grantId: grant.id,
          grantCode: grant.code,
          grantVersion: grant.version,
          asset: grant.asset,
          principalType: grant.principalType,
          principalId: grant.principalId,
          permissionCode: grant.permissionCode,
          permissionCodes: this.grantPermissionCodes(grant),
          grantStatus: grant.status,
          ownerDecision: grant.ownerDecision,
          enforcementStatus: grant.enforcementStatus,
          startsAt: grant.startsAt,
          expiresAt: grant.expiresAt,
          lifecycleState,
          enforcementGap,
        };
        const expandedRows: EffectiveAccessRow[] =
          grant.principalType === "user"
            ? [
                {
                  ...base,
                  subjectType: "user",
                  subjectId: grant.principalId,
                  subjectLabel:
                    userById.get(grant.principalId)?.displayName ||
                    userById.get(grant.principalId)?.email ||
                    grant.principalId,
                  expansionStatus: userById.has(grant.principalId)
                    ? "resolved"
                    : "missing_user",
                  source: "direct_grant",
                },
              ]
            : grant.principalType === "role"
              ? membershipsByRoleCode.get(grant.principalId)?.length
                ? membershipsByRoleCode
                    .get(grant.principalId)!
                    .map((membership) => ({
                      ...base,
                      subjectType: "user",
                      subjectId: membership.userId,
                      subjectLabel:
                        membership.user.displayName || membership.user.email,
                      expandedFromRoleCode: membership.role.code,
                      expandedFromRoleName: membership.role.nameEn,
                      expansionStatus: "resolved",
                      source: "role_membership",
                    }))
                : [
                    {
                      ...base,
                      subjectType: "role",
                      subjectId: grant.principalId,
                      subjectLabel: grant.principalId,
                      expansionStatus: "no_active_members",
                      source: "role_grant",
                    },
                  ]
              : [
                  {
                    ...base,
                    subjectType: grant.principalType,
                    subjectId: grant.principalId,
                    subjectLabel: grant.principalId,
                    expansionStatus: "external_unverified",
                    source: "external_principal",
                  },
                ];

        for (const row of expandedRows) {
          const rowNumber = summary.totalEffectiveRows;
          if (rowNumber >= page.skip && data.length < page.take) data.push(row);
          summary.totalEffectiveRows++;
          if (row.lifecycleState === "current") summary.current++;
          if (row.lifecycleState === "scheduled") summary.scheduled++;
          if (row.lifecycleState === "expired") summary.expired++;
          if (row.lifecycleState === "revoked") summary.revoked++;
          if (row.enforcementGap) summary.enforcementGaps++;
          if (row.expansionStatus === "external_unverified")
            summary.externalUnverified++;
        }
      }
      sourceOffset += grants.length;
      if (grants.length < EFFECTIVE_ACCESS_BATCH_SIZE) break;
    }
    return {
      ...toPaged(data, summary.totalEffectiveRows, page),
      summary,
      processedGrantCount: sourceOffset,
    };
  }

  async accessManagementReport(user: AuthUser) {
    const now = new Date();
    const inThirtyDays = new Date(now.getTime() + 30 * 86_400_000);
    const grants = await this.prisma.accessGrant.findMany({
      where: { asset: await this.assetVisibilityWhereForUser(user) },
      select: {
        id: true,
        status: true,
        principalType: true,
        ownerDecision: true,
        enforcementStatus: true,
        startsAt: true,
        expiresAt: true,
        createdAt: true,
        asset: { select: { assetType: true } },
        permissions: {
          select: { permission: { select: { riskLevel: true } } },
        },
        _count: { select: { reviewItems: true, enforcementAttempts: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });
    const group = (values: string[]) =>
      Object.entries(
        values.reduce<Record<string, number>>((result, value) => {
          result[value] = (result[value] ?? 0) + 1;
          return result;
        }, {}),
      )
        .map(([code, count]) => ({ code, count }))
        .sort(
          (left, right) =>
            right.count - left.count || left.code.localeCompare(right.code),
        );
    const highRisk = grants.filter((grant) =>
      grant.permissions.some(
        (permission) => permission.permission.riskLevel === "high",
      ),
    );
    const expiring = grants.filter(
      (grant) =>
        grant.expiresAt &&
        grant.expiresAt > now &&
        grant.expiresAt <= inThirtyDays,
    );
    const enforcementFailures = grants.filter(
      (grant) =>
        grant.enforcementStatus === "failed" ||
        grant.status === "revocation_failed",
    );
    const active = grants.filter((grant) =>
      ["active", "scheduled", "expiring"].includes(grant.status),
    );
    return {
      generatedAt: now,
      truncated: grants.length === 10_000,
      summary: {
        totalGrants: grants.length,
        activeGrants: active.length,
        pendingOwnerDecision: grants.filter(
          (grant) => grant.ownerDecision === "pending",
        ).length,
        pendingEnforcement: grants.filter(
          (grant) => grant.enforcementStatus === "pending",
        ).length,
        enforcementFailures: enforcementFailures.length,
        expiringWithin30Days: expiring.length,
        highRiskGrants: highRisk.length,
        grantsWithoutExpiry: active.filter((grant) => !grant.expiresAt).length,
        reviewedGrants: grants.filter((grant) => grant._count.reviewItems > 0)
          .length,
        connectorAttempts: grants.reduce(
          (total, grant) => total + grant._count.enforcementAttempts,
          0,
        ),
      },
      byAssetType: group(grants.map((grant) => grant.asset.assetType)),
      byStatus: group(grants.map((grant) => grant.status)),
      byPrincipalType: group(grants.map((grant) => grant.principalType)),
      byEnforcementStatus: group(
        grants.map((grant) => grant.enforcementStatus),
      ),
      attention: {
        enforcementFailures: enforcementFailures.length,
        pendingRevocation: grants.filter((grant) =>
          ["pending_revocation", "revocation_failed"].includes(grant.status),
        ).length,
        expiringWithin30Days: expiring.length,
        highRiskWithoutExpiry: highRisk.filter((grant) => !grant.expiresAt)
          .length,
        neverReviewed: grants.filter((grant) => grant._count.reviewItems === 0)
          .length,
      },
    };
  }

  async getGrant(id: string, user: AuthUser) {
    const grant = await this.prisma.accessGrant.findFirst({
      where: { id, asset: await this.assetVisibilityWhereForUser(user) },
      include: grantDetailInclude,
    });
    if (!grant) throw new NotFoundException("access grant not found");
    return grant;
  }

  async createGrant(dto: CreateAccessGrantDto, user: AuthUser) {
    const asset = await this.assertAssetVisible(user.roles, dto.assetId);
    await this.assertOwnerAuthority(user, asset.id);
    await this.assertPrincipalExists(dto.principalType, dto.principalId);
    const requestedPermissionCodes = [
      ...new Set(
        [
          ...(dto.permissionCodes ?? []),
          ...(dto.permissionCode ? [dto.permissionCode] : []),
        ]
          .map((code) => code.trim())
          .filter(Boolean),
      ),
    ];
    const profile = dto.profileId
      ? await this.assertProfile(dto.profileId, asset.assetType)
      : null;
    const permissionCodes = profile
      ? this.permissionCodes(profile.permissionCodesJson)
      : requestedPermissionCodes;
    if (!permissionCodes.length) {
      throw new BadRequestException(
        "Select a standard profile or at least one custom permission",
      );
    }
    const permissions = await this.assertPermissionsForAssetType(
      permissionCodes,
      asset.assetType,
    );
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    this.assertGrantDates(startsAt, expiresAt);
    if (dto.workflowCaseId)
      await this.assertWorkflowCaseVisible(user.roles, dto.workflowCaseId);
    const duplicate = await this.prisma.accessGrant.findFirst({
      where: {
        assetId: asset.id,
        principalType: dto.principalType,
        principalId: dto.principalId,
        status: { notIn: [...TERMINAL_GRANT_STATUSES] },
      },
      select: { code: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        `An active assignment already exists for this asset and principal (${duplicate.code})`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const grant = await tx.accessGrant.create({
        data: {
          code: await this.nextGrantCode(tx),
          assetId: asset.id,
          principalType: dto.principalType,
          principalId: dto.principalId,
          permissionCode: permissionCodes[0],
          profileId: profile?.id ?? null,
          startsAt,
          expiresAt,
          justification: dto.justification.trim(),
          workflowCaseId: dto.workflowCaseId ?? null,
          createdBy: user.email,
          updatedBy: user.email,
          permissions: {
            create: permissionCodes.map((permissionCode) => ({
              permissionCode,
              source: profile ? "profile" : "custom",
            })),
          },
        },
        include: grantInclude,
      });
      await this.audit.logRequired(
        {
          actor: user.email,
          action: "access_grant.requested",
          entityType: "access_grant",
          entityId: grant.id,
          metadata: {
            code: grant.code,
            assetId: grant.assetId,
            assetType: asset.assetType,
            permissionCodes,
            highRiskPermissions: permissions
              .filter((permission) => permission.riskLevel === "high")
              .map((permission) => permission.code),
            profileId: grant.profileId,
            principalType: grant.principalType,
            principalId: grant.principalId,
          },
        },
        tx,
      );
      await tx.accessGrantVersion.create({
        data: {
          grantId: grant.id,
          version: grant.version,
          snapshotJson: this.grantSnapshot(grant, permissionCodes),
          changeReason: "Initial governed access request",
          changedBy: user.email,
        },
      });
      return grant;
    });
    return created;
  }

  async createBulkGrants(dto: BulkCreateAccessGrantDto, user: AuthUser) {
    const uniqueCells = [
      ...new Map(
        dto.cells.map((cell) => [
          `${cell.assetId}:${cell.principalType}:${cell.principalId}`,
          { ...cell, principalId: cell.principalId.trim() },
        ]),
      ).values(),
    ];
    const writeVisibility = await this.assetWriteVisibilityWhere(user);
    const assetIds = [...new Set(uniqueCells.map((cell) => cell.assetId))];
    const assets = await this.prisma.dataAsset.findMany({
      where: { id: { in: assetIds }, ...writeVisibility },
      select: { id: true, code: true, assetType: true },
    });
    if (assets.length !== assetIds.length) {
      throw new ForbiddenException(
        "One or more selected assets are outside your active owner or delegate authority",
      );
    }
    const assetById = new Map(
      assets.map((asset) => [asset.id, asset] as const),
    );
    for (const principal of [
      ...new Map(
        uniqueCells.map((cell) => [
          `${cell.principalType}:${cell.principalId}`,
          cell,
        ]),
      ).values(),
    ]) {
      await this.assertPrincipalExists(
        principal.principalType,
        principal.principalId,
      );
    }
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    this.assertGrantDates(startsAt, expiresAt);
    const requestedCodes = [
      ...new Set(
        (dto.permissionCodes ?? []).map((code) => code.trim()).filter(Boolean),
      ),
    ];
    const assetTypes = [...new Set(assets.map((asset) => asset.assetType))];
    if (dto.profileId && assetTypes.length > 1) {
      throw new BadRequestException(
        "A standard profile can only be applied to selected assets of the same type",
      );
    }
    const profile = dto.profileId
      ? await this.assertProfile(dto.profileId, assetTypes[0])
      : null;
    const permissionCodes = profile
      ? this.permissionCodes(profile.permissionCodesJson)
      : requestedCodes;
    if (!permissionCodes.length)
      throw new BadRequestException(
        "Select a standard profile or at least one custom permission",
      );
    for (const assetType of assetTypes)
      await this.assertPermissionsForAssetType(permissionCodes, assetType);

    const existing = await this.prisma.accessGrant.findMany({
      where: {
        assetId: { in: assetIds },
        status: { notIn: [...TERMINAL_GRANT_STATUSES] },
        OR: uniqueCells.map((cell) => ({
          assetId: cell.assetId,
          principalType: cell.principalType,
          principalId: cell.principalId,
        })),
      },
      select: {
        code: true,
        assetId: true,
        principalType: true,
        principalId: true,
      },
      take: 501,
    });
    if (existing.length) {
      throw new BadRequestException(
        `Bulk change conflicts with ${existing.length} active assignment(s), including ${existing[0].code}`,
      );
    }

    const grants = await this.prisma.$transaction(async (tx) => {
      const created: Array<{ id: string; code: string; version: number }> = [];
      for (const cell of uniqueCells) {
        const asset = assetById.get(cell.assetId)!;
        const grant = await tx.accessGrant.create({
          data: {
            code: await this.nextGrantCode(tx),
            assetId: cell.assetId,
            principalType: cell.principalType,
            principalId: cell.principalId,
            permissionCode: permissionCodes[0],
            profileId: profile?.id ?? null,
            startsAt,
            expiresAt,
            justification: dto.justification.trim(),
            createdBy: user.email,
            updatedBy: user.email,
            permissions: {
              create: permissionCodes.map((permissionCode) => ({
                permissionCode,
                source: profile ? "profile" : "custom",
              })),
            },
          },
          include: grantInclude,
        });
        await tx.accessGrantVersion.create({
          data: {
            grantId: grant.id,
            version: grant.version,
            snapshotJson: this.grantSnapshot(grant, permissionCodes),
            changeReason: dto.changeReason.trim(),
            changedBy: user.email,
          },
        });
        await this.audit.logRequired(
          {
            actor: user.email,
            action: "access_grant.bulk_requested",
            entityType: "access_grant",
            entityId: grant.id,
            metadata: {
              code: grant.code,
              assetId: asset.id,
              assetCode: asset.code,
              principalType: cell.principalType,
              principalId: cell.principalId,
              permissionCodes,
              changeReason: dto.changeReason.trim(),
            },
          },
          tx,
        );
        created.push(grant);
      }
      return created;
    });
    return {
      committed: true,
      grantCount: grants.length,
      assetCount: assetIds.length,
      principalCount: new Set(
        uniqueCells.map((cell) => `${cell.principalType}:${cell.principalId}`),
      ).size,
      permissionCodes,
      grants,
    };
  }

  async updateGrant(id: string, dto: UpdateAccessGrantDto, user: AuthUser) {
    const existing = await this.getGrant(id, user);
    await this.assertOwnerAuthority(user, existing.assetId);
    if (TERMINAL_GRANT_STATUSES.includes(existing.status as never)) {
      throw new BadRequestException(
        "Expired, rejected, or revoked grants cannot be modified; create a new assignment",
      );
    }
    if (existing.version !== dto.expectedVersion) {
      throw new BadRequestException(
        `Stale grant version: expected ${dto.expectedVersion}, current ${existing.version}`,
      );
    }
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const expiresAt =
      dto.expiresAt === undefined
        ? existing.expiresAt
        : dto.expiresAt
          ? new Date(dto.expiresAt)
          : null;
    this.assertGrantDates(startsAt, expiresAt);
    const requestedCodes = dto.permissionCodes
      ? [
          ...new Set(
            dto.permissionCodes.map((code) => code.trim()).filter(Boolean),
          ),
        ]
      : null;
    const profile = dto.profileId
      ? await this.assertProfile(dto.profileId, existing.asset.assetType)
      : null;
    const permissionCodes = profile
      ? this.permissionCodes(profile.permissionCodesJson)
      : (requestedCodes ?? this.grantPermissionCodes(existing));
    if (!permissionCodes.length)
      throw new BadRequestException("At least one permission is required");
    const permissions = await this.assertPermissionsForAssetType(
      permissionCodes,
      existing.asset.assetType,
    );

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.accessGrant.updateMany({
        where: { id, version: dto.expectedVersion },
        data: { updatedBy: user.email },
      });
      if (claimed.count !== 1)
        throw new BadRequestException(
          "Grant changed before the update could be committed",
        );
      const grant = await tx.accessGrant.update({
        where: { id },
        data: {
          permissionCode: permissionCodes[0],
          profileId:
            dto.profileId === undefined ? existing.profileId : dto.profileId,
          startsAt,
          expiresAt,
          justification: dto.justification?.trim() || existing.justification,
          ownerDecision: "pending",
          ownerDecisionBy: null,
          ownerDecisionAt: null,
          status: "requested",
          enforcementStatus: "not_enforced",
          updatedBy: user.email,
          version: { increment: 1 },
          permissions: {
            deleteMany: {},
            create: permissionCodes.map((permissionCode) => ({
              permissionCode,
              source: profile ? "profile" : "custom",
            })),
          },
        },
        include: grantInclude,
      });
      await tx.accessGrantVersion.create({
        data: {
          grantId: grant.id,
          version: grant.version,
          snapshotJson: this.grantSnapshot(grant, permissionCodes),
          changeReason: dto.changeReason.trim(),
          changedBy: user.email,
        },
      });
      await this.audit.logRequired(
        {
          actor: user.email,
          action: "access_grant.modified",
          entityType: "access_grant",
          entityId: grant.id,
          metadata: {
            previousVersion: existing.version,
            newVersion: grant.version,
            permissionCodes,
            highRiskPermissions: permissions
              .filter((permission) => permission.riskLevel === "high")
              .map((permission) => permission.code),
            changeReason: dto.changeReason.trim(),
          },
        },
        tx,
      );
      return grant;
    });
  }

  async decideGrant(id: string, dto: DecideAccessGrantDto, user: AuthUser) {
    const existing = await this.getGrant(id, user);
    if (!isSystemAdministrator(user.roles) && (existing.createdBy === user.email || existing.ownerDecision === 'pending' && existing.updatedBy === user.email)) throw new ForbiddenException('Grant creators and pending-request editors cannot approve or reject their own requests');
    if (!ACTIVE_GRANT_STATUSES.has(existing.status)) {
      throw new BadRequestException(
        "Only requested or active grants can receive an owner decision",
      );
    }
    await this.assertBusinessOwnerAuthority(user, existing.assetId);
    const approved = dto.decision === "approved";
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.claimGrantVersion(tx, id, dto.expectedVersion);
      const now = new Date();
      const approvedStatus =
        approved && existing.startsAt > now ? "scheduled" : "active";
      const grant = await tx.accessGrant.update({
        where: { id },
        data: {
          ownerDecision: dto.decision,
          ownerDecisionBy: user.email,
          ownerDecisionAt: new Date(),
          status: approved ? approvedStatus : "rejected",
          enforcementStatus: approved ? "pending" : "not_enforced",
          updatedBy: user.email,
          version: { increment: 1 },
        },
        include: grantInclude,
      });
      await this.audit.logRequired(
        {
          actor: user.email,
          action: `access_grant.owner_${dto.decision}`,
          entityType: "access_grant",
          entityId: id,
          metadata: {
            previousStatus: existing.status,
            newStatus: grant.status,
            previousOwnerDecision: existing.ownerDecision,
            newOwnerDecision: dto.decision,
            comment: dto.comment ?? null,
          },
        },
        tx,
      );
      return grant;
    });
    return updated;
  }

  async updateEnforcement(id: string, _dto: UpdateAccessGrantEnforcementDto, user: AuthUser) {
    await this.getGrant(id, user);
    throw new BadRequestException('Direct enforcement status changes are retired; use provider completion or explicit manual evidence');
  }

  async revokeGrant(id: string, dto: RevokeAccessGrantDto, user: AuthUser) {
    const existing = await this.getGrant(id, user);
    await this.assertBusinessOwnerAuthority(user, existing.assetId);
    if (["pending_revocation", "revoked"].includes(existing.status))
      return existing;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.claimGrantVersion(tx, id, dto.expectedVersion);
      const grant = await tx.accessGrant.update({
        where: { id },
        data: {
          status: "pending_revocation",
          enforcementStatus: "pending",
          revokedAt: null,
          revokedBy: user.email,
          revocationReason: dto.reason.trim(),
          updatedBy: user.email,
          version: { increment: 1 },
        },
        include: grantInclude,
      });
      await this.audit.logRequired(
        {
          actor: user.email,
          action: "access_grant.revoked",
          entityType: "access_grant",
          entityId: id,
          metadata: {
            previousStatus: existing.status,
            previousEnforcementStatus: existing.enforcementStatus,
            reason: dto.reason,
          },
        },
        tx,
      );
      return grant;
    });
    return updated;
  }

  accessGrantCsvTemplate() {
    return "action,code,expectedVersion,assetId,principalType,principalId,permissionCode,profileId,startsAt,expiresAt,justification\ncreate,,,<asset-uuid>,role,data_owner,dataset.read,,2026-08-17T00:00:00.000Z,,Business justification\nupdate,AGR-00001,1,,,,,,,,\nrevoke,AGR-00001,1,,,,,,,,";
  }

  async exportGrantsCsv(
    user: AuthUser,
    filters: ListAccessGrantsDto,
  ): Promise<{ fileName: string; csv: string; rowCount: number }> {
    const where: Prisma.AccessGrantWhereInput = {
      asset: await this.assetVisibilityWhereForUser(user),
    };
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.principalId) where.principalId = filters.principalId;
    if (filters.status) where.status = filters.status;
    const grants = await this.prisma.accessGrant.findMany({
      where,
      include: grantInclude,
      orderBy: [{ code: "asc" }],
      take: 10_000,
    });
    const headers = [
      "action",
      "code",
      "expectedVersion",
      "assetId",
      "assetCode",
      "principalType",
      "principalId",
      "permissionCode",
      "profileId",
      "startsAt",
      "expiresAt",
      "status",
      "ownerDecision",
      "enforcementStatus",
      "justification",
    ];
    const lines = grants.map((grant) =>
      [
        "update",
        grant.code,
        grant.version,
        grant.assetId,
        grant.asset.code,
        grant.principalType,
        grant.principalId,
        this.grantPermissionCodes(grant).join("|"),
        grant.profileId ?? "",
        grant.startsAt.toISOString(),
        grant.expiresAt?.toISOString() ?? "",
        grant.status,
        grant.ownerDecision,
        grant.enforcementStatus,
        grant.justification,
      ]
        .map(csvCell)
        .join(","),
    );
    return {
      fileName: `access-grants-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: [headers.join(","), ...lines].join("\n"),
      rowCount: grants.length,
    };
  }

  async validateGrantImport(dto: ValidateAccessGrantImportDto, user: AuthUser) {
    const outcomes = await this.buildGrantImportPlan(dto.csv, user);
    await this.audit.logRequired({
      actor: user.email,
      action: "access_grant.import_validate",
      entityType: "access_grant_import",
      metadata: {
        rows: outcomes.length,
        valid: outcomes.filter((row) => row.valid).length,
        invalid: outcomes.filter((row) => !row.valid).length,
      },
    });
    return this.importPlanResponse(outcomes, true);
  }

  async commitGrantImport(dto: CommitAccessGrantImportDto, user: AuthUser) {
    const plan = await this.buildGrantImportPlan(dto.csv, user);
    const invalid = plan.filter((row) => !row.valid);
    if (invalid.length) {
      throw new BadRequestException(
        `CSV contains ${invalid.length} invalid row(s); validate and correct the change set before committing`,
      );
    }
    if (!plan.length)
      throw new BadRequestException("CSV contains no data rows to commit");
    for (const row of plan) if (row.action === 'revoke' && row.existing) await this.assertBusinessOwnerAuthority(user, row.existing.assetId);
    const committed = await this.prisma.$transaction(async (tx) => {
      const results: Array<{
        row: number;
        action: ImportAction;
        code: string;
        id: string;
        version: number;
      }> = [];
      for (const row of plan) {
        const action = row.action as ImportAction;
        if (action === "create" && row.create) {
          const grant = await tx.accessGrant.create({
            data: {
              code: await this.nextGrantCode(tx),
              assetId: row.create.assetId,
              principalType: row.create.principalType,
              principalId: row.create.principalId,
              permissionCode: row.create.permissionCode,
              profileId: row.create.profileId,
              status: "requested",
              startsAt: row.create.startsAt,
              expiresAt: row.create.expiresAt,
              justification: row.create.justification,
              createdBy: user.email,
              updatedBy: user.email,
              permissions: {
                create: {
                  permissionCode: row.create.permissionCode,
                  source: row.create.profileId ? "profile" : "custom",
                },
              },
            },
            include: grantInclude,
          });
          await tx.accessGrantVersion.create({
            data: {
              grantId: grant.id,
              version: grant.version,
              snapshotJson: this.grantSnapshot(grant, [
                row.create.permissionCode,
              ]),
              changeReason:
                dto.changeReason?.trim() || "Governed CSV change set",
              changedBy: user.email,
            },
          });
          await this.audit.logRequired(
            {
              actor: user.email,
              action: "access_grant.import_create",
              entityType: "access_grant",
              entityId: grant.id,
              metadata: {
                row: row.row,
                code: grant.code,
                permissionCodes: [row.create.permissionCode],
                changeReason: dto.changeReason?.trim() || null,
              },
            },
            tx,
          );
          results.push({
            row: row.row,
            action,
            code: grant.code,
            id: grant.id,
            version: grant.version,
          });
          continue;
        }
        if (action === "update" && row.existing) {
          const expectedVersion = Number(row.values["expectedVersion"]);
          const updated = await tx.accessGrant.updateMany({
            where: { id: row.existing.id, version: expectedVersion },
            data: { ...(row.update ?? {}), updatedBy: user.email },
          });
          if (updated.count !== 1)
            throw new BadRequestException(
              `Row ${row.row} was stale at commit time`,
            );
          const grant = await tx.accessGrant.update({
            where: { id: row.existing.id },
            data: {
              ...(row.profileId
                ? { profile: { connect: { id: row.profileId } } }
                : {}),
              ...(row.values["permissionCode"]
                ? {
                    permissions: {
                      deleteMany: {},
                      create: {
                        permissionCode: row.values["permissionCode"],
                        source: row.profileId ? "profile" : "custom",
                      },
                    },
                  }
                : {}),
              ownerDecision: 'pending',
              ownerDecisionBy: null,
              ownerDecisionAt: null,
              status: 'requested',
              enforcementStatus: 'not_enforced',
              updatedBy: user.email,
              version: { increment: 1 },
            },
            include: grantInclude,
          });
          const permissionCodes = this.grantPermissionCodes(grant);
          await tx.accessGrantVersion.create({
            data: {
              grantId: grant.id,
              version: grant.version,
              snapshotJson: this.grantSnapshot(grant, permissionCodes),
              changeReason:
                dto.changeReason?.trim() || "Governed CSV change set update",
              changedBy: user.email,
            },
          });
          await this.audit.logRequired(
            {
              actor: user.email,
              action: "access_grant.import_update",
              entityType: "access_grant",
              entityId: grant.id,
              metadata: {
                row: row.row,
                code: grant.code,
                expectedVersion,
                newVersion: grant.version,
                permissionCodes,
                changeReason: dto.changeReason?.trim() || null,
              },
            },
            tx,
          );
          results.push({
            row: row.row,
            action,
            code: grant.code,
            id: grant.id,
            version: grant.version,
          });
          continue;
        }
        if (action === "revoke" && row.existing) {
          const expectedVersion = Number(row.values["expectedVersion"]);
          const updated = await tx.accessGrant.updateMany({
            where: { id: row.existing.id, version: expectedVersion },
            data: {
              status: "pending_revocation",
              enforcementStatus: "pending",
              revokedAt: null,
              revokedBy: user.email,
              revocationReason:
                row.values["justification"] ||
                dto.changeReason?.trim() ||
                "Revoked through governed CSV change set",
              updatedBy: user.email,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw new BadRequestException(
              `Row ${row.row} was stale at commit time`,
            );
          const grant = await tx.accessGrant.findUniqueOrThrow({
            where: { id: row.existing.id },
            include: grantInclude,
          });
          const permissionCodes = this.grantPermissionCodes(grant);
          await tx.accessGrantVersion.create({
            data: {
              grantId: grant.id,
              version: grant.version,
              snapshotJson: this.grantSnapshot(grant, permissionCodes),
              changeReason:
                row.values["justification"] ||
                dto.changeReason?.trim() ||
                "Governed CSV revocation",
              changedBy: user.email,
            },
          });
          await this.audit.logRequired(
            {
              actor: user.email,
              action: "access_grant.import_revoke",
              entityType: "access_grant",
              entityId: grant.id,
              metadata: {
                row: row.row,
                code: grant.code,
                expectedVersion,
                newVersion: grant.version,
                permissionCodes,
                changeReason:
                  row.values["justification"] ||
                  dto.changeReason?.trim() ||
                  null,
              },
            },
            tx,
          );
          results.push({
            row: row.row,
            action,
            code: grant.code,
            id: grant.id,
            version: grant.version,
          });
        }
      }
      await this.audit.logRequired(
        {
          actor: user.email,
          action: "access_grant.import_commit",
          entityType: "access_grant_import",
          metadata: {
            rows: results.length,
            creates: results.filter((row) => row.action === "create").length,
            updates: results.filter((row) => row.action === "update").length,
            revokes: results.filter((row) => row.action === "revoke").length,
            reason: dto.changeReason?.trim() || null,
          },
        },
        tx,
      );
      return results;
    });
    return {
      committed: true,
      rowCount: committed.length,
      creates: committed.filter((row) => row.action === "create").length,
      updates: committed.filter((row) => row.action === "update").length,
      revokes: committed.filter((row) => row.action === "revoke").length,
      rows: committed,
    };
  }

  async reconcileGrantLifecycle(user: AuthUser) {
    const now = new Date();
    const visibleAssetWhere = await this.assetVisibilityWhereForUser(user);
    const [scheduled, activated, expired, repaired] = await this.prisma.$transaction(
      async (tx) => {
        const legacy = await tx.accessGrant.findMany({ where: { status: 'expiring', asset: visibleAssetWhere }, include: { permissions: true }, orderBy: { id: 'asc' }, take: 100 });
        let repaired = 0;
        for (const previous of legacy) {
          const elapsed = !!previous.expiresAt && previous.expiresAt <= now;
          const status = elapsed ? 'expired' : previous.ownerDecision !== 'approved' ? 'requested' : previous.startsAt > now ? 'scheduled' : 'active';
          const claimed = await tx.accessGrant.updateMany({ where: { id: previous.id, status: 'expiring', version: previous.version }, data: {
            status, ...(elapsed ? { enforcementStatus: 'pending', revokedAt: null, revocationReason: 'Legacy expiry state reconciled; removal confirmation is outstanding' } : {}),
            updatedBy: user.email, version: { increment: 1 },
          } });
          if (claimed.count !== 1) continue;
          const grant = await tx.accessGrant.findUniqueOrThrow({ where: { id: previous.id } });
          await tx.accessGrantVersion.create({ data: { grantId: grant.id, version: grant.version, snapshotJson: this.grantSnapshot(grant, previous.permissions.map((p) => p.permissionCode)), changeReason: 'Repair legacy expiring state without implying external removal', changedBy: user.email } });
          await this.audit.logRequired({ actor: user.email, action: 'access_grant.legacy_expiry_repaired', entityType: 'access_grant', entityId: grant.id, metadata: { previousStatus: previous.status, newStatus: status, previousVersion: previous.version, newVersion: grant.version, externalRemovalConfirmed: false } }, tx);
          repaired += 1;
        }
        const scheduledResult = await tx.accessGrant.updateMany({
          where: {
            ownerDecision: "approved",
            status: "active",
            startsAt: { gt: now },
            asset: visibleAssetWhere,
          },
          data: {
            status: "scheduled",
            enforcementStatus: "pending",
            updatedBy: user.email,
            version: { increment: 1 },
          },
        });
        const activatedResult = await tx.accessGrant.updateMany({
          where: {
            ownerDecision: "approved",
            status: { in: ["scheduled", "requested"] },
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            asset: visibleAssetWhere,
          },
          data: {
            status: "active",
            enforcementStatus: "pending",
            updatedBy: user.email,
            version: { increment: 1 },
          },
        });
        const expiredResult = await tx.accessGrant.updateMany({
          where: {
            status: { in: ["requested", "scheduled", "active"] },
            expiresAt: { lte: now },
            asset: visibleAssetWhere,
          },
          data: {
            status: "expired",
            enforcementStatus: "pending",
            revokedAt: null,
            revokedBy: "system:lifecycle_reconcile",
            revocationReason:
              "Grant expired automatically at the end of its approved access window",
            updatedBy: user.email,
            version: { increment: 1 },
          },
        });
        await this.audit.logRequired(
          {
            actor: user.email,
            action: "access_grant.lifecycle_reconcile",
            entityType: "access_grant",
            metadata: {
              scheduled: scheduledResult.count,
              activated: activatedResult.count,
              expired: expiredResult.count,
              reconciledAt: now.toISOString(),
            },
          },
          tx,
        );
        return [
          scheduledResult.count,
          activatedResult.count,
          expiredResult.count,
          repaired,
        ] as const;
      },
    );
    return {
      reconciledAt: now,
      scheduled,
      activated,
      expired,
      repaired,
      totalChanged: scheduled + activated + expired + repaired,
    };
  }

  async dispatchEnforcement(id: string, dto: DispatchAccessEnforcementDto, user: AuthUser) {
    await this.getGrant(id, user);
    const managedSimulation = isManagedDemoProfile() && process.env.DGOP_DEMO_ADAPTERS === 'true';
    const connectorCode = dto.connectorCode?.trim() || (managedSimulation ? 'demo_simulator' : 'pilot_contract');
    if (connectorCode === 'demo_simulator' && !managedSimulation) throw new BadRequestException('Simulated connector is restricted to the managed local demonstration');
    const idempotencyKey = `access-enforcement:${id}:v${dto.expectedVersion}:${dto.operation}`;
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.accessEnforcementAttempt.findUnique({ where: { idempotencyKey } });
      if (replay) {
        if (replay.connectorCode !== connectorCode) throw new ConflictException('Dispatch key was already used with another connector');
        return { attempt: replay, deduplicated: true };
      }
      try { await this.claimGrantVersion(tx, id, dto.expectedVersion); }
      catch (error) {
        const concurrentReplay = await tx.accessEnforcementAttempt.findUnique({ where: { idempotencyKey } });
        if (!concurrentReplay || concurrentReplay.connectorCode !== connectorCode) throw error;
        return { attempt: concurrentReplay, deduplicated: true };
      }
      const grant = await tx.accessGrant.findUniqueOrThrow({ where: { id }, include: grantInclude });
      if (!enforcementOperationAllowed(dto.operation as EnforcementOperation, grant)) throw new BadRequestException('This operation is not permitted in the current grant state');
      const inFlight = await tx.accessEnforcementAttempt.findFirst({ where: { grantId: id, operation: dto.operation, completionVersion: grant.version, status: { in: ['queued', 'running', 'retrying'] } } });
      if (inFlight) return { attempt: inFlight, deduplicated: true };
      const attempt = await tx.accessEnforcementAttempt.create({ data: {
        grantId: id, idempotencyKey, operation: dto.operation,
        requestVersion: grant.version, completionVersion: grant.version + 1,
        connectorCode,
        requestJson: { grantCode: grant.code, grantVersion: grant.version, operation: dto.operation, assetId: grant.assetId, principalType: grant.principalType, principalId: grant.principalId, permissionCodes: this.grantPermissionCodes(grant) },
        createdBy: user.email,
      } });
      await tx.accessGrant.update({ where: { id }, data: {
        ...(dto.operation === 'verify' ? {} : { enforcementStatus: 'pending' }),
        ...(dto.operation === 'revoke' ? { status: 'pending_revocation' } : {}),
        updatedBy: user.email, version: { increment: 1 },
      } });
      await this.audit.logRequired({ actor: user.email, action: 'access_grant.enforcement_dispatch', entityType: 'access_enforcement_attempt', entityId: attempt.id, metadata: { grantId: id, operation: dto.operation, requestVersion: grant.version, completionVersion: grant.version + 1, connectorCode: attempt.connectorCode } }, tx);
      return { attempt, deduplicated: false, contract: { delivery: 'operator_handoff', idempotencyKey, callback: 'Record an explicit provider observation using this attempt and its completion version; automated delivery is not configured' } };
    });
  }

  async applyGrantRules(
    id: string,
    dto: { expectedVersion: number; comment?: string },
    user: AuthUser,
  ) {
    const grant = await this.getGrant(id, user);
    const revocation = ["pending_revocation", "revocation_failed"].includes(
      grant.status,
    );
    const operation = revocation ? "revoke_rules" : "apply_rules";
    const idempotencyKey = `access-enforcement:dgop-policy:${operation}:${id}:v${dto.expectedVersion}`;
    const previousAttempt =
      await this.prisma.accessEnforcementAttempt.findUnique({
        where: { idempotencyKey },
      });
    if (previousAttempt)
      return { attempt: previousAttempt, deduplicated: true };

    if (grant.version !== dto.expectedVersion) {
      throw new ConflictException(
        "Grant changed before its access rules could be applied",
      );
    }
    if (
      !revocation &&
      (grant.ownerDecision !== "approved" || grant.status !== "active")
    ) {
      throw new BadRequestException(
        "Policy activation requires an active owner-approved grant; revocation requires a pending-revocation grant",
      );
    }
    const permissionCodes = this.grantPermissionCodes(grant);
    if (!permissionCodes.length)
      throw new BadRequestException(
        "The grant has no permission rules to apply",
      );

    const completedAt = new Date();
    const attempt = await this.prisma.$transaction(async (tx) => {
      await this.claimGrantVersion(tx, id, dto.expectedVersion);
      const created = await tx.accessEnforcementAttempt.create({
        data: {
          grantId: grant.id,
          idempotencyKey,
          operation,
          requestVersion: grant.version,
          completionVersion: grant.version + 1,
          connectorCode: "dgop_policy_store",
          status: "succeeded",
          attemptCount: 1,
          maxAttempts: 1,
          startedAt: completedAt,
          completedAt,
          requestJson: {
            grantCode: grant.code,
            grantVersion: grant.version,
            assetId: grant.assetId,
            principalType: grant.principalType,
            principalId: grant.principalId,
            profileId: grant.profileId,
            permissionCodes,
          } as Prisma.InputJsonValue,
          responseJson: {
            policyStore: "dgop",
            ...(revocation
              ? { removedPermissionCount: permissionCodes.length }
              : { appliedPermissionCount: permissionCodes.length }),
            comment: dto.comment?.trim() || null,
            appliedBy: user.email,
          } as Prisma.InputJsonValue,
          createdBy: user.email,
        },
      });
      await tx.accessGrant.update({
        where: { id: grant.id },
        data: revocation
          ? {
              status: "revoked",
              enforcementStatus: "revoked",
              revokedAt: completedAt,
              revokedBy: user.email,
              updatedBy: user.email,
              version: { increment: 1 },
            }
          : {
              enforcementStatus: "enforced",
              updatedBy: user.email,
              version: { increment: 1 },
            },
      });
      await this.audit.logRequired(
        {
          actor: user.email,
          action: revocation
            ? "access_grant.rules_revoked"
            : "access_grant.rules_applied",
          entityType: "access_enforcement_attempt",
          entityId: created.id,
          metadata: {
            grantId: grant.id,
            grantCode: grant.code,
            profileId: grant.profileId,
            permissionCodes,
            policyStore: "dgop",
            operation,
          },
        },
        tx,
      );
      return created;
    });
    return { attempt, deduplicated: false };
  }

  async completeManualEnforcement(id: string, dto: CompleteManualAccessEnforcementDto, user: AuthUser) {
    await this.getGrant(id, user);
    const operation = dto.operation ?? 'grant';
    if ((operation === 'grant' && dto.enforcementStatus === 'revoked') || (operation === 'revoke' && dto.enforcementStatus === 'enforced')) throw new BadRequestException('The outcome must match the explicit manual operation');
    const evidenceReference = dto.evidenceReference.trim();
    if (!evidenceReference) throw new BadRequestException('Manual completion evidence is required');
    const fingerprint = createHash('sha256').update(JSON.stringify({ operation, outcome: dto.enforcementStatus, evidenceReference, comment: dto.comment?.trim() || null })).digest('hex');
    const idempotencyKey = `access-enforcement:manual:${id}:v${dto.expectedVersion}:${fingerprint}`;
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.accessEnforcementAttempt.findUnique({ where: { idempotencyKey } });
      if (replay) return { attempt: replay, deduplicated: true };
      try { await this.claimGrantVersion(tx, id, dto.expectedVersion); }
      catch (error) {
        const concurrentReplay = await tx.accessEnforcementAttempt.findUnique({ where: { idempotencyKey } });
        if (!concurrentReplay) throw error;
        return { attempt: concurrentReplay, deduplicated: true };
      }
      const grant = await tx.accessGrant.findUniqueOrThrow({ where: { id }, include: grantInclude });
      if (!enforcementOperationAllowed(operation, grant)) throw new BadRequestException('This manual operation is not permitted in the current grant state');
      const completedAt = new Date();
      const success = dto.enforcementStatus !== 'failed';
      const attempt = await tx.accessEnforcementAttempt.create({ data: {
        grantId: id, idempotencyKey, operation: operation === 'revoke' ? 'manual_revoke' : 'manual_provision', connectorCode: 'manual_provisioning',
        requestVersion: grant.version, completionVersion: grant.version + 1,
        status: success ? 'succeeded' : 'failed', attemptCount: 1, maxAttempts: 1, startedAt: completedAt, completedAt,
        requestJson: { grantCode: grant.code, grantVersion: grant.version, operation, requestedStatus: dto.enforcementStatus },
        responseJson: { evidenceReference, comment: dto.comment?.trim() || null, completedBy: user.email, manualProvisioning: true, appliedToGrant: true },
        createdBy: user.email,
      } });
      await tx.accessGrant.update({ where: { id }, data: { ...enforcementGrantOutcome(operation, success, user.email, completedAt), updatedBy: user.email, version: { increment: 1 } } });
      await this.audit.logRequired({ actor: user.email, action: 'access_grant.enforcement_manual_complete', entityType: 'access_enforcement_attempt', entityId: attempt.id, metadata: { grantId: id, operation, outcome: dto.enforcementStatus, evidenceReference, requestVersion: grant.version } }, tx);
      return { attempt, deduplicated: false };
    });
  }

  async completeEnforcementAttempt(attemptId: string, dto: CompleteAccessEnforcementAttemptDto, user: AuthUser) {
    const visible = await this.prisma.accessEnforcementAttempt.findUnique({ where: { id: attemptId }, include: { grant: { include: grantInclude } } });
    if (!visible) throw new NotFoundException('Access enforcement attempt not found');
    await this.assertAssetVisible(user.roles, visible.grant.assetId);
    const providerReference = dto.providerReference.trim();
    if (!providerReference) throw new BadRequestException('Provider observation reference is required');
    const observation = { status: dto.status, providerReference, errorCode: dto.status === 'failed' ? dto.errorCode?.trim() || 'provider_failed' : null, message: dto.message?.trim() || null };
    const fingerprint = createHash('sha256').update(JSON.stringify(observation)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      // Lock the grant first in every enforcement command to keep concurrent commands ordered.
      await tx.$queryRaw`SELECT id FROM access_grants WHERE id = ${visible.grantId} FOR UPDATE`;
      const attempt = await tx.accessEnforcementAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { grant: { include: grantInclude } } });
      if (!['grant', 'update', 'revoke', 'verify'].includes(attempt.operation) || attempt.requestVersion == null || attempt.completionVersion == null) throw new BadRequestException('Legacy or non-provider attempt must be redispatched through an explicit operation');
      if (dto.expectedVersion !== attempt.completionVersion) throw new ConflictException('Observation version must match the immutable dispatched completion version');
      if (['succeeded', 'failed'].includes(attempt.status)) {
        const previous = attempt.responseJson as Record<string, unknown> | null;
        if (previous?.observationFingerprint !== fingerprint) throw new ConflictException('A different terminal observation is already recorded for this attempt');
        return { attempt, grant: attempt.grant, deduplicated: true, appliedToGrant: previous?.appliedToGrant === true, requiresReconciliation: previous?.requiresReconciliation === true };
      }
      const operation = attempt.operation as EnforcementOperation;
      const simulated = isManagedDemoProfile() && attempt.connectorCode === 'demo_simulator';
      const applicable = attempt.grant.version === attempt.completionVersion && enforcementOperationAllowed(operation, attempt.grant);
      const completedAt = new Date();
      const requiresReconciliation = !applicable && operation !== 'verify' && dto.status === 'succeeded';
      const claimed = await tx.accessEnforcementAttempt.updateMany({ where: { id: attemptId, status: { in: ['queued', 'running', 'retrying'] } }, data: {
        status: dto.status, completedAt, errorCode: observation.errorCode, errorMessage: dto.status === 'failed' ? observation.message || 'Provider reported enforcement failure' : null,
        responseJson: { ...observation, completedBy: user.email, observationFingerprint: fingerprint, appliedToGrant: applicable && operation !== 'verify', requiresReconciliation, simulated, ...(simulated ? { externalDelivery: false } : {}) },
      } });
      if (claimed.count !== 1) throw new ConflictException('Attempt changed before observation could be recorded');
      let grant = attempt.grant;
      if (applicable && operation !== 'verify') {
        await this.claimGrantVersion(tx, attempt.grantId, attempt.completionVersion);
        grant = await tx.accessGrant.update({ where: { id: attempt.grantId }, data: { ...enforcementGrantOutcome(operation, dto.status === 'succeeded', user.email, completedAt), updatedBy: user.email, version: { increment: 1 } }, include: grantInclude });
      } else if (requiresReconciliation && ['grant', 'update'].includes(operation) && (REMOVAL_STATES.has(grant.status) || grant.status === 'revoked')) {
        // A delayed external grant may have restored physical access: keep removal outstanding.
        grant = await tx.accessGrant.update({ where: { id: attempt.grantId }, data: { status: 'pending_revocation', enforcementStatus: 'pending', revokedAt: null, revocationReason: 'A superseded provisioning result requires fresh removal confirmation', updatedBy: user.email, version: { increment: 1 } }, include: grantInclude });
      }
      await this.audit.logRequired({ actor: user.email, action: applicable ? 'access_grant.enforcement_' + dto.status : 'access_grant.enforcement_observation_superseded', entityType: 'access_enforcement_attempt', entityId: attemptId, metadata: { grantId: attempt.grantId, operation, providerReference, requestVersion: attempt.requestVersion, completionVersion: attempt.completionVersion, currentGrantVersion: attempt.grant.version, appliedToGrant: applicable && operation !== 'verify', requiresReconciliation, simulated, ...(simulated ? { externalDelivery: false } : {}) } }, tx);
      return { attempt: await tx.accessEnforcementAttempt.findUniqueOrThrow({ where: { id: attemptId } }), grant, deduplicated: false, appliedToGrant: applicable && operation !== 'verify', requiresReconciliation };
    });
  }

  private async buildGrantImportPlan(
    csv: string,
    user: AuthUser,
  ): Promise<ImportPlanRow[]> {
    const rows = parseCsv(csv);
    if (rows.length < 2)
      throw new BadRequestException(
        "CSV must contain a header and at least one data row",
      );
    const headers = rows[0].map((header) => header.trim());
    const required = [
      "action",
      "code",
      "expectedVersion",
      "assetId",
      "principalType",
      "principalId",
      "permissionCode",
      "profileId",
      "startsAt",
      "expiresAt",
      "justification",
    ];
    const missing = required.filter((header) => !headers.includes(header));
    if (missing.length)
      throw new BadRequestException(
        `CSV is missing required columns: ${missing.join(", ")}`,
      );
    const rowLimit = this.accessImportRowLimit();
    if (rows.length - 1 > rowLimit)
      throw new BadRequestException(
        `CSV exceeds the configured ${rowLimit.toLocaleString("en")}-row change-set limit`,
      );

    const index = new Map(
      headers.map((header, position) => [header, position]),
    );
    const valueAt = (row: string[], key: string) =>
      row[index.get(key) ?? -1]?.trim() ?? "";
    const dataRows = rows.slice(1);
    const codes = [
      ...new Set(dataRows.map((row) => valueAt(row, "code")).filter(Boolean)),
    ];
    const assetIds = [
      ...new Set(
        dataRows.map((row) => valueAt(row, "assetId")).filter(Boolean),
      ),
    ];
    const visibilityWhere = await this.assetWriteVisibilityWhere(user);
    const grantPromise: Promise<ExistingImportGrant[]> = codes.length
      ? this.prisma.accessGrant.findMany({
          where: { code: { in: codes }, asset: visibilityWhere },
          select: {
            id: true,
            code: true,
            version: true,
            status: true,
            ownerDecision: true,
            assetId: true,
          },
        })
      : Promise.resolve([]);
    const assetPromise: Promise<VisibleImportAsset[]> = assetIds.length
      ? this.prisma.dataAsset.findMany({
          where: { id: { in: assetIds }, ...visibilityWhere },
          select: { id: true, code: true, assetType: true },
        })
      : Promise.resolve([]);
    const [grants, assets] = await Promise.all([grantPromise, assetPromise]);
    const grantByCode = new Map<string, ExistingImportGrant>(
      grants.map((grant) => [grant.code, grant] as const),
    );
    const assetById = new Map<string, VisibleImportAsset>(
      assets.map((asset) => [asset.id, asset] as const),
    );
    const plan: ImportPlanRow[] = [];

    for (const [offset, row] of dataRows.entries()) {
      const values = Object.fromEntries(
        headers.map((header) => [header, valueAt(row, header)]),
      );
      const action = values["action"].toLowerCase();
      const code = values["code"] || null;
      const errors: string[] = [];
      const result: ImportPlanRow = {
        row: offset + 2,
        action,
        code,
        valid: false,
        errors,
        values,
      };

      if (!["create", "update", "revoke"].includes(action)) {
        errors.push("action must be create, update, or revoke");
      }

      if (action === "create") {
        for (const key of [
          "assetId",
          "principalType",
          "principalId",
          "permissionCode",
          "justification",
        ]) {
          if (!values[key]) errors.push(`${key} is required for create`);
        }
        if (
          values["principalType"] &&
          !ACCESS_GRANT_PRINCIPAL_TYPES.includes(
            values["principalType"] as never,
          )
        ) {
          errors.push("principalType is invalid");
        }
        const asset = values["assetId"]
          ? assetById.get(values["assetId"])
          : null;
        if (values["assetId"] && !asset)
          errors.push("assetId is not visible or does not exist");
        const startsAt = values["startsAt"]
          ? new Date(values["startsAt"])
          : new Date();
        const expiresAt = values["expiresAt"]
          ? new Date(values["expiresAt"])
          : null;
        try {
          this.assertGrantDates(startsAt, expiresAt);
        } catch (error) {
          errors.push(
            error instanceof BadRequestException
              ? String(error.message)
              : "access grant dates are invalid",
          );
        }
        if (asset && values["permissionCode"]) {
          try {
            await this.assertPermissionForAssetType(
              values["permissionCode"],
              asset.assetType,
            );
          } catch (error) {
            errors.push(
              error instanceof BadRequestException
                ? String(error.message)
                : "permission is invalid for this asset type",
            );
          }
        }
        if (asset && values["profileId"] && values["permissionCode"]) {
          try {
            await this.assertProfilePermission(
              values["profileId"],
              asset.assetType,
              values["permissionCode"],
            );
          } catch (error) {
            errors.push(
              error instanceof BadRequestException
                ? String(error.message)
                : "permission profile is invalid",
            );
          }
        }
        if (values["principalType"] && values["principalId"]) {
          try {
            await this.assertPrincipalExists(
              values["principalType"],
              values["principalId"],
            );
          } catch (error) {
            errors.push(
              error instanceof BadRequestException
                ? String(error.message)
                : "principal is invalid",
            );
          }
        }
        if (!errors.length && asset) {
          result.create = {
            assetId: asset.id,
            principalType: values["principalType"],
            principalId: values["principalId"],
            permissionCode: values["permissionCode"],
            profileId: values["profileId"] || null,
            startsAt,
            expiresAt,
            justification: values["justification"].trim(),
          };
        }
      }

      if (action === "update" || action === "revoke") {
        const grant = code ? grantByCode.get(code) : null;
        if (!code || !grant)
          errors.push("code is not visible or does not exist");
        const expectedVersion = Number(values["expectedVersion"]);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1)
          errors.push("expectedVersion must be a positive integer");
        else if (grant && grant.version !== expectedVersion)
          errors.push(
            `stale version: expected ${expectedVersion}, current ${grant.version}`,
          );
        if (grant?.status === "revoked")
          errors.push("revoked grants cannot be updated by CSV");
        if (action === "update" && grant) {
          const update: Prisma.AccessGrantUpdateManyMutationInput = {};
          if (values["permissionCode"]) {
            const asset = await this.prisma.dataAsset.findFirst({
              where: { id: grant.assetId, ...visibilityWhere },
              select: { assetType: true },
            });
            if (!asset) errors.push("grant asset is not visible");
            else {
              try {
                await this.assertPermissionForAssetType(
                  values["permissionCode"],
                  asset.assetType,
                );
                update.permissionCode = values["permissionCode"];
              } catch (error) {
                errors.push(
                  error instanceof BadRequestException
                    ? String(error.message)
                    : "permission is invalid for this asset type",
                );
              }
              if (values["profileId"]) {
                try {
                  await this.assertProfilePermission(
                    values["profileId"],
                    asset.assetType,
                    values["permissionCode"],
                  );
                  result.profileId = values["profileId"];
                } catch (error) {
                  errors.push(
                    error instanceof BadRequestException
                      ? String(error.message)
                      : "permission profile is invalid",
                  );
                }
              }
            }
          }
          if (headers.includes("startsAt") && values["startsAt"])
            update.startsAt = new Date(values["startsAt"]);
          if (headers.includes("expiresAt"))
            update.expiresAt = values["expiresAt"]
              ? new Date(values["expiresAt"])
              : null;
          if (headers.includes("justification") && values["justification"])
            update.justification = values["justification"].trim();
          try {
            const startsAt =
              update.startsAt instanceof Date ? update.startsAt : undefined;
            const expiresAt =
              update.expiresAt instanceof Date || update.expiresAt === null
                ? update.expiresAt
                : undefined;
            if (startsAt || expiresAt !== undefined) {
              const existing = await this.prisma.accessGrant.findUnique({
                where: { id: grant.id },
                select: { startsAt: true, expiresAt: true },
              });
              this.assertGrantDates(
                startsAt ?? existing?.startsAt ?? new Date(),
                expiresAt === undefined
                  ? (existing?.expiresAt ?? null)
                  : expiresAt,
              );
            }
          } catch (error) {
            errors.push(
              error instanceof BadRequestException
                ? String(error.message)
                : "access grant dates are invalid",
            );
          }
          result.update = update;
        }
        result.existing = grant ?? null;
      }
      result.valid = errors.length === 0;
      plan.push(result);
    }
    return plan;
  }

  private importPlanResponse(outcomes: ImportPlanRow[], validateOnly: boolean) {
    return {
      validateOnly,
      totalRows: outcomes.length,
      validRows: outcomes.filter((row) => row.valid).length,
      invalidRows: outcomes.filter((row) => !row.valid).length,
      rows: outcomes.map((row) => ({
        row: row.row,
        action: row.action,
        code: row.code,
        valid: row.valid,
        errors: row.errors,
      })),
    };
  }

  private async assetVisibilityWhere(
    roleCodes: string[],
  ): Promise<Prisma.DataAssetWhereInput> {
    const scope = await this.scope.resolve(roleCodes);
    return {
      AND: [{ deletedAt: null }, this.assetScopeWhere(scope)],
    };
  }

  private async assetVisibilityWhereForUser(
    user: AuthUser,
  ): Promise<Prisma.DataAssetWhereInput> {
    const scoped = await this.assetVisibilityWhere(user.roles);
    const broadReadRoles = new Set([...ADMIN_ROLES, "auditor"]);
    if (
      !user.roles.includes("data_owner") ||
      user.roles.some((role) => broadReadRoles.has(role))
    )
      return scoped;
    const ownedAssetIds = await this.ownedOrDelegatedAssetIds(user);
    return { AND: [scoped, { id: { in: ownedAssetIds } }] };
  }

  private async assetWriteVisibilityWhere(
    user: AuthUser,
  ): Promise<Prisma.DataAssetWhereInput> {
    const scoped = await this.assetVisibilityWhere(user.roles);
    if (user.roles.some((role) => ADMIN_ROLES.includes(role))) return scoped;
    const ownedAssetIds = await this.ownedOrDelegatedAssetIds(user);
    return { AND: [scoped, { id: { in: ownedAssetIds } }] };
  }

  private async ownedOrDelegatedAssetIds(user: AuthUser): Promise<string[]> {
    const now = new Date();
    const person = await this.prisma.person.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { userId: user.id },
          { email: { equals: user.email, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    const delegations = await this.prisma.workflowDelegation.findMany({
      where: {
        delegateUserId: user.id,
        roleCode: "data_owner",
        status: WorkflowDelegationStatus.active,
        startsAt: { lte: now },
        expiresAt: { gt: now },
      },
      select: { assetId: true, delegatorUserId: true },
    });
    const delegatorUserIds = [
      ...new Set(
        delegations
          .filter((row) => !row.assetId)
          .map((row) => row.delegatorUserId),
      ),
    ];
    const ownerPersonIds = person ? [person.id] : [];
    if (delegatorUserIds.length) {
      const delegatorPeople = await this.prisma.person.findMany({
        where: {
          userId: { in: delegatorUserIds },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      ownerPersonIds.push(...delegatorPeople.map((row) => row.id));
    }
    const assignments = ownerPersonIds.length
      ? await this.prisma.stewardshipAssignment.findMany({
          where: {
            targetType: AssignmentTargetType.asset,
            personId: { in: ownerPersonIds },
            roleType: { code: "data_owner", isActive: true, deletedAt: null },
            approvalStatus: ApprovalStatus.approved,
            isActive: true,
            deletedAt: null,
            effectiveDate: { lte: now },
            OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
          },
          select: { targetId: true },
        })
      : [];
    return [
      ...new Set([
        ...assignments.map((assignment) => assignment.targetId),
        ...delegations
          .map((delegation) => delegation.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      ]),
    ];
  }

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = {};
    if (scope.orgUnits !== "all") where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== "all") where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    return where;
  }

  private async assertAssetVisible(roleCodes: string[], assetId: string) {
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, ...(await this.assetVisibilityWhere(roleCodes)) },
      select: { id: true, assetType: true, code: true },
    });
    if (!asset) throw new NotFoundException("data asset not found");
    return asset;
  }

  private async assertWorkflowCaseVisible(
    roleCodes: string[],
    workflowCaseId: string,
  ) {
    const wfCase = await this.prisma.workflowCase.findUnique({
      where: { id: workflowCaseId },
      select: { id: true, assetId: true },
    });
    if (!wfCase) throw new NotFoundException("workflow case not found");
    if (wfCase.assetId)
      await this.assertAssetVisible(roleCodes, wfCase.assetId);
  }

  private async assertPermissionForAssetType(
    permissionCode: string,
    assetType: string,
  ) {
    const permission = await this.prisma.accessPermissionCatalog.findFirst({
      where: {
        code: permissionCode,
        assetType,
        isActive: true,
        deletedAt: null,
      },
    });
    if (!permission) {
      throw new BadRequestException(
        `Permission ${permissionCode} is not supported for asset type ${assetType}`,
      );
    }
    return permission;
  }

  private async assertProfilePermission(
    profileId: string,
    assetType: string,
    permissionCode: string,
  ) {
    const profile = await this.prisma.accessPermissionProfile.findFirst({
      where: { id: profileId, assetType, isActive: true, deletedAt: null },
    });
    if (!profile)
      throw new BadRequestException(
        "Permission profile is not active for this asset type",
      );
    const permissionCodes = this.permissionCodes(profile.permissionCodesJson);
    if (!permissionCodes.includes(permissionCode)) {
      throw new BadRequestException(
        "Permission profile does not include the requested permission",
      );
    }
    return profile;
  }

  private async assertPrincipalExists(
    principalType: string,
    principalId: string,
  ): Promise<void> {
    if (principalType === "user") {
      const user = await this.prisma.user.findFirst({
        where: { id: principalId, isActive: true },
        select: { id: true },
      });
      if (!user)
        throw new BadRequestException(
          "Access grant user principal is not active",
        );
    }
    if (principalType === "role") {
      const role = await this.prisma.role.findFirst({
        where: { code: principalId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!role)
        throw new BadRequestException(
          "Access grant role principal is not active",
        );
      return;
    }
    if (principalType === "group") {
      const group = await this.prisma.accessPrincipalDirectory.findFirst({
        where: {
          principalType: "group",
          externalId: principalId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!group)
        throw new BadRequestException(
          "Access grant group principal is not active in the directory registry",
        );
      return;
    }
    throw new BadRequestException(
      "New access grants support role and group principals only",
    );
  }

  private async assertPermissionsForAssetType(
    permissionCodes: string[],
    assetType: string,
  ) {
    const permissions = await this.prisma.accessPermissionCatalog.findMany({
      where: {
        code: { in: permissionCodes },
        assetType,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { code: "asc" },
    });
    const found = new Set(permissions.map((permission) => permission.code));
    const unsupported = permissionCodes.filter((code) => !found.has(code));
    if (unsupported.length) {
      throw new BadRequestException(
        `Permissions are not supported for asset type ${assetType}: ${unsupported.join(", ")}`,
      );
    }
    return permissions;
  }

  private async assertProfile(profileId: string, assetType: string) {
    const profile = await this.prisma.accessPermissionProfile.findFirst({
      where: { id: profileId, assetType, isActive: true, deletedAt: null },
    });
    if (!profile)
      throw new BadRequestException(
        "Permission profile is not active for this asset type",
      );
    await this.assertPermissionsForAssetType(
      this.permissionCodes(profile.permissionCodesJson),
      assetType,
    );
    return profile;
  }

  private async assertOwnerAuthority(
    user: AuthUser,
    assetId: string,
  ): Promise<void> {
    if (user.roles.some((role) => ADMIN_ROLES.includes(role))) return;
    const validation = await this.ownerDelegate.validateActiveOwnerOrDelegate({
      assetId,
      actorUserId: user.id,
      actorEmail: user.email,
    });
    if (!validation.allowed) throw new ForbiddenException(validation.reason);
  }

  private async assertBusinessOwnerAuthority(user: AuthUser, assetId: string): Promise<void> {
    const validation = await this.ownerDelegate.validateActiveOwnerOrDelegate({ assetId, actorUserId: user.id, actorEmail: user.email });
    if (!validation.allowed) throw new ForbiddenException(validation.reason);
    const roles = await this.prisma.role.findMany({ where: { code: { in: user.roles.filter(role => !ADMIN_ROLES.includes(role) && role !== 'auditor') }, isActive: true, deletedAt: null, permissions: { some: { permission: { resource: 'access_grants', action: 'edit' } } } }, select: { code: true } });
    if (!roles.length) throw new ForbiddenException('A live access decision business role is required');
    const asset = await this.prisma.dataAsset.findFirst({ where: { id: assetId, ...(await this.assetVisibilityWhere(roles.map(role => role.code))) }, select: { id: true } });
    if (!asset) throw new NotFoundException('data asset not found in the business decision scope');
  }

  private accessImportRowLimit(): number {
    const configured = Number(
      process.env["ACCESS_GRANT_IMPORT_MAX_ROWS"] ??
        DEFAULT_ACCESS_IMPORT_ROW_LIMIT,
    );
    if (
      !Number.isInteger(configured) ||
      configured < 100 ||
      configured > 100_000
    ) {
      return DEFAULT_ACCESS_IMPORT_ROW_LIMIT;
    }
    return configured;
  }

  private permissionClass(
    action: string,
  ): "read" | "write" | "execute" | "share_export" | "administer" {
    const normalized = action.toLowerCase();
    if (/(share|reshare|export|download_payload|bulk_consume)/.test(normalized))
      return "share_export";
    if (/(delete|manage_|configure_|operate_)/.test(normalized))
      return "administer";
    if (/(execute|invoke|consume|subscribe)/.test(normalized)) return "execute";
    if (
      /(insert|update|edit|upload|create_|submit|publish|build|contribute)/.test(
        normalized,
      )
    )
      return "write";
    return "read";
  }

  private permissionCodes(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  private grantPermissionCodes(grant: {
    permissionCode: string;
    permissions?: Array<{ permissionCode: string }>;
  }): string[] {
    const normalized =
      grant.permissions?.map((row) => row.permissionCode).filter(Boolean) ?? [];
    return [
      ...new Set(normalized.length ? normalized : [grant.permissionCode]),
    ];
  }

  private async claimGrantVersion(
    tx: Prisma.TransactionClient,
    id: string,
    expectedVersion: number,
  ): Promise<void> {
    const claimed = await tx.accessGrant.updateMany({
      where: { id, version: expectedVersion },
      data: { version: expectedVersion },
    });
    if (claimed.count !== 1) {
      throw new ConflictException(
        "Grant changed before the operation could be committed",
      );
    }
  }

  private grantSnapshot(
    grant: {
      code: string;
      assetId: string;
      principalType: string;
      principalId: string;
      profileId: string | null;
      status: string;
      startsAt: Date;
      expiresAt: Date | null;
      justification: string;
      ownerDecision: string;
      enforcementStatus: string;
    },
    permissionCodes: string[],
  ): Prisma.InputJsonObject {
    return {
      code: grant.code,
      assetId: grant.assetId,
      principalType: grant.principalType,
      principalId: grant.principalId,
      permissionCodes,
      profileId: grant.profileId,
      status: grant.status,
      startsAt: grant.startsAt.toISOString(),
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      justification: grant.justification,
      ownerDecision: grant.ownerDecision,
      enforcementStatus: grant.enforcementStatus,
    };
  }

  private assertGrantDates(startsAt: Date, expiresAt: Date | null): void {
    if (Number.isNaN(startsAt.getTime()))
      throw new BadRequestException("Access grant start date is invalid");
    if (expiresAt && Number.isNaN(expiresAt.getTime()))
      throw new BadRequestException("Access grant expiry date is invalid");
    if (expiresAt && expiresAt <= startsAt) {
      throw new BadRequestException(
        "Access grant expiry date must be after the start date",
      );
    }
  }

  private effectiveAccessLifecycle(
    startsAt: Date,
    expiresAt: Date | null,
    status: string,
    now: Date,
  ): string {
    if (status === "revoked") return "revoked";
    if (status === "pending_revocation" || status === "revocation_failed")
      return "revocation_pending";
    if (status === "suspended") return "suspended";
    if (status === "expired" || (expiresAt && expiresAt <= now))
      return "expired";
    if (startsAt > now || status === "scheduled") return "scheduled";
    return "current";
  }

  private async nextGrantCode(
    client: Prisma.TransactionClient,
  ): Promise<string> {
    return nextAvailableBusinessCode(
      client,
      "access_grant",
      (value) => `AGR-${formatBusinessSequence(value, 5)}`,
      async (code) =>
        !(await client.accessGrant.findUnique({
          where: { code },
          select: { id: true },
        })),
    );
  }
}
