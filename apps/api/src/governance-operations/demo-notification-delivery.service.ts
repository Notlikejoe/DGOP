import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { isManagedDemoProfile } from '../common/demo-profile';
import { assertAiDeliveryEligible } from '../ai-governance/ai-notifications';

/** An isolated, visible simulation. Email attempts never contact an email provider. */
@Injectable()
export class DemoNotificationDeliveryService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly logger = new Logger(DemoNotificationDeliveryService.name);
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}
  private enabled() { return isManagedDemoProfile() && process.env.DGOP_DEMO_ADAPTERS === 'true'; }
  onModuleInit() { if (this.enabled() && process.env.DGOP_DEMO_ADAPTER_SCHEDULER !== 'false') this.timer = setInterval(() => void this.tick(), 2000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    if (this.busy || !this.enabled()) return;
    this.busy = true;
    try {
      const now = new Date(), configured = Number(process.env.DGOP_DEMO_NOTIFICATION_FAILURES ?? 0);
      const failures = Number.isInteger(configured) ? Math.min(3, Math.max(0, configured)) : 0;
      const rows = await this.db.governanceNotificationDeliveryAttempt.findMany({ where: { status: { in: ['planned', 'failed'] }, attemptCount: { lt: 3 }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }, orderBy: { createdAt: 'asc' }, take: 20 });
      for (const attempt of rows) await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT id FROM governance_notification_delivery_attempts WHERE id=${attempt.id} FOR UPDATE`;
        const current = await tx.governanceNotificationDeliveryAttempt.findUnique({ where: { id: attempt.id }, include: { notification: true } });
        if (!current || !['planned', 'failed'].includes(current.status) || current.attemptCount >= 3 || current.nextRetryAt && current.nextRetryAt > now) return;
        const payload = current.payloadJson && typeof current.payloadJson === 'object' && !Array.isArray(current.payloadJson) ? current.payloadJson as Prisma.JsonObject : {};
        if (current.notification.status === 'archived') {
          await tx.governanceNotificationDeliveryAttempt.update({ where: { id: current.id }, data: { status: 'skipped', nextRetryAt: null, errorMessage: 'Notification was archived before the local simulation.' } });
          await this.audit.logRequired({ actor: 'demo-notification-simulator', action: 'demo.notification.simulation.skipped', entityType: 'governance_notification_delivery_attempt', entityId: current.id, metadata: { demoOnly: true, simulated: true, externalDelivery: false, reason: 'archived' } }, tx);
          return;
        }
        // Native eligibility still checks recipient roles, scope, preferences, template and live work.
        try { await assertAiDeliveryEligible(tx, current.id, now); }
        catch (error) {
          // A preference/window denial remains visible and is not recorded as successful delivery.
          await tx.governanceNotificationDeliveryAttempt.update({ where: { id: current.id }, data: { nextRetryAt: new Date(now.getTime() + 30 * 60 * 1000), errorMessage: 'Local simulation deferred: ' + (error instanceof Error ? error.message : 'native eligibility denied') } });
          return;
        }
        const count = current.attemptCount + 1, failed = count <= failures;
        const errorMessage = failed ? count === 3 ? 'Three local simulation attempts exhausted. No external message was sent.' : 'Local delivery simulation failed; a bounded retry is scheduled.' : null;
        await tx.governanceNotificationDeliveryAttempt.update({ where: { id: current.id }, data: { attemptCount: count, lastAttemptAt: now, status: failed ? 'failed' : 'sent', provider: current.channel === 'in_app' ? 'dgop-in-app-demo' : 'demo-email-simulator', deliveredAt: failed ? null : now, nextRetryAt: failed && count < 3 ? new Date(now.getTime() + (count === 1 ? 1000 : 2000)) : null, errorMessage, payloadJson: { ...payload, demoOnly: true, simulated: true, externalDelivery: false, simulationOutcome: failed ? 'failed' : 'completed', attemptsExhausted: failed && count === 3 } } });
        await this.audit.logRequired({ actor: 'demo-notification-simulator', action: 'demo.notification.simulation.attempt', entityType: 'governance_notification_delivery_attempt', entityId: current.id, metadata: { demoOnly: true, simulated: true, externalDelivery: false, notificationId: current.notificationId, channel: current.channel, attemptCount: count, exhausted: failed && count === 3 } }, tx);
      });
    } catch (error) { this.logger.error('Notification simulation paused: ' + (error instanceof Error ? error.message : 'unexpected failure')); }
    finally { this.busy = false; }
  }
}
