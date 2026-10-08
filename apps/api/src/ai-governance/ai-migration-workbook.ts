import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';

export type SourceCell = { value: string | number | boolean | null; numericText?: string; formula?: string; numberFormat?: string; dateIso?: string };
export type SourceSheet = { name: string; cells: Record<string, SourceCell> };
export type SourceWorkbook = { source: string; sha256: string; sheets: SourceSheet[]; namedRanges: Record<string,string> };
export const AI_MIGRATION_SOURCES = [
 { source:'risk', file:'أداة_إدارة_مخاطر_الذكاء_الاصطناعي_سدايا (1).xlsx', sha256:'96fa526e69423c14103afa6fea339c219c0778a21b1cd308f2695e806dcc103c' },
 { source:'adoption', file:'أداة_تقييم_تبنى_حالة_استخدام_الذكاء_الاصطناعي.xlsx', sha256:'db7995f60098136ccee27e29590453362d055b7a0413f71d79aafdc57d3984f1' },
] as const;
const array = (v:any): any[] => v===undefined ? [] : Array.isArray(v) ? v : [v];
function text(v:any):string { if(typeof v==='string'||typeof v==='number')return String(v);if(!v)return '';if(v.t!==undefined)return text(v.t);if(v.r!==undefined)return array(v.r).map(text).join('');return text(v['#text']); }
function crc32(b:Buffer){let n=0xffffffff;for(const byte of b){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
/** Bounded OOXML archive reader. No extraction, formula evaluation, macros or external fetches. */
export function workbookArchive(bytes:Buffer):Map<string,Buffer>{
 if(bytes.length>2_000_000||bytes.length<22)throw new Error('Workbook file size is unsupported');
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw new Error('Workbook ZIP directory is invalid');
 const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16),directorySize=bytes.readUInt32LE(end+12);
 if(count>200||offset+directorySize!==end||end+22+bytes.readUInt16LE(end+20)!==bytes.length)throw new Error('Workbook ZIP limits exceeded');
 const files=new Map<string,Buffer>();let pos=offset,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>end||bytes.readUInt32LE(pos)!==0x02014b50)throw new Error('Workbook ZIP entry is invalid');
  const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),crc=bytes.readUInt32LE(pos+16),size=bytes.readUInt32LE(pos+20),expanded=bytes.readUInt32LE(pos+24),nameSize=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),local=bytes.readUInt32LE(pos+42);
  if(pos+46+nameSize+extra+comment>end)throw new Error('Workbook ZIP name is invalid');
  const name=bytes.toString('utf8',pos+46,pos+46+nameSize);pos+=46+nameSize+extra+comment;
  if(flags&1||![0,8].includes(method)||name.includes('..')||name.startsWith('/')||name.includes('\\')||files.has(name)||expanded>4_000_000||(total+=expanded)>12_000_000)throw new Error('Workbook archive entry is unsupported');
  if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Workbook ZIP local entry is invalid');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
  if(start+size>offset)throw new Error('Workbook ZIP bounds exceeded');
  const compressed=bytes.subarray(start,start+size),body=method===8?inflateRawSync(compressed,{maxOutputLength:4_000_000}):compressed;
  if(body.length!==expanded||crc32(body)!==crc)throw new Error('Workbook ZIP checksum differs');files.set(name,body);
 }
 if(pos!==end)throw new Error('Workbook ZIP directory length differs');return files;
}
export function parseMigrationWorkbook(bytes:Buffer,source:string,expectedDigest?:string):SourceWorkbook{
 const sha256=createHash('sha256').update(bytes).digest('hex');if(expectedDigest&&sha256!==expectedDigest)throw new Error('Workbook source checksum differs');
 const files=workbookArchive(bytes),parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,trimValues:false});
 const xml=(name:string,optional=false):any=>{const b=files.get(name);if(!b){if(optional)return {};throw new Error('Workbook XML part is missing');}const raw=b.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw new Error('Workbook XML entities are unsupported');return parser.parse(raw);};
 const book=xml('xl/workbook.xml').workbook,relations=array(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
 const strings=array(xml('xl/sharedStrings.xml',true).sst?.si).map(text),styles=xml('xl/styles.xml',true).styleSheet;
 const formats=new Map(array(styles?.numFmts?.numFmt).map(x=>[Number(x['@_numFmtId']),String(x['@_formatCode'])])),xfs=array(styles?.cellXfs?.xf);
 const sheets:SourceSheet[]=[],names=new Set<string>(),relationshipIds=new Set<string>();let cellCount=0;
 for(const rel of relations){const id=rel['@_Id'];if(typeof id!=='string'||!id||relationshipIds.has(id))throw new Error('Workbook relationship is ambiguous');relationshipIds.add(id);}
 for(const sheet of array(book?.sheets?.sheet)){
  const name=sheet['@_name'];if(typeof name!=='string'||!name.trim()||names.has(name.toLocaleLowerCase()))throw new Error('Workbook sheet name is ambiguous');names.add(name.toLocaleLowerCase());
  const rel=relations.find(r=>r['@_Id']===sheet['@_r:id']);if(!rel||rel['@_TargetMode']==='External')throw new Error('Workbook sheet relationship is unsupported');
  const target=String(rel['@_Target']);if(target.includes('..'))throw new Error('Workbook sheet path is unsupported');
  const part=target.startsWith('/')?target.slice(1):'xl/'+target,ws=xml(part).worksheet,cells:Record<string,SourceCell>={};
  for(const row of array(ws?.sheetData?.row))for(const c of array(row.c)){
   const address=String(c['@_r']);if(!/^[A-Z]{1,3}[1-9]\d{0,4}$/.test(address)||++cellCount>50_000||cells[address])throw new Error('Workbook cell limits exceeded');
   const type=c['@_t'],raw=c.v===undefined?'':text(c.v);let value:SourceCell['value']=null;
   if(type==='s'){const index=Number(raw);if(!raw||!Number.isInteger(index)||strings[index]===undefined)throw new Error('Workbook shared string is invalid');value=strings[index];}
   else if(type==='inlineStr')value=text(c.is);else if(type==='b'){if(raw!=='0'&&raw!=='1')throw new Error('Workbook boolean cell is invalid');value=raw==='1';}else if(type==='str'||type==='e'||type==='d')value=raw||null;
   else if(raw!==''){value=Number(raw);if(!Number.isFinite(value))throw new Error('Workbook numeric cell is invalid');}
   const cell:SourceCell={value};if(typeof value==='number')cell.numericText=raw;if(c.f!==undefined)cell.formula=text(c.f);
   const formatId=Number(xfs[Number(c['@_s']??0)]?.['@_numFmtId']??0),format=formats.get(formatId)??({9:'0%',10:'0.00%'} as Record<number,string>)[formatId];if(format)cell.numberFormat=format;
   if(typeof value==='number'&&((formatId>=14&&formatId<=22)||(format&&/[dy]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g,''))))){
    if(['1','true'].includes(book?.workbookPr?.['@_date1904']))throw new Error('Workbook 1904 date system requires an explicit migration mapping');
    if(value>=61&&value<=73050)cell.dateIso=new Date(Date.UTC(1899,11,30)+Math.round(value*86400000)).toISOString();
   }
   cells[address]=cell;
  }
  sheets.push({name:String(sheet['@_name']),cells});
 }
 const namedRanges:Record<string,string>={};for(const n of array(book?.definedNames?.definedName)){const name=String(n['@_name']);if(name.startsWith('_xlnm.'))continue;if(Object.prototype.hasOwnProperty.call(namedRanges,name))throw new Error('Workbook named range is ambiguous');namedRanges[name]=text(n);}
 return {source,sha256,sheets,namedRanges};
}
