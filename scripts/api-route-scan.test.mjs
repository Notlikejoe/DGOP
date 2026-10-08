import assert from 'node:assert/strict';
import { controllerRoutes } from './api-route-scan.mjs';
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
