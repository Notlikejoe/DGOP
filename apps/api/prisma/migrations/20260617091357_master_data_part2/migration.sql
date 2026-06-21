-- CreateEnum
CREATE TYPE "RaciResponsibility" AS ENUM ('R', 'A', 'C', 'I');

-- AlterTable
ALTER TABLE "classifications" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "organization_units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "systems" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "type" TEXT,
    "ownerOrgUnitId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raci_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "processType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raci_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raci_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "roleTypeId" TEXT NOT NULL,
    "responsibility" "RaciResponsibility" NOT NULL,

    CONSTRAINT "raci_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_units_code_key" ON "organization_units"("code");

-- CreateIndex
CREATE INDEX "organization_units_parentId_idx" ON "organization_units"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "systems_code_key" ON "systems"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_types_code_key" ON "role_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "raci_templates_code_key" ON "raci_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "raci_template_items_templateId_roleTypeId_key" ON "raci_template_items"("templateId", "roleTypeId");

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "systems" ADD CONSTRAINT "systems_ownerOrgUnitId_fkey" FOREIGN KEY ("ownerOrgUnitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raci_template_items" ADD CONSTRAINT "raci_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "raci_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raci_template_items" ADD CONSTRAINT "raci_template_items_roleTypeId_fkey" FOREIGN KEY ("roleTypeId") REFERENCES "role_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
