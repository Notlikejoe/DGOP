import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
function ordered(v:unknown):unknown {if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)]));return v;}
export const governanceDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
export function governanceText(v:unknown){if(typeof v!=='string'||!v.trim()||v.length>5000)throw new BadRequestException('Written justification is required');return v.trim();}
export async function governanceEvidence(tx:Prisma.TransactionClient,v:unknown){if(!Array.isArray(v)||v.length<1||v.length>20||v.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)))throw new BadRequestException('Use existing DGOP evidence identifiers');const ids=[...new Set(v as string[])];if(await tx.ndiEvidence.count({where:{id:{in:ids},deletedAt:null}})!==ids.length)throw new BadRequestException('Every evidence identifier must exist');return ids;}
export async function governanceTransaction<T>(db:PrismaService,work:(tx:Prisma.TransactionClient)=>Promise<T>){for(let n=0;;n++){try{return await db.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000,maxWait:15000});}catch(e){if(n>=2||!(e instanceof Prisma.PrismaClientKnownRequestError)||!['P2034','P2002'].includes(e.code))throw e;}}}
