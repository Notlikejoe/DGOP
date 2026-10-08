const fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {acquireVerificationLease}=require('./verification-lease.cjs'),{binding}=require('./verification-binding.cjs');
const state='C:/Users/Youss/Documents/Codex/work/dgop-access-sync',root=state+'/source',req=createRequire(root+'/apps/api/package.json');
req('ts-node').register({project:root+'/apps/api/tsconfig.json'});
const {PrismaClient}=req('@prisma/client'),{JwtService}=req('@nestjs/jwt');
const {AuthService}=require(root+'/apps/api/src/auth/auth.service.ts'),{AccessService}=require(root+'/apps/api/src/access/access.service.ts'),{ScopeService}=require(root+'/apps/api/src/access/scope.service.ts');
const {AiAuthorizationService}=require(root+'/apps/api/src/ai-governance/ai-authorization.service.ts');
const config=JSON.parse(fs.readFileSync(state+'/private/database.json')),url=new URL(config.url);
if(url.hostname!=='127.0.0.1'||url.port!=='55436'||url.pathname!=='/dgop_access_sync_qa_20261007')throw Error('Test database guard failed');
const db=new PrismaClient({datasources:{db:{url:url.href}}}),access=new AccessService(db),scope=new ScopeService(db),jwt=new JwtService({secret:'isolated-access-refresh-database-tests-only'});
let auditCalls=0;const audit={log:async()=>{auditCalls++;},logRequired:async()=>{auditCalls++;}};
const auth=new AuthService({},jwt,audit,access,scope,db),ai=new AiAuthorizationService(db,audit);
const lease=acquireVerificationLease({purpose:'Access sync focused database snapshot verification'});
const dir=state+'/evidence/'+new Date().toISOString().replaceAll(':','-')+'-database';fs.mkdirSync(dir,{recursive:true});
const receipt={startedAt:new Date().toISOString(),binding:binding(root),database:{host:url.hostname,port:url.port,name:url.pathname.slice(1)},profile:config.profile,checks:[],status:'running'};
const check=(name)=>{receipt.checks.push({name,passed:true,at:new Date().toISOString()});console.log('PASS '+name);};
let baseline,owner,role;
async function restore(){if(!baseline)return;
 await db.$transaction(async tx=>{
  await tx.user.update({where:{id:owner.id},data:{isActive:baseline.user.isActive,tokenVersion:baseline.user.tokenVersion}});
  await tx.userRole.deleteMany({where:{userId:owner.id}});await tx.userRole.createMany({data:baseline.memberships});
  await tx.role.update({where:{id:role.id},data:{isActive:baseline.role.isActive,maxClassificationRank:baseline.role.maxClassificationRank}});
  await tx.rolePermission.deleteMany({where:{roleId:role.id}});await tx.rolePermission.createMany({data:baseline.grants});
  await tx.roleDataScope.deleteMany({where:{roleId:role.id}});await tx.roleDataScope.createMany({data:baseline.scopes});
 });
}
(async()=>{try{
 const identities=JSON.parse(fs.readFileSync('C:/Users/Youss/Documents/Codex/work/dgop-manual-access-20261007/private/credentials.json')).accounts;
 assert.equal(identities.length,8);
 const auditCount=await db.auditLog.count();
 for(const identity of identities){const user=await db.user.findUniqueOrThrow({where:{email:identity.email}}),p=await auth.me(user.id);assert.equal(p.id,user.id);assert.match(p.accessRevision,/^[a-f0-9]{64}$/);
  assert.equal(p.roles.some(r=>r.code==='system_admin'),identity.email==='qa.admin@dgop.local');
  if(identity.email!=='qa.admin@dgop.local')assert(!p.permissions.some(p=>p==='*'||p.startsWith('users.')||p.startsWith('roles.')));
  if(/qa\.(owner\.|steward@|privacy@)/.test(identity.email))assert(!Object.values(p.aiCapabilities.screens).some(Boolean));
  if(identity.email==='qa.ai.officer@dgop.local'){assert(p.aiCapabilities.panels.classificationVerification);assert(!p.aiCapabilities.panels.registration);}
 }
 check('Eight baseline profiles resolve current access; only qa.admin has administration');
 owner=await db.user.findUniqueOrThrow({where:{email:'qa.owner.finance@dgop.local'}});
 role=await db.role.findUniqueOrThrow({where:{code:'qa_access_owner_finance_v1'}});
 const hr=await db.role.findUniqueOrThrow({where:{code:'qa_access_owner_hr_v1'}});
 assert(!role.isSystem && role.code.startsWith('qa_access_'));
 baseline={user:{isActive:owner.isActive,tokenVersion:owner.tokenVersion},role:{isActive:role.isActive,maxClassificationRank:role.maxClassificationRank},memberships:await db.userRole.findMany({where:{userId:owner.id}}),grants:await db.rolePermission.findMany({where:{roleId:role.id}}),scopes:await db.roleDataScope.findMany({where:{roleId:role.id}})};
 fs.writeFileSync(state+'/private/database-check-restore.json',JSON.stringify({ownerId:owner.id,roleId:role.id,...baseline},null,2),{mode:0o600});
 const initial=await auth.me(owner.id),token=jwt.sign({sub:owner.id,email:owner.email,roles:['obsolete-token-role'],tokenVersion:owner.tokenVersion});
 assert.equal((await auth.sessionFromToken(token)).accessRevision,initial.accessRevision);
 await db.user.update({where:{id:owner.id},data:{lastLoginAt:new Date()}});
 assert.equal((await auth.me(owner.id)).accessRevision,initial.accessRevision);check('Revision stable for metadata changes and independent of stale JWT roles');
 const view=await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'case.view.aiuc',action:'own'}}});
 await db.rolePermission.create({data:{roleId:role.id,permissionId:view.id}});
 const granted=await auth.sessionFromToken(token);assert(granted.aiCapabilities.screens.useCases);assert.notEqual(granted.accessRevision,initial.accessRevision);
 await ai.authorize(owner.id,'case.view.aiuc.own');
 await db.rolePermission.delete({where:{roleId_permissionId:{roleId:role.id,permissionId:view.id}}});
 await assert.rejects(()=>ai.authorize(owner.id,'case.view.aiuc.own'),/explicit eligible role grant/);
 assert.equal((await auth.sessionFromToken(token)).accessRevision,initial.accessRevision);check('AI grant/revoke updates existing cookie session; native authorizer rejects revoked access immediately');
 const hrScopes=await db.roleDataScope.findMany({where:{roleId:hr.id}});
 await db.$transaction([db.roleDataScope.deleteMany({where:{roleId:role.id}}),db.roleDataScope.createMany({data:hrScopes.map(({scopeType,refId,includeDescendants})=>({roleId:role.id,scopeType,refId,includeDescendants}))}),db.role.update({where:{id:role.id},data:{maxClassificationRank:0}})]);
 const scoped=await auth.me(owner.id);assert.notEqual(scoped.accessRevision,initial.accessRevision);assert.notDeepEqual(scoped.scopes.orgUnits,initial.scopes.orgUnits);assert.equal(scoped.scopes.maxClassRank,0);check('Organization/domain scope and classification changes alter snapshot');await restore();
 await db.userRole.create({data:{userId:owner.id,roleId:hr.id}});assert((await auth.me(owner.id)).roles.some(r=>r.code===hr.code));
 await db.role.update({where:{id:role.id},data:{isActive:false}});
 const inactive=await auth.me(owner.id);assert(!inactive.roles.some(r=>r.code===role.code));assert(inactive.permissions.includes('data_assets.view'));check('Role add and deactivate preserve overlapping grants from another active role');await restore();
 await db.userRole.delete({where:{userId_roleId:{userId:owner.id,roleId:role.id}}});assert.equal((await auth.me(owner.id)).roles.length,baseline.memberships.length-1);check('Role membership removal updates current session');await restore();
 let reached,release;const paused=new Promise(r=>{reached=r;}),resume=new Promise(r=>{release=r;});
 const pausedScope={resolve:async(codes,tx)=>{reached();await resume;return scope.resolve(codes,tx);}};
 const concurrent=new AuthService({},jwt,audit,access,pausedScope,db).me(owner.id);
 await paused;
 try{await db.$transaction([db.rolePermission.create({data:{roleId:role.id,permissionId:view.id}}),db.role.update({where:{id:role.id},data:{maxClassificationRank:1}})]);}finally{release();}
 assert.equal((await concurrent).accessRevision,initial.accessRevision);
 const next=await auth.me(owner.id);assert(next.aiCapabilities.screens.useCases);assert.equal(next.scopes.maxClassRank,1);check('Concurrent update cannot mix permissions and scope from different database snapshots');await restore();
 await db.user.update({where:{id:owner.id},data:{isActive:false}});assert.equal(await auth.sessionFromToken(token),null);await assert.rejects(()=>auth.me(owner.id));await restore();
 await db.user.update({where:{id:owner.id},data:{tokenVersion:owner.tokenVersion+1}});assert.equal(await auth.sessionFromToken(token),null);await restore();check('Disabled accounts and invalidated sessions are rejected');
 assert.equal(auditCalls,1);assert.equal(await db.auditLog.count(),auditCount);check('Session probes produce no permission-denial audit noise');
 receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error.stack;process.exitCode=1;console.error(error.stack);}finally{
 try{await restore();if(owner){await db.user.update({where:{id:owner.id},data:{lastLoginAt:owner.lastLoginAt}});const restored=await auth.me(owner.id);receipt.baselineRestored=restored.permissions.length===baseline.grants.length && restored.roles.length===baseline.memberships.length;assert(receipt.baselineRestored);}}catch(error){receipt.status='failed';receipt.restoreError=error.message;process.exitCode=1;console.error('Restore failed: '+error.message);}
 receipt.finishedAt=new Date().toISOString();await db.$disconnect();fs.writeFileSync(dir+'/receipt.json',JSON.stringify(receipt,null,2));lease.release();console.log('Receipt: '+dir+'/receipt.json');
}})();
