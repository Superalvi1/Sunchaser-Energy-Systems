import assert from "node:assert/strict";
import {test} from "node:test";
import {validateAgentDecision} from "./agentProvider.ts";
test("AI text cannot supply invented monetary prices, guarantees or external URLs",()=>{for(const text of ["PKR 950000","900,000 total","10 lakh","10 لاکھ روپے","https://wrong.example/quote","Guaranteed savings"]){assert.equal(validateAgentDecision({action:"reply",text}).action,"handoff",text);}});
test("supported text preserves customer language and valid tool requests",()=>{assert.equal(validateAgentDecision({action:"clarify",text:"Aap ka shehar aur system size kya hai?"}).action,"clarify");assert.equal(validateAgentDecision({action:"share_quotation",text:"Here is the 10 kW package.",quotationId:"approved-1"}).quotationId,"approved-1");assert.throws(()=>validateAgentDecision({action:"arbitrary_tool",text:""}));assert.throws(()=>validateAgentDecision(null));});
