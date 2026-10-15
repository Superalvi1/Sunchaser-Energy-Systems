import { readFile, realpath, stat, open } from 'node:fs/promises';
import path from 'node:path';

const sizes = new Set([6,8,10,12,15,20]);
const urduNumerals = '۰۱۲۳۴۵۶۷۸۹';
function normalized(s='') {
  return String(s).replace(/[۰-۹]/g, x=>String(urduNumerals.indexOf(x))).replace(/[٠-٩]/g,x=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).toLowerCase();
}
export function classifyRequest(text) {
  const s=normalized(text);
  const quoteIntent=/\b(quotations?|quotes?|qoutation|estimate|package|price|pricing|rate|rates|cost|qutation)\b|کوٹیشن|قیمت|ریٹ|کتنے\s*کا|kitne|qeemat|quotation bhej|quote bhej/i.test(s);
  const custom=/(custom|personalized|customized|own requirement|special|site survey|mix|my own|اپنی مرضی|custom quote|mere ghar|mera ghar|different battery|changeover|backup circuits|solis|goodwe|itel|dyness|soluna|growatt|jinko|aiko|canadian|three.?phase|3.?phase|single.?phase|2 meters|two meters|dual meter|split loads|kwh|kw[h][r]?)/i.test(s);
  const watts=[];
  // Trailing boundary is Unicode-aware: \b fails after Arabic-script units
  // (e.g. "10 کلو واٹ") because \b only sees ASCII word chars.
  const unitEnd='(?![0-9A-Za-z_\\u0600-\\u06FF])';
  const rx=new RegExp('\\b(6|8|10|12|15|20)\\s*(?:k\\s*w|kilowatt|kilo\\s*watt|kilowatts|کے\\s*ڈبلیو|کلو\\s*واٹ|kwp)'+unitEnd,'gi');
  for(const x of s.matchAll(rx)) watts.push(Number(x[1]));
  const englishWords=[['six',6],['eight',8],['ten',10],['twelve',12],['fifteen',15],['twenty',20]];
  for(const [w,n] of englishWords) if(new RegExp('\\b'+w+'\\s*(?:kilowatt|k\\s*w)\\b','i').test(s))watts.push(n);
  const wordSizes=[['چھ',6],['آٹھ',8],['دس',10],['بارہ',12],['پندرہ',15],['بیس',20]];
  for(const [word,n] of wordSizes) if(s.includes(word+' کلو')) watts.push(n);
  const found=[...new Set(watts.filter(x=>sizes.has(x)))];
  const hybrid=/\bhybrid\b|ہائبرڈ|battery backup|with battery/i.test(s);
  const ongrid=/\bon[ -]?grid\b|آن[ -]?گرڈ|without battery|net.?meter/i.test(s);
  const offgrid=/\boff[ -]?grid\b|آف[ -]?گرڈ/i.test(s);
  return {quoteIntent, custom, sizes:found, type:offgrid?'off_grid':hybrid&&!ongrid?'hybrid':ongrid&&!hybrid?'on_grid':null, ambiguous:hybrid&&ongrid};
}
export async function loadApprovedQuotes(baseDir, registryPath, now=Date.now()) {
  const dir=await realpath(baseDir);
  let manifest;
  try {manifest=JSON.parse(await readFile(registryPath,'utf8'))} catch(e){if(e.code==='ENOENT') return []; throw e;}
  if(!Array.isArray(manifest)) throw new Error('Invalid quotation registry');
  const approved=[];
  for(const entry of manifest){
    if(entry.approved!==true || !sizes.has(entry.capacityKw) || !['on_grid','hybrid','off_grid'].includes(entry.systemType) || !Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt)<=now)continue;
    if(typeof entry.id!=='string'||!entry.id||typeof entry.fileName!=='string'||!/^[-_a-zA-Z0-9.]+\.pdf$/i.test(entry.fileName))continue;
    let full;
    try{full=await realpath(path.join(dir,entry.fileName)); const st=await stat(full); if(!st.isFile()||st.size>20*1024*1024||st.size<8)continue; const fd=await open(full,'r');try{const header=Buffer.alloc(5);await fd.read(header,0,5,0);if(header.toString()!=='%PDF-')continue;}finally{await fd.close();}}catch{continue;}
    if(path.dirname(full)!==dir)continue;
    approved.push({...entry,fullPath:full});
  }
  return approved;
}
export function matchApproved(quotes, size, type){
  const matching=quotes.filter(q=>q.capacityKw===size&&(type===null||q.systemType===type));
  if(type===null && new Set(matching.map(x=>x.systemType)).size>1)return {status:'clarify_type'};
  if(matching.length!==1)return {status: matching.length ? 'ambiguous_revision':'missing'};
  return {status:'ok',quote:matching[0]};
}
export function shouldHandoff(text){return /\b(human|representative|complaint|refund|wrong quote|legal|fraud|warranty claim|technician|fault|refund)\b|شکایت|بندہ\s*بات|انسان\s*بات/i.test(text)}

/**
 * Deterministic FAQ matcher over the reviewed faqs.json.
 * Scores keyword overlap between the message and each FAQ's keywords/question;
 * returns the best FAQ only when the score clears a conservative threshold.
 * Anything uncertain returns null → the agent hands off instead of guessing.
 */
const STOP = new Set(("a,an,the,ka,ki,ke,ko,se,mein,me,par,aur,or,hai,hain,ho,kya,kya,kaun,kab,kahan,kaisay,kaise,please,batain,batayein,dein,den,kar,karen,karein,kiya,tha,thi,thy,ap,aap,apka,aapka,mujhe,mera,meri,hamari,hamara,to,for,of,in,on,is,are,do,does,what,which,when,where,how,much,many,your,you,we,our,this,that,with,from,system,ka,kay").split(","));
function tokens(s){
  return String(s||"").toLowerCase().replace(/[۰-۹]/g,x=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(x))).split(/[^a-z0-9\u0600-\u06FF]+/).filter(w=>w.length>2&&!STOP.has(w));
}
export function matchFaq(text, faqs){
  if(!Array.isArray(faqs)||!faqs.length) return null;
  const words=new Set(tokens(text));
  if(!words.size) return null;
  let best=null,bestScore=0;
  for(const f of faqs){
    if(!f||typeof f.id!=="string"||typeof f.answer!=="string"||!f.answer||f.answer.length>1500) continue;
    const keys=new Set([...tokens(f.question),...tokens(f.keywords),...tokens(f.id.replace(/_/g," "))]);
    if(!keys.size) continue;
    let score=0;
    for(const w of words) if(keys.has(w)) score+=1;
    // Explicit question echo is a strong signal.
    if(f.question&&String(text).toLowerCase().includes(String(f.question).toLowerCase().slice(0,24))) score+=2;
    if(score>bestScore){bestScore=score;best=f;}
  }
  return bestScore>=2?best:null;
}
