'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{restore}=require('./restore.cjs');
test('restore rejects remote connections before touching a database or files',()=>{
  for(const host of ['remote.example','192.168.1.10',''])assert.throws(()=>restore('unused','dgop_restore_demo','unused',{PGHOST:host}),/loopback/);
});
test('restore rejects indirect connection overrides before touching a database or files',()=>{
  for(const name of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])assert.throws(()=>restore('unused','dgop_restore_demo','unused',{PGHOST:'127.0.0.1',[name]:'unsafe'}),/indirect connection overrides/);
});
test('restore rejects names outside its dedicated fresh database namespace',()=>{
  for(const target of ['dgop_dev','dgop_access_sync_qa_20261007','dgop_restore_','dgop_restore_bad;DROP'])assert.throws(()=>restore('unused',target,'unused',{PGHOST:'127.0.0.1'}),/fresh dgop_restore/);
});
