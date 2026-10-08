# DGOP isolated stability demo — operator guide

The repaired candidate uses its own source, dependencies, Prisma client, database and files. The original checkout stays on `main` and its existing app stays at http://localhost:4206. The presentation candidate is reserved for http://localhost:4207/login. Do not call that candidate ready until the release report passes every agreed gate and the genuine PrimeUI license is verified in the browser.

## Workstation configuration

- Candidate: `C:\Users\Youss\Documents\Codex\work\dgop-stability\source`.
- Explicit presentation profile: `C:\Users\Youss\Documents\Codex\work\dgop-stability\demo\.env.demo`.
- Isolated PostgreSQL: loopback port 55438, presentation database `dgop_ai_preview_20261003`.
- Node 24.19.0; npm 11.13.0. The candidate has separate locked installations under `apps/api` and `apps/web`.
- PrimeUI key: configure `apps/web/src/app/core/primeui-license.local.ts` with your genuine key. This file is ignored by Git and excluded from delivery archives. Rebuild the UI after configuring it. A nonempty file is only a preflight check; the browser must confirm the license warning and host disappear.
- Configure `DGOP_TEST_PG_BIN` in the selected profile with `C:/Program Files/PostgreSQL/18/bin` for this workstation's backup tools. `DGOP_BROWSER_EXE` may explicitly select an installed Chrome executable; record its version in the browser receipt.

Every managed command selects the same absolute profile. The profile owns application settings and cannot be replaced by a developer `.env` or inherited connection. Startup never installs dependencies, migrates, seeds, or resets passwords. Do not substitute the original developer database or the legacy start-demo scripts.

## Commands

Run from the candidate folder. The PowerShell helper selects the pinned runtime and the prepared isolated profile:

```powershell
.\scripts\demo.ps1 preflight
.\scripts\demo.ps1 setup
.\scripts\demo.ps1 start
.\scripts\demo.ps1 check
.\scripts\demo.ps1 credentials
.\scripts\demo.ps1 verify
.\scripts\demo.ps1 stop
.\scripts\demo.ps1 backup
.\scripts\demo.ps1 restore
.\scripts\demo.ps1 recover
.\scripts\demo.ps1 soak
```

`setup` resumes native decisions from atomic checkpoints. It preserves credentials and existing memberships, adds explicitly required fixture roles, and rejects conflicting fixture ownership. If a step fails, preserve its installation folder and rerun setup after fixing the diagnostic. Never delete records to make verification pass. `recover` handles the recorded runtime after interruption; it does not reinstall data.

`start` prints the presentation link only after API/database health, every installed persona's session identity, native governance verification and audit-chain checks pass. License presence is checked before it starts. Keep the final licensed browser acceptance receipt with the release report.

`backup` requires the candidate stopped. It includes private credentials and the selected environment file inside the ignored backup folder; protect that folder as secret material and never put it in Git or a public verification archive. `restore` creates a fresh test database and separate restored files, verifies complete database fingerprints, the audit chain, evidence/attachment bytes and synthetic source bytes, and preserves the source installation. Application smoke on the restored instance remains an additional check. `test:demo:restored-runtime` accepts the absolute backup `verification.json` path under an explicitly selected engineering profile, validates the saved hashes, and tests the fresh restored application's 22 logins and native records using its backed-up credentials.

Use the pinned Node executable and npm CLI to run the automated gates listed in `package.json`: `qa`, API tests/build, web tests/build, `test:database`, `test:demo`, `test:demo:native`, `test:demo:runtime`, and `test:demo:journeys`. Database-backed tests require `DGOP_AI_TEST_DATABASE_URL` on isolated port 55438 with a `dgop_ai_test_` name. The explicit `--qa-fixture` profile is an engineering rehearsal and cannot certify the licensed presentation. `test:demo:journeys` creates ten separate test databases and runs fresh native writes plus setup replay in each; a diagnostic `--count 1` does not pass the ten-repetition gate.

## Login details

`test:demo:soak` runs 60 minutes of authenticated reads and complete native verification with the normal local simulation workers enabled. Its receipt remains an engineering availability result; combine it with the independent ten native-write repetitions and the licensed browser report before any demo approval. The 22-persona browser matrix keeps the license warning as a failure while recording functional diagnostics, browser version and navigation p95 separately.

`test:demo:register-browser` accepts only a verified separate engineering restore. It creates 105 synthetic drafts in each AI register through native services and independent risk-owner assignment, then checks browser pagination, server search, complete summary counts and discovery beyond the first 100. These extra draft records stay out of the presentation installation and the main journey/soak fixtures.

`test:demo:browser-writes` uses the separate engineering restore for actual UI creation/save by the requester and native triage by a different eligible reviewer. It retains the classification stage as pending and verifies the complete audit chain. Its checkpoint preserves the draft and completed triage across interrupted checks; it does not complete classification, register an operational asset or create compliance proof.

Passwords are generated locally, stored only in the selected installation's `credentials.local.json`, and preserved by setup replay. The credentials command displays presentation passwords privately after successful installation. No presentation passwords exist until that installation completes. Never present credentials from an engineering test database as the port-4207 demo's credentials.

