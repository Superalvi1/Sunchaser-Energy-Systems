import {test} from "node:test";
import assert from "node:assert/strict";
import {GrokReplyClient,parseGrokDecision,redactCustomerText} from "../src/grokClient.mjs";

function provider(action,reply,reason="general") {
  return {status:"completed",output:[{type:"message",role:"assistant",content:[
    {type:"output_text",text:JSON.stringify({action,reply,reason})}
  ]}]};
}
test("disabled and missing API key never make external requests",async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;throw Error("not expected");};
  assert.equal(await new GrokReplyClient({},fetcher).respond("hi"),null);
  assert.equal(await new GrokReplyClient({MUSE_GROK_ENABLED:"true"},fetcher).respond("hi"),null);
  assert.equal(calls,0);
});
test("configured Grok sends only bounded redacted text, store:false and no tools",async()=>{
  let req;
  const fetcher=async(url,opts)=>{req={url,opts};return {ok:true,json:async()=>provider("reply","On-grid solar mainly offsets your grid electricity use.")};};
  const c=new GrokReplyClient({MUSE_GROK_ENABLED:"true",XAI_API_KEY:"dummy-test-key",XAI_MODEL:"grok-4.3"},fetcher);
  const out=await c.respond("What is on-grid? Contact me 03301234567 at ali@example.com.",[
    {role:"customer",text:"My number is +923001234567"},
    {role:"customer",text:"My number is +923001234567"}]);
  assert.equal(out.action,"reply");
  assert.equal(req.url,"https://api.x.ai/v1/responses");
  assert.equal(req.opts.headers.Authorization,"Bearer dummy-test-key");
  const payload=JSON.parse(req.opts.body);
  assert.equal(payload.store,false);
  assert.equal(payload.stream,false);
  assert.equal(payload.model,"grok-4.3");
  assert.equal(payload.reasoning.effort,"none");
  assert.equal(payload.tools,undefined);
  assert.equal(payload.text.format.type,"json_schema");
  const body=JSON.stringify(payload);
  assert.equal(body.includes("03301234567"),false);
  assert.equal(body.includes("ali@example.com"),false);
  assert.equal(body.includes("+923001234567"),false);
});
test("human request is an explicit handoff",async()=>{
  const f=async()=>({ok:true,json:async()=>provider("handoff","","requires staff")});
  const r=await new GrokReplyClient({MUSE_GROK_ENABLED:"true",XAI_API_KEY:"test"},f).respond("Please call me");
  assert.equal(r.action,"handoff");assert.equal(r.reply,"");
});
test("unsafe prices, URLs, malformed JSON, truncated and provider failures fail closed",async()=>{
  assert.equal(parseGrokDecision(provider("reply","10kW is PKR 900000")),null);
  assert.equal(parseGrokDecision(provider("reply","Click https://scam.example")),null);
  assert.equal(parseGrokDecision({status:"incomplete",output:[]}),null);
  assert.equal(parseGrokDecision({status:"completed",output:[]}),null);
  assert.equal(parseGrokDecision(provider("reply","")),null);
  const c=new GrokReplyClient({MUSE_GROK_ENABLED:"true",XAI_API_KEY:"test"},async()=>({ok:false,status:401}));
  assert.equal(await c.respond("Hi"),null);
});
test("untested model slugs fail closed before network call",async()=>{
  let calls=0;
  const c=new GrokReplyClient({MUSE_GROK_ENABLED:"true",XAI_API_KEY:"key",XAI_MODEL:"grok-4.7"},async()=>{calls++;return {ok:true};});
  assert.equal(await c.respond("hello"),null);
  assert.equal(calls,0);
});
test("PII censoring also bounds history content",()=>{
  assert.equal(redactCustomerText("My email ali@example.com and phone 03218486752").includes("03218486752"),false);
  assert.equal(redactCustomerText("x".repeat(900)).length,700);
});

test('strict parsing rejects extra fields, long reasons and numerical commercial claims in any script', () => {
  for (const reply of ['Our system saves 80 percent.', 'قیمت ۹۰۰۰۰۰ روپے ہے', 'The price is $900.', 'Our warranty covers this.']) {
    assert.equal(parseGrokDecision(provider('reply', reply)), null);
  }
  assert.equal(parseGrokDecision(provider('reply', 'Solar uses sunlight.', 'x'.repeat(91))), null);
  const extra = provider('reply', 'Solar uses sunlight.');
  extra.output[0].content[0].text = JSON.stringify({action:'reply',reply:'Solar uses sunlight.',reason:'general',tool:'send_pdf'});
  assert.equal(parseGrokDecision(extra), null);
});
