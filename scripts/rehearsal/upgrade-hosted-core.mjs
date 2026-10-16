import {spawnSync} from "node:child_process";
if(process.env.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||process.env.PGHOST!=="rehearsal-postgres.railway.internal"||process.env.PGDATABASE!=="sunchaser_rehearsal")throw new Error("Wrong target");
for(const args of [["scripts/migrations/run.mjs","apply","--yes","--allow-remote"],["scripts/migrations/run.mjs","verify","--allow-remote"],["scripts/rehearsal/run-hosted-core.mjs"]]){
 const r=spawnSync(process.execPath,args,{stdio:"inherit",env:process.env});if(r.status!==0)process.exit(r.status??1);
}
