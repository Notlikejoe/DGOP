import assert from 'node:assert/strict';
import { controllerRoutes, liveRoleQueryContract, genericToastErrorCallbacks } from './api-route-scan.mjs';
const routes=controllerRoutes('fixture.controller.ts',`@Controller('fixture')
@RequireAnyPermissions(
 'fixture.view',
 'fixture.edit'
)
export class Example {
@Get() list(){return [];}
  @Post('write') @RequirePermissions('fixture.edit') write(){}
  @Get('public')
  @Public()
  publicView(){}
}`);
assert.equal(routes.length,3);assert.ok(routes.every(r=>r.controllerDecorators.some(d=>d.name==='RequireAnyPermissions')));
assert.deepEqual(routes[1].decorators.map(d=>d.name),['Post','RequirePermissions']);assert.equal(routes[2].method,'publicView');
console.log('API route scanner passed inline, multiline and controller authorization syntax.');
const helper=`export function liveRoleWhere(){return {isActive:true,deletedAt:null,OR:[{businessRoleCode:null},{businessRole:{is:{isActive:true,deletedAt:null,businessRoleCode:null}}}]};}`;
const lookup=`import {liveRoleWhere} from '../auth/business-roles'; class Scope {async resolve(roleCodes){return client.role.findMany({where:{AND:[liveRoleWhere(),{code:{in:roleCodes}}]}});}}`;
assert(liveRoleQueryContract('scope.ts',lookup,'resolve',helper));
assert(liveRoleQueryContract('scope.ts',lookup.replaceAll(',',',\n ').replaceAll("'",'"'),'resolve',helper));
assert(!liveRoleQueryContract('scope.ts',lookup.replace('liveRoleWhere(),',''),'resolve',helper));
assert(!liveRoleQueryContract('scope.ts',lookup,'resolve',helper.replace('isActive:true','isActive:false')));
assert(!liveRoleQueryContract('scope.ts',lookup,'resolve',helper.replace('deletedAt:null','deletedAt:undefined')));
assert(!liveRoleQueryContract('scope.ts',lookup,'resolve',helper.replace('businessRoleCode:null','businessRoleCode:"system_admin"')));
console.log('Live actual/canonical role query contract passed formatting and disabled/deleted-role regressions.');
assert.equal(genericToastErrorCallbacks('page.ts',`class Page { save(){http.subscribe({error: err=>this.toast.errorFrom(err,'fallback')});} validate(){this.toast.error('Unavailable');} }`).length,0);
assert.equal(genericToastErrorCallbacks('page.ts',`class Page { save(){http.subscribe({error: err=>{this.toast.error('Failed');}});} }`).length,1);
console.log('HTTP error callback syntax distinguishes request errors from local validation.');
