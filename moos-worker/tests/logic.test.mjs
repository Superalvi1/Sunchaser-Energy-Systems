import {test} from 'node:test';import assert from 'node:assert/strict';
import {classifyRequest,matchApproved,matchFaq,shouldHandoff} from '../src/logic.mjs';
test('6 and 10 kW explicit requests',()=>{const x=classifyRequest('Please send 6kW and 10 kW quotations');assert.deepEqual(x.sizes,[6,10]);assert.equal(x.quoteIntent,true)});
test('Roman Urdu and hybrid',()=>{const x=classifyRequest('10 kilowatt hybrid price bhej den');assert.equal(x.type,'hybrid');assert.deepEqual(x.sizes,[10])});
test('no invented sizing for generic quote',()=>assert.deepEqual(classifyRequest('Send me a quotation').sizes,[]));
test('requires type clarification',()=>assert.equal(matchApproved([{capacityKw:6,systemType:'hybrid'},{capacityKw:6,systemType:'on_grid'}],6,null).status,'clarify_type'));
test('handles human request',()=>assert.equal(shouldHandoff('I want a human representative'),true));
test('specific battery storage request is custom, standard hybrid not necessarily custom',()=>{assert.equal(classifyRequest('10kW hybrid 16kWh battery quote').custom,true);assert.equal(classifyRequest('10kW hybrid quotation').custom,false)});
test('Urdu 6 kilowatt understood',()=>assert.deepEqual(classifyRequest('چھ کلو واٹ کی قیمت').sizes,[6]));
test('matchFaq matches a reviewed FAQ on keywords',()=>{
 const faqs=[{id:'net_metering',question:'Net metering kya hai?',keywords:'net metering wapda bill export units',answer:'Net metering ke zariye ap bijli wapda ko wapas bech sakte hain.'}];
 const f=matchFaq('net metering kya hai bhai',faqs);
 assert.equal(f&&f.id,'net_metering');
});
test('matchFaq returns null when uncertain or unreviewed',()=>{
 assert.equal(matchFaq('hello there',{ }&&[]),null);
 const faqs=[{id:'x',question:'Service area?',keywords:'cities serve',answer:'Lahore.'}];
 assert.equal(matchFaq('what is the price of 10kw',faqs),null);
});
test('matchFaq rejects overlong answers',()=>{
 const faqs=[{id:'x',question:'Service area cities serve',keywords:'cities serve area',answer:'y'.repeat(2000)}];
 assert.equal(matchFaq('which cities do you serve',faqs),null);
});
