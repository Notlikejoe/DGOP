import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiSourceNativeService } from '../src/ai-governance/ai-source-native.service';
import { governanceDigest } from '../src/ai-governance/ai-governance-ledger';
const userId=randomUUID(),snapshotId=randomUUID(),evidenceIds=[randomUUID()],dto={requestKey:randomUUID(),rowKey:'synthetic:case',expectedDigest:'a'.repeat(64),justification:'Existing native draft replay',evidenceIds};
const existing={id:randomUUID(),snapshotId,requestKey:dto.requestKey,requestDigest:governanceDigest({userId,snapshotId,rowKey:dto.rowKey,useCaseId:null,justification:dto.justification,evidenceIds,expectedDigest:dto.expectedDigest})};
let freshCalls=0,authorizeCalls=0;const tx:any={ndiEvidence:{count:async()=>1},aiSourceNativeDraft:{findUnique:async()=>existing}},db:any={$transaction:async(work:any)=>work(tx)};
const corrections:any={approvedSnapshot:async()=>{freshCalls++;throw Error('diagnostic changed source files')},replaySnapshot:async()=>{authorizeCalls++;return {digest:dto.expectedDigest}}};
const native=new AiSourceNativeService(db,corrections,{} as any,{} as any,{} as any);
async function main(){const result=await native.create(userId,snapshotId,dto);assert.equal(result.id,existing.id);assert.equal(result.created,false);assert.equal(freshCalls,0);assert.equal(authorizeCalls,1);await assert.rejects(native.create(userId,snapshotId,{...dto,justification:'different intent'}),/another request/);await assert.rejects(native.create(userId,snapshotId,{...dto,expectedDigest:'b'.repeat(64)}),/snapshot changed/);corrections.replaySnapshot=async()=>{throw Error('diagnostic revoked authority')};await assert.rejects(native.create(userId,snapshotId,dto),/revoked authority/);console.log('Native source replay: stable result, intent conflict, digest and current authority checks passed');}
void main();
