import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseMigrationWorkbook } from '../src/ai-governance/ai-migration-workbook';
// Tiny stored OOXML archives exercise the real parser and its ZIP checksum checks.
function crc(b:Buffer){let n=0xffffffff;for(const byte of b){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0)}return(n^0xffffffff)>>>0;}
function workbook(cell='<c r="A1" t="b"><v>1</v></c>',sheets='<sheet name="Data" sheetId="1" r:id="r1"/>',relations='<Relationship Id="r1" Target="worksheets/sheet1.xml"/>',names=''){
 const parts={'xl/workbook.xml':`<workbook><sheets>${sheets}</sheets><definedNames>${names}</definedNames></workbook>`,'xl/_rels/workbook.xml.rels':`<Relationships>${relations}</Relationships>`,'xl/worksheets/sheet1.xml':`<worksheet><sheetData><row r="1">${cell}</row></sheetData></worksheet>`},locals:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [file,xml]of Object.entries(parts)){const name=Buffer.from(file),body=Buffer.from(xml),l=Buffer.alloc(30),c=Buffer.alloc(46),checksum=crc(body);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt32LE(checksum,14);l.writeUInt32LE(body.length,18);l.writeUInt32LE(body.length,22);l.writeUInt16LE(name.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(checksum,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);locals.push(l,name,body);central.push(c,name);offset+=l.length+name.length+body.length;}
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(3,8);end.writeUInt16LE(3,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
const bytes=workbook();assert.equal(parseMigrationWorkbook(bytes,'synthetic_demo',createHash('sha256').update(bytes).digest('hex')).sheets[0].cells.A1.value,true);
assert.equal(parseMigrationWorkbook(workbook('<c r="A1" t="b"><v>0</v></c>'),'synthetic_demo').sheets[0].cells.A1.value,false);
assert.throws(()=>parseMigrationWorkbook(workbook('<c r="A1" t="b"><v>2</v></c>'),'synthetic_demo'),/boolean/);
assert.throws(()=>parseMigrationWorkbook(workbook(undefined,'<sheet name="Data" r:id="r1"/><sheet name="data" r:id="r1"/>'),'synthetic_demo'),/ambiguous/);
assert.throws(()=>parseMigrationWorkbook(workbook(undefined,undefined,'<Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r1" Target="other.xml"/>'),'synthetic_demo'),/ambiguous/);
assert.throws(()=>parseMigrationWorkbook(workbook(undefined,undefined,undefined,'<definedName name="Empty"></definedName><definedName name="Empty">Data!A1</definedName>'),'synthetic_demo'),/ambiguous/);
const formula=parseMigrationWorkbook(workbook('<c r="A1"><f>WEBSERVICE("https://invalid.example")</f><v>0.125</v></c>'),'synthetic_demo').sheets[0].cells.A1;
assert.equal(formula.numericText,'0.125');assert.equal(formula.value,0.125);assert.match(formula.formula!,/WEBSERVICE/);
assert.throws(()=>parseMigrationWorkbook(bytes,'synthetic_demo','0'.repeat(64)),/checksum/);
const corrupt=Buffer.from(bytes);corrupt[60]^=1;assert.throws(()=>parseMigrationWorkbook(corrupt,'synthetic_demo'),/checksum|XML/);
assert.throws(()=>parseMigrationWorkbook(workbook('<c r="A1"><v>1</v></c><c r="A1"><v>2</v></c>'),'synthetic_demo'),/limits/);
console.log('AI source parser: 10 boundary, ambiguity, checksum and raw/formula scenarios passed');
