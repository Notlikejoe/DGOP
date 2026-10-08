import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const fixtureDirectory = version => fileURLToPath(new URL(`./data/demo-sources-${version}/`, import.meta.url));
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function crc32(buffer){let value=0xffffffff;for(const byte of buffer){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function archive(parts){const locals=[],entries=[];let offset=0;for(const [name,text] of Object.entries(parts)){const body=Buffer.from(text),compressed=deflateRawSync(body),filename=Buffer.from(name),crc=crc32(body),local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(filename.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);locals.push(local,filename,compressed);entries.push(central,filename);offset+=local.length+filename.length+compressed.length;}const directory=Buffer.concat(entries),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(parts).length,8);end.writeUInt16LE(Object.keys(parts).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
export function syntheticWorkbook(source,version='v1'){
 if(!['risk','adoption'].includes(source))throw new Error('Unknown synthetic workbook source');
 if(!['v1','v2','v3'].includes(version))throw new Error('Unknown synthetic workbook version');
 const sheets=source==='risk'?['مكتبة المخاطر','مكتبة ضوابط المعالجة','حالات استخدام الذكاء الاصطناعي','سجل المخاطر','تقييم الأثر','خطة المعالجة']:['تقييم تبنى حالة الإستخدام','نموذج مدخلات التقييم'];const cells={};
 if(source==='risk'){
 cells['مكتبة المخاطر']={A5:'AIRL-001',B5:'DEMO ONLY',C5:'مثال اصطناعي لمراجعة المخاطر',D5:'PILOT',E5:'Synthetic privacy scenario',F5:'Synthetic input error',G5:'Incorrect recommendation',H5:'Human review',I5:'Review warning',J5:'PRIVACY',K5:'PRIVACY'};
 cells['مكتبة ضوابط المعالجة']={A2:'privacy',B2:'DEMO ONLY — human oversight',C2:'synthetic-demo:no-official-source-acceptance',D2:'Synthetic access control',E2:'Independent review',F2:'Synthetic policy illustration'};
 cells['حالات استخدام الذكاء الاصطناعي']={A5:'AI-001',B5:'DEMO ONLY',C5:'Synthetic source preparation',D5:'Illustrative source row requiring independent review',E5:'OPERATIONS',F5:'Demo owner',H5:'ML',I5:'PILOT',J5:'Synthetic demonstration',K5:'Synthetic data',L5:'Generated fixture',M5:'YES',N5:'NO',O5:'NO',P5:'NO',Q5:'ASSISTED',R5:'REQUIRED',U5:0,W5:'ACTIVE',AC5:'نعم'};
 }else cells['تقييم تبنى حالة الإستخدام']={A5:'AI-001',C5:3,D5:3,E5:3,F5:3,G5:3,H5:3,I5:3,J5:'محدودة',K5:'LIMITED',M5:'2026-01-01'};
 if(['v2','v3'].includes(version)&&source==='risk'){
  for(const [row,ref]of [[69,'AIRL-065'],[70,'AIRL-066']])for(const [address,value]of Object.entries({...cells['مكتبة المخاطر'],A5:ref,C5:'سيناريو اختبار اصطناعي '+ref}))cells['مكتبة المخاطر'][address.replace('5',String(row))]=value;
  cells['سجل المخاطر']={A5:'AIR-001',B5:'AI-001',D5:'PRIVACY',E5:'PRIVACY',F5:'SYNTHETIC engineering risk',G5:'PILOT',H5:'Generated scenario; no organization data',I5:'Generated cause',J5:'Generated event',K5:'Generated effect',L5:'Human review',M5:'PARTIAL',N5:4,O5:4,P5:{value:16,formula:'N5*O5'},Q5:'كارثي',R5:'MITIGATE',T5:'Demo owner',U5:'Demo owner',V5:'2026-01-01',W5:'2026-08-01',Y5:{value:0.6,percent:true},Z5:2,AA5:1,AB5:{value:2,formula:'Z5*AA5'},AC5:'منخفض',AH5:'نعم',AJ5:'INTERNAL',AK5:'UNINTENDED',AL5:'CURRENT'};
  cells['تقييم الأثر']={A5:'AIR-001',C5:4,D5:4,E5:4,F5:4,G5:4,H5:4,I5:4,J5:4,K5:4,L5:'privacy',M5:'Synthetic competent-assessor scenario requiring fresh native review',N5:'نعم'};
  cells['خطة المعالجة']={A5:'ACT-001',B5:'AIR-001',D5:'Synthetic action requiring a native approved plan',E5:'PREVENTIVE',F5:'HIGH',G5:'Demo owner',H5:'2026-01-01',I5:'2026-08-01',J5:'IN_PROGRESS',K5:{value:0.6,percent:true},Q5:'نعم'};
  cells['حالات استخدام الذكاء الاصطناعي'].U5=1;
 }
 if(version==='v3'&&source==='risk'){
  const library=Object.fromEntries(Object.entries(cells['مكتبة المخاطر']).filter(([address])=>address.endsWith('5')));
  for(let index=1;index<66;index++)for(const [address,value]of Object.entries(library))cells['مكتبة المخاطر'][address.replace(/5$/,String(index+5))]=address==='A5'?'AIRL-'+String(index+1).padStart(3,'0'):address==='C5'?'سيناريو اختبار اصطناعي '+String(index+1):value;
  const controls={...cells['مكتبة ضوابط المعالجة']};
  for(let index=1;index<10;index++)for(const [address,value]of Object.entries(controls))cells['مكتبة ضوابط المعالجة'][address.replace(/2$/,String(index+2))]=address==='B2'?'DEMO ONLY — synthetic control '+String(index+1):value;
  cells['حالات استخدام الذكاء الاصطناعي'].V5='كارثي';
 }
 const parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>','xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((name,i)=>`<sheet name="${escape(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships>'+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml"/>`).join('')+'</Relationships>'};
 if(['v2','v3'].includes(version))parts['xl/styles.xml']='<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="9"/></cellXfs></styleSheet>';
 sheets.forEach((name,i)=>{const grouped={};for(const [address,value]of Object.entries(cells[name]??{})){const row=address.match(/\d+$/)[0];(grouped[row]??=[]).push(value&&typeof value==='object'?`<c r="${address}"${value.percent?' s="1"':''}>${value.formula?`<f>${escape(value.formula)}</f>`:''}<v>${value.value}</v></c>`:typeof value==='number'?`<c r="${address}"><v>${value}</v></c>`:`<c r="${address}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`);}parts[`xl/worksheets/sheet${i+1}.xml`]='<worksheet><sheetData>'+Object.entries(grouped).map(([row,values])=>`<row r="${row}">${values.join('')}</row>`).join('')+'</sheetData></worksheet>';});return archive(parts);
}
export function syntheticFixtureManifest(version='v1'){
 if(!['v1','v2','v3'].includes(version))throw new Error('Unknown committed source version');
 const directory=fixtureDirectory(version),manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
 if(manifest.manifestVersion!==1||manifest.fixtureVersion!==`synthetic-sources-${version}`||manifest.demoOnly!==true||manifest.sourceMode!=='synthetic_demo'||manifest.productionReady!==false||!Array.isArray(manifest.sources)||manifest.sources.length!==2||new Set(manifest.sources.map(s=>s.source)).size!==2)throw new Error('Committed synthetic source manifest is invalid');
 for(const source of manifest.sources){if(!['risk','adoption'].includes(source.source)||source.file!==`demo-${source.source}-${version}.xlsx`||!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('Committed source identifier or checksum is invalid');const pinned=createHash('sha256').update(readFileSync(join(directory,source.file))).digest('hex'),generated=createHash('sha256').update(syntheticWorkbook(source.source,version)).digest('hex');if(pinned!==source.sha256||generated!==source.sha256)throw new Error('Committed synthetic source bytes or generator differ from their pinned manifest. Publish a new fixture version instead of changing this one.');}
 return manifest;
}
export function installSyntheticSources(directory,version='v1'){
 const manifest=syntheticFixtureManifest(version);mkdirSync(directory,{recursive:true});
 for(const source of manifest.sources){const target=join(directory,source.file);if(existsSync(target)&&createHash('sha256').update(readFileSync(target)).digest('hex')!==source.sha256)throw new Error('Synthetic source fixture differs; preserve it and use a new installation.');if(!existsSync(target))writeFileSync(target,readFileSync(join(fixtureDirectory(version),source.file)));}
 const target=join(directory,'manifest.json'),body=JSON.stringify(manifest,null,2)+'\n';if(existsSync(target)&&readFileSync(target,'utf8')!==body)throw new Error('Installed source manifest differs; preserve it and use a new installation.');if(!existsSync(target))writeFileSync(target,body);return manifest;
}
