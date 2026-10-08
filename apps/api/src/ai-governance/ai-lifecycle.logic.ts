export const AI_LIFECYCLE_ACTIONS=['change','suspend','resume','retire'] as const;
export type AiLifecycleAction=typeof AI_LIFECYCLE_ACTIONS[number];
export type AiLifecycleState='active'|'suspended'|'retired';
export function lifecycleTransition(state:string,action:string):AiLifecycleState {
 if(state==='retired')throw new Error('Retired AI use cases preserve history and cannot be resumed or changed');
 if(action==='change'&&['active','suspended'].includes(state))return state as AiLifecycleState;
 if(action==='suspend'&&state==='active')return 'suspended';
 if(action==='resume'&&state==='suspended')return 'active';
 if(action==='retire'&&['active','suspended'].includes(state))return 'retired';
 throw new Error('The lifecycle action is invalid for the current state');
}
const level:Record<string,number>={MINIMAL:1,LIMITED:2,HIGH:3,UNACCEPTABLE:4};
export function lifecycleTier(previous:string,proposed:string,riskSeverities:readonly string[]=[]){
 if(!level[previous]||!level[proposed])throw new Error('A trusted registered classification is required');
 const risk=riskSeverities.includes('P1')?'UNACCEPTABLE':riskSeverities.includes('P2')?'HIGH':riskSeverities.includes('P3')?'LIMITED':'MINIMAL';
 return [previous,proposed,risk].sort((a,b)=>level[b]-level[a])[0];
}
export function independentLifecycleActor(actor:string,requester:string,owner:string|null,proposer:string,contributors:readonly string[]=[],authority?:string){return ![requester,owner,proposer,...contributors,authority].includes(actor);}
export const operationalUseAllowed=(lifecycle:string,status:string|null)=>lifecycle==='active'&&!['SUSPENDED','ARCHIVED'].includes(status??'');
