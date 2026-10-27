/** Unit data repository only. PostgreSQL acceptance uses the real departmental accounts. */
export function fixtureRole(code:string,permissions:string[]=[]){return {id:'role-'+code,code,businessRoleCode:null,businessRole:null,
  isActive:true,deletedAt:null,isSystem:code==='system_admin',maxClassificationRank:code==='system_admin'?null:2,
  dataScopes:code==='system_admin'?[]:[{scopeType:'org_unit',refId:'finance-fixture',includeDescendants:true}],
  permissions:permissions.map(code=>{const at=code.lastIndexOf('.');return {permission:{resource:code.slice(0,at),action:code.slice(at+1)}};})};}
function matches(row:any,where:any):boolean{
  if(where===null||typeof where!=='object')return row===where;
  if('is'in where)return matches(row,where.is);
  if('in'in where&&!where.in.includes(row))return false;
  if('notIn'in where&&where.notIn.includes(row))return false;
  if('not'in where&&matches(row,where.not))return false;
  for(const [key,value] of Object.entries(where)){
    if(['in','notIn','not'].includes(key))continue;
    if(key==='AND'){if(!(Array.isArray(value)?value:[value]).every(w=>matches(row,w)))return false;}
    else if(key==='OR'){if(!(value as any[]).some(w=>matches(row,w)))return false;}
    else if(key==='some'){if(!Array.isArray(row)||!row.some(r=>matches(r,value)))return false;}
    else if(!matches(row?.[key],value))return false;
  }return true;
}
export function liveRoleFixture(rows:any[]|(()=>any[])){
  const find=(args:any)=>(typeof rows==='function'?rows():rows).filter(row=>matches(row,args?.where??{})).map(row=>structuredClone(row));
  return {findMany:async(args:any)=>find(args),findFirst:async(args:any)=>find(args)[0]??null,count:async(args:any)=>find(args).length};
}
/** Preserve unrelated role lookups while supplying explicit business grant queries. */
export function withLiveRoleFixture<T extends {role?:any}>(client:T,extension:{role:ReturnType<typeof liveRoleFixture>}):T {
  client.role={...extension.role,...client.role,findMany:extension.role.findMany};return client;
}
export function fixtureQueryCodes(where:any):string[]{
  if(!where||typeof where!=='object')return [];
  const own=typeof where.code==='string'?[where.code]:where.code?.in??[];
  return [...new Set([...own,...Object.values(where).flatMap(value=>Array.isArray(value)?value.flatMap(fixtureQueryCodes):fixtureQueryCodes(value))])];
}
