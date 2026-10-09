const session=require('./population-session.cjs');
(async()=>{const s=await session(4,process.argv.includes('--prepare')?'prepare':'install');try{await s.groups([
 ['AI permissions, owners and governed references',()=>require('./population-ai-foundations.cjs')(s)],
 ['Three completed AI journeys and six pending queues',()=>require('./population-ai-journeys.cjs')(s)],
 ...(process.argv.includes('--prepare')?[]:[['AI review history and reporting',()=>require('./population-ai-reporting.cjs')(s)],['AI source preparation and reconciliation',()=>require('./population-ai-sources.cjs')(s)]]),
]);}finally{await s.finish();}})().catch(e=>{console.error(e.message);process.exitCode=1});