| Persona / email | Presentation purpose |
|---|---|
| `demo.showcase@dgop.local` | Main presenter; native governance records and pending intake |
| `demo.working@dgop.local` | Independent working-group assessment and registration proposal |
| `demo.officer@dgop.local` | Governance verification, monitoring and reporting |
| `demo.owner@dgop.local` | Actual AI use-case owner |
| `demo.riskowner@dgop.local` | Actual risk owner and assessments |
| `demo.dataowner@dgop.local` | Data owner, access decisions and evidence submission |
| `demo.custodian@dgop.local` | Independent catalog/evidence review; actual data-owner role for ownership approval |
| `demo.privacy@dgop.local` | Assigned privacy officer and independent privacy decisions |
| `demo.security@dgop.local` | Security specialist |
| `demo.ethics@dgop.local` | Independent ethics authority |
| `demo.executive@dgop.local` | Independent executive authority |
| `demo.model@dgop.local` | Assigned treatment executor |
| `demo.mlops@dgop.local` | MLOps assessment |
| `demo.business@dgop.local` | Business stewardship |
| `demo.steering@dgop.local` | Steering authority |
| `demo.compliance@dgop.local` | AI compliance review |
| `demo.auditor@dgop.local` | Read-only audit view |
| `demo.executiveviewer@dgop.local` | Aggregate executive view |
| `demo.workflowdesigner@dgop.local` | Workflow design |
| `demo.workflowpublisher@dgop.local` | Workflow publication |
| `demo.workflowreviewer@dgop.local` | Independent workflow review |
| `demo.administrator@dgop.local` | Platform oversight and technical administration |

There are 22 distinct persona accounts in the current fixture definition. Verification derives its account count from the manifest rather than this table. Administrators require an actual eligible business role, assignment, scope and independent evidence for business decisions.

## Presentation walkthrough

1. Sign in as showcase. Point out the synthetic demo banner and simulated delivery labels.
2. Open Assets and the synthetic service-request register. Show separate approved owner and business-steward assignments and their independent decision attachments.
3. Open Workflow and show the ownership/stewardship decision trail. Switch to the reviewer and owner personas to explain their duties.
4. Open Evidence and NDI readiness. Show approved synthetic evidence and its provenance. Explain why operational readiness excludes it while the guarded scenario score demonstrates the same calculation separately. Operational exports continue to exclude synthetic proof.
5. Open Data Quality and the completed synthetic missing-identifier issue with its resolution.
6. Open Privacy as the privacy officer. Show verified synthetic identity, completion proof, versioned request updates, and two incidents: documented local notification simulation and a documented not-required disposition. Closing an incident does not create notification completion.
7. Open Access Management. Show independent owner approvals, immutable simulated provisioning, confirmed removal, and date-derived expiry indicators. No external access system was changed.
8. Open AI Use Cases and show the three completed journeys: Document Classification Assistant, Service Request Routing Assistant, Policy Guidance Assistant. Show independent classification, assessment, adoption, treatment, residual acceptance, one completed review and one scheduled review per journey.
9. Open the complete Employee Support Knowledge Assistant intake that remains pending triage. Do not approve it during the scripted presentation unless you intentionally create and record a new fixture version.
10. Show AI dashboard, review register, audit/history and checksum-pinned synthetic source preparation. Explain that production source acceptance is separate. Demonstrate search/paging; the database suite exercises 105-row registers.
11. Switch to auditor, executive viewer and administrator to show their different screens and business action limits. Demonstrate Arabic/RTL, both themes and mobile layouts only after the browser gate passes.

## دليل التشغيل بالعربية

النسخة الحالية الأصلية تبقى على الفرع `main` وعلى http://localhost:4206. النسخة المرشحة المعزولة مخصصة للرابط http://localhost:4207/login. لا تُعلن جاهزية العرض قبل نجاح جميع بوابات التحقق وتفعيل ترخيص PrimeUI أصلي واختفـاء تحذيره في المتصفح.

استخدم ملف الإعداد المطلق نفسه في كل الأوامر. شغّل مساعد PowerShell أعلاه بالترتيب: `preflight` ثم `setup` ثم `start` و`check`. يعرض أمر `credentials` بيانات الدخول الخاصة محلياً بعد اكتمال تثبيت العرض المرخّص. تُحفظ كلمات المرور والقرارات والمعرّفات عند إعادة التثبيت؛ لا تستخدم حسابات قاعدة اختبار هندسية كحسابات العرض.

تبدأ جولة العرض بالأصول والمالك والأمين ثم سير العمل والأدلة وجودة البيانات والخصوصية وإدارة الوصول وحوكمة الذكاء الاصطناعي. اعرض ثلاث رحلات مكتملة ومثالاً ينتظر المراجعة. وضّح أن البيانات اصطناعية، وأن إرسال الإشعارات وتنفيذ الوصول محاكاة محلية، وأن درجة السيناريو منفصلة عن درجة الجاهزية التشغيلية. الأدلة الاصطناعية ليست إثبات امتثال تشغيلي أو قبولاً تنظيمياً.

استخدم `stop` للإيقاف، و`backup` للنسخة الاحتياطية، و`restore` للتحقق من الاستعادة إلى قاعدة جديدة وملفات مستقلة. عند انقطاع التثبيت احتفظ بالملفات ثم أعد `setup` بعد إصلاح السبب. لا تحذف قرارات مكتملة، ولا تُغيّر قاعدة التطبيق الأصلي، ولا تُرسل أي بيانات إلى خدمات خارجية.

The latest source/lockfile-bound release report is authoritative for completed and outstanding gates. The 60-minute soak and ten native journey repetitions must have separate receipts; read-only assertion repeats do not satisfy journey repetition.
