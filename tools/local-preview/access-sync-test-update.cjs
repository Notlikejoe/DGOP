const fs=require('node:fs');const root='C:/Users/Youss/Documents/Codex/work/dgop-access-sync/source';
const file=root+'/apps/api/test/auth.service.spec.ts';let s=fs.readFileSync(file,'utf8');
s=s.replace("test('logout increments the user token version and writes an audit event', async () => {", "test('logout increments the user token version and writes an audit event', async () => {\n  const row = await userRow();");
s=s.replaceAll('deps.scope as never,','deps.scope as never,\n    profileDb(row) as never,');
s=s.replace("    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,", "    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,\n    profileDb(row) as never,");
s=s.replace('const profileDeps = () => ({',"const profileDb = (row: unknown) => ({ $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: { findUnique: async () => row }, rolePermission: { findMany: async () => [] } }) });\n\nconst profileDeps = () => ({");
fs.writeFileSync(file,s);
