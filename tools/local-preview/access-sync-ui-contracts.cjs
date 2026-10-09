const fs=require('node:fs');const root='C:/Users/Youss/Documents/Codex/work/dgop-access-sync/source';
const mutate=(relative,fn)=>{const file=root+'/'+relative,old=fs.readFileSync(file,'utf8'),next=fn(old);if(next===old)throw Error('Expected edit not found: '+relative);fs.writeFileSync(file,next);};
for(const folder of ['foi','access-management','security-governance'])mutate('apps/web/src/app/pages/governance/'+folder+'/'+folder+'.ts',s=>s.replace(/protected readonly (can\w+) = this\.auth\.hasPermission\(([^\n]+)\);/g,'protected get $1(): boolean { return this.auth.hasPermission($2); }'));
mutate('apps/web/src/app/app.routes.ts',s=>s.replace(/(path: 'governance\/ai-[^']+',\s*canActivate:) \[[^\n]+\],/g,'$1 [pageAccessGuard],'));
mutate('apps/web/src/app/pages/dashboard/dashboard.ts',s=>{
 s=s.replace("import { I18nService }", "import { AuthService } from '../../core/auth.service';\nimport { I18nService }");
 s=s.replace('  private readonly api = inject(ApiService);','  private readonly auth = inject(AuthService);\n  private readonly api = inject(ApiService);');
 s=s.replace('protected readonly primaryAction = computed<ActionItem | null>', 'private readonly primaryActionCandidate = computed<ActionItem | null>');
 s=s.replace('  protected readonly actionItems = computed<ActionItem[]>(() => {',"  protected readonly primaryAction = computed(() => { const item=this.primaryActionCandidate(); return item && this.auth.canAccessPage(item.link) ? item : null; });\n\n  protected readonly actionItems = computed<ActionItem[]>(() => {");
 s=s.replace('    return items;\n  });','    return items.filter(item => this.auth.canAccessPage(item.link));\n  });');
 s=s.replace('protected readonly journeyNodes = computed<JourneyNode[]>','private readonly journeyNodeCandidates = computed<JourneyNode[]>');
 s=s.replace('  ngOnInit(): void {','  protected readonly journeyNodes = computed(() => this.journeyNodeCandidates().filter(item => this.auth.canAccessPage(item.link)));\n\n  ngOnInit(): void {');
 return s;
});
console.log('Captured permission flags and route/quick-link consumers updated');
