import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isManagedDemoProfile } from '../common/demo-profile';
import { AccessGrantsService } from './access-grants.service';
import type { AuthUser } from '../auth/auth.types';

/** Deterministic local simulation. No networking or external access-system credentials. */
@Injectable()
export class DemoAccessConnectorService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly logger = new Logger(DemoAccessConnectorService.name);
  constructor(private readonly db: PrismaService, private readonly grants: AccessGrantsService, private readonly audit: AuditService) {}
  onModuleInit() { if (isManagedDemoProfile() && process.env.DGOP_DEMO_ADAPTERS === 'true' && process.env.DGOP_DEMO_ADAPTER_SCHEDULER !== 'false') this.timer = setInterval(() => void this.tick(), 2000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async actor(): Promise<AuthUser> {
    const user = await this.db.user.findFirst({ where: { email: 'demo.administrator@dgop.local', isActive: true }, include: { userRoles: { where: { role: { isActive: true, deletedAt: null } }, include: { role: true } } } });
    if (!user || !user.userRoles.some(r => r.role.code === 'system_admin')) throw new Error('Simulation administrator is not installed.');
    return { id: user.id, email: user.email, roles: user.userRoles.map(r => r.role.code) };
  }
  async dispatch(grantId: string, expectedVersion: number, operation: 'grant' | 'update' | 'revoke' | 'verify', actor: AuthUser) {
    if (!isManagedDemoProfile() || process.env.DGOP_DEMO_ADAPTERS !== 'true') throw new Error('Access simulation is disabled outside its managed demonstration.');
    return this.grants.dispatchEnforcement(grantId, { expectedVersion, operation, connectorCode: 'demo_simulator' }, actor);
  }
  async tick() {
    if (this.busy || !isManagedDemoProfile() || process.env.DGOP_DEMO_ADAPTERS !== 'true') return;
    this.busy = true;
    try {
      const actor = await this.actor(), now = new Date(), failures = Number(process.env.DGOP_DEMO_CONNECTOR_FAILURES ?? 0);
      if (!Number.isInteger(failures) || failures < 0 || failures > 3) throw new Error('Simulation failures must be an integer between zero and three.');
      const rows = await this.db.accessEnforcementAttempt.findMany({ where: { connectorCode: 'demo_simulator', nextAttemptAt: { lte: now }, OR: [
        { status: { in: ['queued', 'retrying'] }, attemptCount: { lt: 3 } },
        // A provider observation already claimed must remain resumable if its
        // required completion audit failed, including the third observation.
        { status: 'running', attemptCount: { gt: 0, lte: 3 } },
      ] }, orderBy: { createdAt: 'asc' }, take: 10 });
      for (const attempt of rows) {
        if (attempt.completionVersion == null || !['grant', 'update', 'revoke', 'verify'].includes(attempt.operation)) continue;
        const resume = attempt.status === 'running';
        const count = resume ? attempt.attemptCount : Math.min(3, attempt.attemptCount + 1);
        const failed = resume ? attempt.errorCode === 'demo_simulated_failure' : count <= failures;
        const claimed = resume || await this.db.$transaction(async tx => {
          const result = await tx.accessEnforcementAttempt.updateMany({ where: { id: attempt.id, attemptCount: attempt.attemptCount, status: { in: ['queued', 'running', 'retrying'] } }, data: { attemptCount: count, status: failed && count < 3 ? 'retrying' : 'running', startedAt: now, nextAttemptAt: new Date(now.getTime() + (count === 1 ? 1000 : 2000)), errorCode: failed ? 'demo_simulated_failure' : null, errorMessage: failed ? 'Simulated connector failure; no external system was contacted.' : null } });
          if (result.count) await this.audit.logRequired({ actor: actor.email, action: 'demo.access.simulation.attempt', entityType: 'access_enforcement_attempt', entityId: attempt.id, metadata: { demoOnly: true, simulated: true, externalDelivery: false, attemptCount: count, exhausted: failed && count === 3 } }, tx);
          return result.count === 1;
        });
        if (!claimed || failed && count < 3) continue;
        const result = await this.grants.completeEnforcementAttempt(attempt.id, { expectedVersion: attempt.completionVersion, status: failed ? 'failed' : 'succeeded', providerReference: 'SIMULATED:' + attempt.id, errorCode: failed ? 'demo_retries_exhausted' : undefined, message: failed ? 'Three simulated attempts exhausted. No external system was contacted.' : 'Simulation completed. No external access system was changed.' }, actor);
        if (result.requiresReconciliation) this.logger.warn('A simulated access result is stale and needs a fresh removal confirmation.');
      }
    } catch (error) { this.logger.error('Access simulation paused: ' + (error instanceof Error ? error.message : 'unexpected failure')); }
    finally { this.busy = false; }
  }
}
