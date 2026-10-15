import pg from 'pg';
const {Pool}=pg;
export class Store{
 constructor(url){this.pool=new Pool({connectionString:url,max:5,connectionTimeoutMillis:5000,options:'-c search_path=moos_worker,public'});}
 async close(){await this.pool.end()}
 async query(sql,params=[]){return this.pool.query(sql,params)}
 async add(event){
  const c=await this.pool.connect();
  try{await c.query('BEGIN');
   // Lock customer row to serialise per-conversation inbound state.
   await c.query(`INSERT INTO wa_chat(phone,latest_message_id,last_inbound_at) VALUES($1,$2,to_timestamp($3 / 1000.0)) ON CONFLICT(phone) DO UPDATE SET latest_message_id=CASE WHEN excluded.last_inbound_at >= wa_chat.last_inbound_at THEN excluded.latest_message_id ELSE wa_chat.latest_message_id END,last_inbound_at=GREATEST(wa_chat.last_inbound_at,excluded.last_inbound_at),updated_at=now()`,[event.phone,event.messageId,event.sentAt]);
   await c.query(`INSERT INTO wa_inbound(message_id,phone,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,[event.messageId,event.phone,JSON.stringify(event)]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 async claim(){
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const r=await c.query(`SELECT message_id,phone,payload FROM wa_inbound WHERE state='queued' ORDER BY received_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`);
   if(!r.rows.length){await c.query('COMMIT');return null;}
   await c.query(`UPDATE wa_inbound SET state='processing' WHERE message_id=$1`,[r.rows[0].message_id]);await c.query('COMMIT');return r.rows[0];
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 async pending(phone){const r=await this.query(`SELECT pending_quote FROM wa_chat WHERE phone=$1`,[phone]);const p=r.rows[0]?.pending_quote;return p&&p.expiresAt>Date.now()?p:null;}
 async setPending(phone,pending){await this.query(`UPDATE wa_chat SET pending_quote=$2::jsonb WHERE phone=$1`,[phone,pending?JSON.stringify(pending):null]);}
 async preflight(msg){const r=await this.query(`SELECT human_owned,latest_message_id,last_inbound_at FROM wa_chat WHERE phone=$1`,[msg.phone]);return Boolean(r.rows.length&&!r.rows[0].human_owned&&r.rows[0].latest_message_id===msg.messageId&&Date.now()-new Date(r.rows[0].last_inbound_at).getTime()<24*3600*1000)}
 async reserve(key,msg,kind){const r=await this.query(`INSERT INTO wa_outbound(send_key,message_id,phone,kind,state) VALUES($1,$2,$3,$4,'attempted') ON CONFLICT DO NOTHING RETURNING send_key`,[key,msg.messageId,msg.phone,kind]);return r.rowCount===1}
 async sent(key,result){await this.query(`UPDATE wa_outbound SET state='accepted',provider_message_id=$2 WHERE send_key=$1`,[key,result?.messages?.[0]?.id||'']);}
 async unknown(key){await this.query(`UPDATE wa_outbound SET state='outcome_unknown' WHERE send_key=$1`,[key])}
 async shadow(key){await this.query(`UPDATE wa_outbound SET state='shadow_skipped' WHERE send_key=$1`,[key])}
 async finish(messageId,review=false,code=null){await this.query(`UPDATE wa_inbound SET state=$2,error_code=$3 WHERE message_id=$1`,[messageId,review?'needs_review':'done',code]);}
 async handoff(msg,reason){await this.query(`INSERT INTO wa_handoff(source_message_id,phone,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[msg.messageId,msg.phone,reason]);await this.query(`UPDATE wa_chat SET human_owned=true WHERE phone=$1`,[msg.phone]);}
 async recovered(){
  const c=await this.pool.connect();
  try{await c.query('BEGIN');
   const r=await c.query(`UPDATE wa_inbound SET state='needs_review',error_code='restarted_after_processing' WHERE state='processing' RETURNING message_id,phone`);
   for(const x of r.rows){
    await c.query(`INSERT INTO wa_handoff(source_message_id,phone,reason) VALUES($1,$2,'worker_restarted_during_processing') ON CONFLICT DO NOTHING`,[x.message_id,x.phone]);
    await c.query(`UPDATE wa_chat SET human_owned=true WHERE phone=$1`,[x.phone]);
   }
   await c.query('COMMIT');return r.rows;
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release();}
 }
 async history(phone){const r=await this.query(`SELECT payload FROM wa_inbound WHERE phone=$1 ORDER BY received_at DESC LIMIT 20`,[phone]);return r.rows.reverse().map(x=>({role:'customer',type:x.payload.type,text:x.payload.text||''}));}
}
