import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
const requests=new AsyncLocalStorage<Request>();
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
 use(req:Request,_res:Response,next:NextFunction){requests.run(req,next);}
}
export function nativeAuditContext(action:string) {
 if(!/^(ai\.|aiuc\.|airs\.)/.test(action))return {};
 const req=requests.getStore();
 if(!req)return {actorOrigin:'background_or_internal'};
 const user=(req as Request&{user?:{id?:string}}).user;
 return {actorOrigin:'http',clientIp:req.ip??req.socket.remoteAddress??null,requestMethod:req.method,requestPath:req.path,authenticatedActorId:user?.id??null};
}
