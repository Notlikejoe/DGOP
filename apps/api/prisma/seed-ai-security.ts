import 'reflect-metadata';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { syncAiSecurityCatalog } from '../src/ai-governance/ai-security-catalog';

// Deliberately no implicit root .env loading and no startup invocation.
async function main() {
  if (process.env.DGOP_AI_CATALOG_APPLY!=='true' || !process.env.DATABASE_URL
    || !process.env.DGOP_AI_CATALOG_ACTOR?.trim() || !process.env.DGOP_AI_CATALOG_JUSTIFICATION?.trim()) {
    throw new Error('Explicit DATABASE_URL, DGOP_AI_CATALOG_APPLY=true, DGOP_AI_CATALOG_ACTOR and DGOP_AI_CATALOG_JUSTIFICATION are required');
  }
  const db=new PrismaService();
  try {
    const audit=new AuditService(db);
    const result=await db.$transaction(tx=>syncAiSecurityCatalog(tx,audit,process.env.DGOP_AI_CATALOG_ACTOR!,process.env.DGOP_AI_CATALOG_JUSTIFICATION!),{timeout:60000});
    console.log(result);
  } finally {await db.$disconnect();}
}
main().catch(()=>{console.error('AI catalog installation failed; inspect local database availability and required environment configuration. No partial catalog transaction was committed.');process.exitCode=1;});
