import { computeInherentRisk, jsonRecord, RISK_DIMENSIONS, RiskScoringConfiguration } from './ai-risk-scoring';
import { SourceCell, SourceWorkbook } from './ai-migration-workbook';

export const MIGRATION_PREVIEW_VERSION='ai-source-preview-v1';
export type PreviewKind='reference'|'library'|'control'|'usecase'|'classification'|'risk'|'assessment'|'action'|'intake';
export type PreviewRow={key:string;kind:PreviewKind;source:string;sheet:string;row:number;sourceRef:string;parentRef:string|null;raw:Record<string,SourceCell>;prepared:Record<string,unknown>;issues:string[];checks:Array<{field:string;source:unknown;computed:unknown;equal:boolean|null}>;sample:boolean;status:'prepared'|'quarantined'};
export type PreviewReference={listCode:string;id:string;values:Array<{code:string;labelEn:string;labelAr:string;metadata?:unknown}>};
export type PreviewIdentity={id:string;labels:string[]};
export type PreviewEnvironment={references:PreviewReference[];people:PreviewIdentity[];units:PreviewIdentity[];scoring:RiskScoringConfiguration};
const RISK_ALIASES:Record<string,string>={L_ACTSTATUS:'R_TREATSTATUS',L_ACTTYPE:'R_ACTTYPE',L_CADENCE:'R_CADENCE',L_CTRLEFF:'R_CTRLEFF',L_DEPT:'R_DEPT',L_HUMAN:'R_HITL',L_IMPDIM:'R_IMPD',L_INTENT:'R_INTENT',L_LEVEL:'R_LEVEL',L_LIFECYCLE:'R_LIFECYCLE',L_PRINCIPLE:'R_ETHICS',L_PRIORITY:'R_PRIORITY',L_RELIANCE:'R_RELIANCE',L_RESPONSE:'R_STRATEGY',L_RISKCAT:'R_RISKCAT',L_SCORE:'R_SCORE14',L_SOURCE:'R_SOURCE',L_TECH:'R_TECH',L_TIER:'R_SDAIA_TIER',L_TIER_SCORE:'R_SDAIA_SCORE',L_TIMING:'R_TIMING',L_UCSTATUS:'R_UCSTATUS',L_YESNO:'R_YN',T_DAYS:'R_LEVEL_DAYS',T_LEVEL:'R_LEVEL',T_MIN:'R_MINSCORE'};
const ADOPTION_ALIASES:Record<string,string>={L_YN:'R_YN',L_TIER:'R_SDAIA_TIER',L_TIER_SCORE:'R_SDAIA_SCORE',L_FUNCTIONS:'R_DEPT'};
const value=(r:PreviewRow,col:string)=>r.raw[col]?.value??null;
const literal=(r:PreviewRow,col:string)=>r.raw[col]?.formula===undefined?value(r,col):null;
const nonempty=(v:unknown)=>v!==null&&v!==undefined&&v!=='';
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
/** Exact decimal checksum strings preserve OOXML numeric text and avoid binary SUM / JSON round-trip drift. */
export function sourceDecimalSum(left:string,right:string):string{
 const parse=(v:string)=>{const m=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(v);if(!m)throw new Error('Invalid source decimal checksum');const scale=(m[3]?.length??0)-Number(m[4]??0);let n=BigInt((m[1]??'')+m[2]+(m[3]??''));return scale<0?{n:n*10n**BigInt(-scale),scale:0}:{n,scale};};
 const a=parse(left),b=parse(right),scale=Math.max(a.scale,b.scale),sum=a.n*10n**BigInt(scale-a.scale)+b.n*10n**BigInt(scale-b.scale),negative=sum<0n,s=(negative?-sum:sum).toString().padStart(scale+1,'0');
 const value=scale?(s.slice(0,-scale)+'.'+s.slice(-scale)).replace(/0+$/,'').replace(/\.$/,''):s;return (negative?'-':'')+value;
}
export function exactReference(label:unknown,listCode:string,env:PreviewEnvironment){
 const versions=env.references.filter(v=>v.listCode===listCode);
 if(versions.length!==1)return {issue:'REFERENCE_VERSION:'+listCode};
 const hits=versions[0].values.filter(v=>v.code===label||v.labelAr===label||v.labelEn===label||(typeof label==='number'&&['R_SCORE14','R_SDAIA_SCORE'].includes(listCode)&&jsonRecord(v.metadata)['score']===label));
 return hits.length===1?{value:{listCode,versionId:versions[0].id,code:hits[0].code,labelAr:hits[0].labelAr,labelEn:hits[0].labelEn}}:{issue:(hits.length?'AMBIGUOUS_LABEL:':'UNKNOWN_LABEL:')+listCode};
}
function reference(r:PreviewRow,col:string,field:string,list:string,env:PreviewEnvironment,required=true){
 const v=literal(r,col);if(!nonempty(v)){if(required)r.issues.push('MISSING_FIELD:'+field);return;}
 const result=exactReference(v,list,env);if(result.issue)r.issues.push(result.issue+':'+col);else r.prepared[field]=result.value;
}
function identity(r:PreviewRow,col:string,field:string,records:PreviewIdentity[]){const label=literal(r,col),hits=records.filter(p=>p.labels.includes(String(label)));if(nonempty(label)&&hits.length===1)r.prepared[field]=hits[0].id;else r.issues.push((hits.length>1?'AMBIGUOUS_IDENTITY:':'UNRESOLVED_IDENTITY:')+field);}
function required(r:PreviewRow,col:string,field:string){const v=literal(r,col);if(typeof v!=='string'||!v.trim())r.issues.push('MISSING_FIELD:'+field);else r.prepared[field]=v;}
function date(r:PreviewRow,col:string,field:string,needed=false){const c=r.raw[col];if(!nonempty(c?.value)){if(needed)r.issues.push('MISSING_DATE:'+field);return;}if(c.formula!==undefined){r.issues.push('COMPUTED_DATE_NOT_IMPORTED:'+field);return;}
 if(c.dateIso){r.prepared[field]=c.dateIso;return;}
 if(typeof c.value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(c.value)){const d=new Date(c.value+'T00:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===c.value){r.prepared[field]=d.toISOString();return;}}
 r.issues.push('DATE_MAPPING_REQUIRED:'+field);
}
function compare(r:PreviewRow,col:string,field:string,computed:unknown){const cached=value(r,col),equal=nonempty(cached)?cached===computed:null;r.checks.push({field,source:cached,computed,equal});if(equal===false)r.issues.push('COMPUTED_DIFF:'+field);else if(equal===null)r.issues.push('MISSING_COMPUTED_CACHE:'+field);}
function row(book:SourceWorkbook,sheet:string,n:number,kind:PreviewKind,width:number):PreviewRow{
 const cells=book.sheets.find(s=>s.name===sheet)?.cells??{},raw:Record<string,SourceCell>={};
 for(let i=0;i<width;i++){let j=i+1,col='';while(j){j--;col=String.fromCharCode(65+j%26)+col;j=Math.floor(j/26);}if(cells[col+n])raw[col]=cells[col+n];}
 return {key:book.source+':'+sheet+':'+n,kind,source:book.source,sheet,row:n,sourceRef:String(raw.A?.value??''),parentRef:null,raw,prepared:{},issues:[],checks:[],sample:false,status:'prepared'};
}
function sample(r:PreviewRow,col:string){const mark=literal(r,col);r.sample=nonempty(mark)&&mark!==false&&mark!=='لا';r.prepared['isSampleData']=r.sample;if(r.sample&&typeof mark==='string'&&!/^مثال معبأ|^نعم$/.test(mark))r.issues.push('SAMPLE_MARKER_REVIEW:'+col);}
/** Preserves source cells. Prepared candidates are never authoritative target records or workflow decisions. */
export function buildMigrationPreview(books:SourceWorkbook[],env:PreviewEnvironment){
 const rows:PreviewRow[]=[],globalIssues:string[]=[];
 const riskBook=books.find(b=>b.source==='risk'),adoption=books.find(b=>b.source==='adoption');
 if(!riskBook||!adoption)throw new Error('Both verified source workbooks are required');
 const definitions:Array<[SourceWorkbook,string,PreviewKind,number,number,string[]]>=[
  [riskBook,'مكتبة المخاطر','library',5,70,['C']], [riskBook,'مكتبة ضوابط المعالجة','control',2,11,['B']],
  [riskBook,'حالات استخدام الذكاء الاصطناعي','usecase',5,24,['B','C']], [riskBook,'سجل المخاطر','risk',5,34,['F']],
  [riskBook,'تقييم الأثر','assessment',5,34,['A']], [riskBook,'خطة المعالجة','action',5,54,['D']],
  [adoption,'تقييم تبنى حالة الإستخدام','classification',5,9,['A']],
 ];
 const widths:Record<string,number>={library:11,control:6,usecase:29,risk:38,assessment:14,action:17,classification:14};
 for(const [book,sheet,kind,start,end,body] of definitions){if(!book.sheets.some(s=>s.name===sheet)){globalIssues.push('MISSING_SHEET:'+book.source+':'+sheet);continue;}for(let n=start;n<=end;n++){const r=row(book,sheet,n,kind,widths[kind]);if(body.some(col=>nonempty(literal(r,col))))rows.push(r);}}
 for(const book of books)for(const [name,range] of Object.entries(book.namedRanges)){
  if(['U_IDS','U_NAMES','R_IDS'].includes(name))continue;
  const match=/^'([^']+)'!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(range);
  const r:PreviewRow={key:book.source+':range:'+name,kind:'reference',source:book.source,sheet:'',row:0,sourceRef:name,parentRef:null,raw:{},prepared:{sourceRange:range,listCode:(book.source==='risk'?RISK_ALIASES:ADOPTION_ALIASES)[name]??name},issues:[],checks:[],sample:false,status:'prepared'};
  if(!match||match[2]!==match[4])r.issues.push('UNSUPPORTED_NAMED_RANGE');else{
   r.sheet=match[1];const s=book.sheets.find(s=>s.name===match[1]);if(!s)r.issues.push('MISSING_RANGE_SHEET');else for(let n=+match[3];n<=+match[5];n++){
    const c=s.cells[match[2]+n];if(!c||!nonempty(c.value))continue;r.raw[match[2]+n]=c;
    const res=exactReference(c.value,String(r.prepared['listCode']),env);if(res.issue)r.issues.push(res.issue+':'+n);
    if(res.value){r.prepared['values']??=[];(r.prepared['values'] as unknown[]).push(res.value);}
   }
  }
  rows.push(r);
 }
 // The intake sheet is an empty form in this source; retain its blanks, never manufacture a submitted intake.
 const intakeSheet=adoption.sheets.find(s=>s.name==='نموذج مدخلات التقييم');
 if(intakeSheet){const r:PreviewRow={key:'adoption:intake',kind:'intake',source:'adoption',sheet:intakeSheet.name,row:1,sourceRef:'unbound-intake',parentRef:null,raw:intakeSheet.cells,prepared:{},issues:['INTAKE_PARENT_MAPPING_REQUIRED'],checks:[],sample:false,status:'quarantined'};const answers=Object.entries(intakeSheet.cells).filter(([a,c])=>/^[C-F]\d+$/.test(a)&&nonempty(c.value));r.prepared['answerCount']=answers.length;if(!answers.length)r.issues.push('EMPTY_INTAKE_FORM');rows.push(r);}else globalIssues.push('MISSING_INTAKE_SHEET');
 const idPatterns:Partial<Record<PreviewKind,RegExp>>={library:/^AIRL-\d{3,}$/,usecase:/^AI-\d{3,}$/,risk:/^AIR-\d{3,}$/,action:/^ACT-\d{3,}$/,assessment:/^AIR-\d{3,}$/,classification:/^AI-\d{3,}$/};
 for(const r of rows){if(idPatterns[r.kind]&&!idPatterns[r.kind]!.test(r.sourceRef))r.issues.push('MALFORMED_SOURCE_ID');
  if(idPatterns[r.kind]&&rows.filter(v=>v.kind===r.kind&&v.sourceRef===r.sourceRef).length!==1)r.issues.push('DUPLICATE_SOURCE_ID');
  if(r.kind==='library'){
   for(const [col,field] of [['B','risk_domain'],['C','titleAr'],['E','description'],['F','probable_causes'],['G','probable_impacts'],['H','example_controls'],['I','attention_indicators']])required(r,col,field);
   reference(r,'D','dev_stage','R_LIFECYCLE',env);reference(r,'J','ethics_principle','R_ETHICS',env);reference(r,'K','risk_category','R_RISKCAT',env);
   r.issues.push('ENGLISH_TITLE_REVIEW_REQUIRED');r.prepared['suggestionsOnly']=true;
  }else if(r.kind==='control'){
   for(const [col,field] of [['A','sourceDimensions'],['B','sourceTitle'],['C','sourceCitation'],['D','technicalControls'],['E','organizationalControls'],['F','legalEthicalControls']])required(r,col,field);
   r.sourceRef='source-control-'+r.row;r.issues.push('CONTROL_CODE_AND_MAPPING_REVIEW_REQUIRED');r.prepared['suggestionsOnly']=true;
  }else if(r.kind==='usecase'){
   required(r,'B','systemName');required(r,'C','title');required(r,'D','description');required(r,'J','purpose');required(r,'K','dataUsed');required(r,'L','dataSource');
   reference(r,'E','department','R_DEPT',env);identity(r,'E','organizationUnitId',env.units);identity(r,'F','ownerPersonId',env.people);
   for(const [col,field,list] of [['H','technology','R_TECH'],['I','stage','R_LIFECYCLE'],['M','personalData','R_YN'],['N','sensitiveData','R_YN'],['O','thirdParty','R_YN'],['P','offshore','R_YN'],['Q','reliance','R_RELIANCE'],['R','humanIntervention','R_HITL'],['W','operationalStatus','R_UCSTATUS']])reference(r,col,field,list,env);
   date(r,'X','lastReview');sample(r,'AC');r.prepared['sourceApprovedTier']=literal(r,'AB');if(r.raw.AB?.formula!==undefined)r.issues.push('APPROVED_TIER_FORMULA_NOT_AUTHORITY');
  }else if(r.kind==='risk'){
   r.parentRef=String(value(r,'B')??'');for(const [col,field] of [['F','title'],['H','description'],['I','cause'],['J','event'],['K','effect'],['L','currentControls']])required(r,col,field);
   for(const [col,field,list] of [['D','category','R_RISKCAT'],['E','principle','R_ETHICS'],['G','devStage','R_LIFECYCLE'],['M','controlEffectiveness','R_CTRLEFF'],['R','strategy','R_STRATEGY'],['AJ','riskSource','R_SOURCE'],['AK','riskIntent','R_INTENT'],['AL','riskTiming','R_TIMING']])reference(r,col,field,list,env);
   identity(r,'T','ownerPersonId',env.people);identity(r,'U','executorPersonId',env.people);date(r,'V','registeredAt',true);date(r,'W','targetDate',true);date(r,'AD','lastReview');sample(r,'AH');
   for(const [col,field] of [['N','likelihood'],['Z','residualLikelihood'],['AA','residualImpact']]){const v=literal(r,col);if(int(v,1,4))r.prepared[field]=v;else r.issues.push('SCORE_OUT_OF_RANGE:'+field);}
   // Workbook residual values lack fresh independent assessment/authority provenance.
   r.prepared['authorityImported']=false;r.issues.push('LEGACY_ASSESSMENT_AUTHORITY_REVIEW_REQUIRED');
  }else if(r.kind==='assessment'){
   r.parentRef=r.sourceRef;const dims=RISK_DIMENSIONS.map((dimension,i)=>({dimension,value:literal(r,String.fromCharCode(67+i)),justification:String(literal(r,'M')??'')}));
   r.prepared['dimensions']=dims;if(dims.some(d=>!int(d.value,1,4)))r.issues.push('DIMENSION_SCORE_OUT_OF_RANGE');required(r,'M','sourceJustification');sample(r,'N');
   r.issues.push('COMPETENT_ASSESSOR_PROVENANCE_REVIEW_REQUIRED');
  }else if(r.kind==='action'){
   r.parentRef=String(value(r,'B')??'');required(r,'D','description');reference(r,'E','actionType','R_ACTTYPE',env);reference(r,'F','priority','R_PRIORITY',env);reference(r,'J','status','R_TREATSTATUS',env);identity(r,'G','executorPersonId',env.people);
   date(r,'H','startDate',true);date(r,'I','targetDate',true);date(r,'N','closureDate');sample(r,'Q');const pct=literal(r,'K');
   // Source percentages are fractions: the number format proves the unit; never guess from <=1.
   if(typeof pct==='number'&&pct>=0&&pct<=1&&r.raw.K?.numberFormat?.includes('%'))r.prepared['completionPct']=pct*100;else r.issues.push('COMPLETION_UNIT_OR_RANGE_INVALID');
   if(literal(r,'J')==='مكتمل'&&(!r.prepared['closureDate']||r.prepared['completionPct']!==100))r.issues.push('COMPLETED_ACTION_INCONSISTENT');
   r.issues.push('EVIDENCE_AND_PLAN_APPROVAL_REVIEW_REQUIRED');
  }else if(r.kind==='classification'){
   r.parentRef=r.sourceRef;const scores=['C','D','E','F','G','H'].map(c=>literal(r,c));r.prepared['criteria']=scores;
   if(scores.every(v=>int(v,1,5))){const max=Math.max(...scores as number[]);r.prepared['maxScore']=max;compare(r,'I','classificationScore',max);
    const versions=env.references.filter(v=>v.listCode==='R_SDAIA_TIER'),tiers=versions.length===1?versions[0].values.filter(v=>{const m=jsonRecord(v.metadata);return m['automatic']===true&&typeof m['minScore']==='number'&&typeof m['maxScore']==='number'&&max>=m['minScore']&&max<=m['maxScore'];}):[];
    if(tiers.length===1){r.prepared['proposedTier']={code:tiers[0].code,versionId:versions[0].id};compare(r,'J','proposedTier',tiers[0].labelAr);}else r.issues.push('TIER_CONFIGURATION_UNAVAILABLE');
   }else r.issues.push('CLASSIFICATION_SCORE_OUT_OF_RANGE');reference(r,'K','sourceApprovedTier','R_SDAIA_TIER',env);date(r,'M','classifiedAt',true);r.issues.push('LEGACY_CLASSIFICATION_APPROVAL_REVIEW_REQUIRED');
  }
 }
 for(const r of rows.filter(v=>v.kind==='risk')){
  const a=rows.filter(v=>v.kind==='assessment'&&v.parentRef===r.sourceRef);
  if(a.length!==1)r.issues.push('ASSESSMENT_LINK_MISSING_OR_AMBIGUOUS');else try{
   const d=a[0].prepared['dimensions'] as any,result=computeInherentRisk(r.prepared['likelihood'] as number,d,env.scoring);r.prepared['inherentPreview']=result;a[0].prepared['impactPreview']=result.impactFinal;
   compare(a[0],'K','impactFinal',result.impactFinal);compare(a[0],'L','impactTopDimension',env.scoring.dimensions.find(x=>x.dimension===result.impactTopDimension)?.labelAr??null);
   compare(r,'O','inherentImpact',result.impactFinal);compare(r,'P','inherentScore',result.score);compare(r,'Q','inherentBand',result.bandLabelAr);
  }catch{r.issues.push('SCORING_CONFIGURATION_OR_INPUT_UNAVAILABLE');}
  const p=r.prepared['residualLikelihood'],i=r.prepared['residualImpact'];if(int(p,1,4)&&int(i,1,4)){const score=(p as number)*(i as number);r.prepared['residualScorePreview']=score;compare(r,'AB','residualScore',score);const bands=env.scoring.bands.filter(b=>score>=b.minScore&&score<=b.maxScore);if(bands.length===1)compare(r,'AC','residualBand',bands[0].labelAr);else r.issues.push('RESIDUAL_BAND_CONFIGURATION_UNAVAILABLE');}
  const actions=rows.filter(v=>v.kind==='action'&&v.parentRef===r.sourceRef),pcts=actions.map(a=>a.prepared['completionPct']);if(actions.length&&pcts.every(p=>typeof p==='number')){const mean=(pcts as number[]).reduce((a,b)=>a+b,0)/actions.length;r.prepared['completionPctPreview']=mean;const cached=value(r,'Y');r.checks.push({field:'riskCompletionPct',source:cached,computed:mean,equal:typeof cached==='number'?Math.abs(cached*100-mean)<1e-9:null});if(r.checks.at(-1)!.equal!==true)r.issues.push('COMPUTED_DIFF:riskCompletionPct');}
 }
 for(const r of rows.filter(v=>v.kind==='usecase')){const children=rows.filter(v=>v.kind==='risk'&&v.parentRef===r.sourceRef);r.prepared['linkedRiskCountPreview']=children.length;compare(r,'U','linkedRiskCount',children.length);const scores=children.map(c=>jsonRecord(c.prepared['inherentPreview'])['score']);if(children.length&&scores.every(s=>typeof s==='number')){const max=Math.max(...scores as number[]),bands=env.scoring.bands.filter(b=>max>=b.minScore&&max<=b.maxScore);if(bands.length===1)compare(r,'V','highestInherentBand',bands[0].labelAr);}}
 // A failed parent quarantines its complete dependent branch; rejection never makes an orphan loadable.
 const parentKinds:Partial<Record<PreviewKind,PreviewKind>>={risk:'usecase',action:'risk',assessment:'risk',classification:'usecase'};
 for(const r of rows){const kind=parentKinds[r.kind];if(kind){const p=rows.filter(v=>v.kind===kind&&v.sourceRef===r.parentRef);if(p.length!==1)r.issues.push('ORPHAN_OR_AMBIGUOUS_PARENT');else if(p[0].sample){r.sample=true;r.prepared['isSampleData']=true;}}}
 for(let pass=0;pass<3;pass++)for(const r of rows){const kind=parentKinds[r.kind],p=rows.find(v=>v.kind===kind&&v.sourceRef===r.parentRef);if(p?.issues.length&&!r.issues.includes('PARENT_QUARANTINED'))r.issues.push('PARENT_QUARANTINED');}
 for(const r of rows){r.issues=[...new Set(r.issues)];r.status=r.issues.length?'quarantined':'prepared';}
 const counts=Object.fromEntries(['reference','library','control','usecase','risk','assessment','action','classification','intake'].map(k=>[k,rows.filter(r=>r.kind===k).length]));
 if(counts['library']!==66)globalIssues.push('LIBRARY_EXPECTED_66');if(counts['control']!==10)globalIssues.push('CONTROL_EXPECTED_10');
 const sourceNumericTotals:Record<string,string>={};for(const r of rows)for(const [col,c] of Object.entries(r.raw))if(typeof c.value==='number'&&!c.dateIso){const key=r.kind+'.'+col;sourceNumericTotals[key]=sourceDecimalSum(sourceNumericTotals[key]??'0',c.numericText??String(c.value));}
 const sourceCount=rows.length,quarantined=rows.filter(r=>r.status==='quarantined').length,expectedPilotRefs=Array.from({length:20},(_,i)=>'AI-'+String(i+1).padStart(3,'0')),availablePilotRefs=rows.filter(r=>r.kind==='usecase'&&expectedPilotRefs.includes(r.sourceRef)).map(r=>r.sourceRef);
 return {version:MIGRATION_PREVIEW_VERSION,sources:books.map(b=>({source:b.source,sha256:b.sha256})),referencePins:env.references.map(v=>({listCode:v.listCode,versionId:v.id})),rows,
  reconciliation:{counts,sourceCount,preparedCount:sourceCount-quarantined,quarantinedCount:quarantined,loadedCount:0,countBalanced:true,sampleCount:rows.filter(r=>r.sample).length,sourceNumericTotals,checksumBasis:'exact_decimal_OOXML_numeric_text',targetNumericTotals:null,targetCompared:false,zeroDiff:null,idChainVerified:!rows.some(r=>r.issues.includes('ORPHAN_OR_AMBIGUOUS_PARENT')),computedDiffCount:rows.flatMap(r=>r.checks).filter(c=>c.equal===false).length,globalIssues,pilot:{expectedCount:20,availableRefs:availablePilotRefs,missingRefs:expectedPilotRefs.filter(r=>!availablePilotRefs.includes(r)),loaded:false,signedOff:false},productionReady:false,mode:'VALIDATE_ONLY'}};
}
