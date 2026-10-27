import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { isSyntheticPopulationProfile } from './synthetic-population-profile';

const labelField = /^(?:name|title|label|displayName|fullName|description|definition|term|processName|businessProcess|useCase|riskName|riskDescription|activityName|ownerName|requesterName|respondentName|sourceName|purpose|objective|valueDriver|summary|notes|body)(?:En|Ar)?$/i;
// These are original records, signed snapshots or executable inputs, not labels.
const originalField = /snapshot$|proof$|^(?:metadata|payload|formDataJson|inputJson|outputJson|inputs|result|planData|effectiveConfiguration|proof|proofs|evidenceProofs?|decisionEvidence|auditLogs?|history|timeline)$/i;

export function businessLabel(text: string): string {
  return text
    .replace(/VERIFIED SYNTHETIC DEMO\s*[—–-]\s*4212\s*[—–-]?\s*/gi, '')
    .replace(/Synthetic DGOP demo finance-hr-[a-f0-9-]{36}\s*[;.—–-]?\s*/gi, '')
    .replace(/\bDEMO\s*[—–:-]\s*/gi, '')
    .replace(/عرض\s+تجريبي\s*[—–:-]?\s*/g, '')
    .replace(/\bsynthetic demonstration\b/gi, 'synthetic records')
    .replace(/\bDemonstration Data Owner\b/gi, 'Data Owner')
    .replace(/\bdemonstration\b/gi, 'validation')
    .replace(/\bdemo\b/gi, 'validation')
    .replace(/البيانات التجريبية/g, 'البيانات')
    .replace(/\bhr\b/gi, 'HR')
    .replace(/\bfinance\b/gi, 'Finance')
    .replace(/^[\s;.—–-]+|[\s;—–-]+$/g, '')
    .trim();
}

export function presentBusinessLabels(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(presentBusinessLabels);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    originalField.test(key) ? item : typeof item === 'string' && labelField.test(key)
      ? businessLabel(item) : presentBusinessLabels(item),
  ]));
}

export function sampleLabelsEnabled(env: NodeJS.ProcessEnv, trusted: boolean): boolean {
  if (!trusted || env.DGOP_SAMPLE_LABELS !== 'business' || env.NODE_ENV !== 'development') return false;
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    return env.DGOP_PROFILE === 'main-preview' && env.DB_NAME === 'dgop_ai_preview_202610214212'
      && url.hostname === '127.0.0.1' && url.port === '55436' && url.pathname === '/' + env.DB_NAME;
  } catch { return false; }
}

export function labelReadAllowed(method: string, path: string): boolean {
  return method === 'GET' && !/(?:^|\/)(?:audit|audit-packs|exports?|downloads?|files?|proofs?|history|timeline|manifests?|snapshots?)(?:\/|$)/i.test(path.split('?')[0]);
}

@Injectable()
export class SampleLabelsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{method: string; originalUrl?: string; url: string}>();
    if (!labelReadAllowed(request.method, request.originalUrl ?? request.url)
      || !sampleLabelsEnabled(process.env, isSyntheticPopulationProfile())) return next.handle();
    return next.handle().pipe(map(presentBusinessLabels));
  }
}
