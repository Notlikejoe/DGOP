import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './runtime-env.mjs';
import { demoConfig, readManifest, atomicJson } from './demo-profile.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),config=demoConfig(root);
Object.assign(process.env,config.env,{WORKFLOW_EXECUTION_SCHEDULER:'false',GOVERNANCE_OPERATIONS_SCHEDULER:'false',DGOP_WORKFLOW_STARTUP_MAINTENANCE:'false'});
const require=createRequire(resolve(root,'apps/api/package.json')),{PrismaService}=require(resolve(root,'apps/api/dist/prisma/prisma.service.js')),{AuditService}=require(resolve(root,'apps/api/dist/audit/audit.service.js'));
const {installDemoCatalog}=require(resolve(root,'apps/api/dist/common/demo-catalog.js')),manifest=readManifest(config),db=new PrismaService(),audit=new AuditService(db);
try {
  if(!manifest.catalogInstalled&&await db.user.count())throw new Error('The uninitialized demonstration database already has users. Preserve it and prepare a fresh database.');
  await installDemoCatalog(db,audit);
  manifest.catalogInstalled=true;atomicJson(config.manifestPath,manifest);
  const {NestFactory}=require('@nestjs/core'),{AppModule}=require(resolve(root,'apps/api/dist/app.module.js'));
  const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
  try {
    const {DEFAULT_WORKFLOW_TEMPLATES}=require(resolve(root,'apps/api/dist/workflow/workflow.logic.js'));
    for(const template of DEFAULT_WORKFLOW_TEMPLATES){const installed=await db.workflowTemplate.findUnique({where:{code:template.code},include:{stages:true}});if(!installed?.isActive||installed.deletedAt||template.stages.some(stage=>!installed.stages.some(s=>s.code===stage.code&&s.isActive)))throw new Error('Demonstration workflow template is incomplete: '+template.code);}
    const {ensureAiNotificationTemplates,validateAiNotificationTemplate}=require(resolve(root,'apps/api/dist/ai-governance/ai-notifications.js'));
    await ensureAiNotificationTemplates(db);
    const templates=await db.governanceNotificationTemplate.findMany({where:{code:{startsWith:'AI'}}});
    if(templates.length!==15)throw new Error('The complete bilingual AI notification catalog is required.');
    for(const template of templates)validateAiNotificationTemplate(template.code,template.sourceType,template.titleTemplate,template.messageTemplate,template.digestCadence);
    await db.$transaction(async tx=>{for(const template of templates){await tx.governanceNotificationTemplate.update({where:{id:template.id},data:{isActive:true,updatedBy:'local-demo-installer'}});}await audit.logRequired({actor:'local-demo-installer',action:'demo.notification.catalog.activated',entityType:'demo_installation',entityId:manifest.installationId,metadata:{demoOnly:true,externalDelivery:false,templateCount:templates.length}},tx);});
    manifest.templatesVerified=true;atomicJson(config.manifestPath,manifest);
    console.log('Additive role, permission, NDI and workflow catalogs installed. Bilingual notification simulation is available.');
  } finally {await app.close();}
} finally {await db.$disconnect();}
