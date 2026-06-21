-- CreateTable
CREATE TABLE "data_domains" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subjects" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_capabilities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_domains_code_key" ON "data_domains"("code");

-- CreateIndex
CREATE INDEX "data_domains_parentId_idx" ON "data_domains"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "data_subjects_code_key" ON "data_subjects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "business_capabilities_code_key" ON "business_capabilities"("code");

-- CreateIndex
CREATE INDEX "business_capabilities_parentId_idx" ON "business_capabilities"("parentId");

-- AddForeignKey
ALTER TABLE "data_domains" ADD CONSTRAINT "data_domains_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_capabilities" ADD CONSTRAINT "business_capabilities_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "business_capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
