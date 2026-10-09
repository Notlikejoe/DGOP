'use strict';
const crypto=require('node:crypto'),path=require('node:path'),assert=require('node:assert/strict');
const MAGIC=Buffer.from('DGOPDB01'),sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
function encrypt(bytes,key,aad){assert.equal(key.length,32);const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const data=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),data]);}
function decrypt(bytes,key,aad){assert.equal(key.length,32);assert(bytes.length>=36&&bytes.subarray(0,8).equals(MAGIC),'Unsupported encrypted snapshot');const cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));cipher.setAuthTag(bytes.subarray(20,36));cipher.setAAD(Buffer.from(aad));return Buffer.concat([cipher.update(bytes.subarray(36)),cipher.final()]);}
function inside(root,name){assert(typeof name==='string'&&name.length>0&&!/[\\:\x00-\x1f]/.test(name)&&!path.posix.isAbsolute(name),'Unsafe archive path');const parts=name.split('/');assert(parts.every(p=>p&&p!=='.'&&p!=='..'),'Unsafe archive path');const target=path.resolve(root,...parts);assert(target.startsWith(path.resolve(root)+path.sep),'Archive path escapes destination');return target;}
module.exports={encrypt,decrypt,inside,sha256};
