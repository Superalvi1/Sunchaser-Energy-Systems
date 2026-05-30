import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

let SUPABASE_URL = process.env.SUPABASE_URL || "";
if (SUPABASE_URL && SUPABASE_URL.endsWith("/rest/v1/")) {
  SUPABASE_URL = SUPABASE_URL.substring(0, SUPABASE_URL.length - "/rest/v1/".length);
} else if (SUPABASE_URL && SUPABASE_URL.endsWith("/rest/v1")) {
  SUPABASE_URL = SUPABASE_URL.substring(0, SUPABASE_URL.length - "/rest/v1".length);
}
if (SUPABASE_URL && SUPABASE_URL.endsWith("/")) {
  SUPABASE_URL = SUPABASE_URL.substring(0, SUPABASE_URL.length - 1);
}
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const demoNames = ['John Miller', 'Jessica Albright', 'Robert Delgado', 'Catherine Vance'];
const demoUserIds = ['u-6'];

async function cleanSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("⚠️ Supabase credentials missing. Skipping Supabase live DB cleanup.");
    return;
  }

  console.log("Connecting to Supabase...");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log("Starting Supabase database purge...");

  // 1. Delete matching projects
  const { data: projDel, error: projErr } = await supabase
    .from("projects")
    .delete()
    .in("customer_name", demoNames)
    .select();
  if (projErr) console.error("❌ Error deleting projects:", projErr.message);
  else console.log(`✅ Deleted ${projDel?.length || 0} projects.`);

  // 2. Delete matching leads (will cascade to quotations, site surveys, trackers, payments, etc. where cascade is configured)
  const { data: leadDel, error: leadErr } = await supabase
    .from("leads")
    .delete()
    .in("name", demoNames)
    .select();
  if (leadErr) console.error("❌ Error deleting leads:", leadErr.message);
  else console.log(`✅ Deleted ${leadDel?.length || 0} leads.`);

  // 3. Delete matching support tickets
  const { data: ticketDel, error: ticketErr } = await supabase
    .from("support_tickets")
    .delete()
    .in("customer_name", demoNames)
    .select();
  if (ticketErr) console.error("❌ Error deleting tickets:", ticketErr.message);
  else console.log(`✅ Deleted ${ticketDel?.length || 0} tickets.`);

  // 4. Delete matching whatsapp logs
  const { data: waDel, error: waErr } = await supabase
    .from("whatsapp_logs")
    .delete()
    .in("customer_name", demoNames)
    .select();
  if (waErr) console.error("❌ Error deleting whatsapp logs:", waErr.message);
  else console.log(`✅ Deleted ${waDel?.length || 0} whatsapp logs.`);

  // 5. Delete matching orders, warranties, notifications
  const { data: orderDel, error: orderErr } = await supabase
    .from("orders")
    .delete()
    .in("customer_name", demoNames)
    .select();
  if (orderErr) console.warn("⚠️ Orders table not found or skip:", orderErr.message);
  else console.log(`✅ Deleted ${orderDel?.length || 0} orders.`);

  const { data: warDel, error: warErr } = await supabase
    .from("warranties")
    .delete()
    .in("customer_name", demoNames)
    .select();
  if (warErr) console.warn("⚠️ Warranties table not found or skip:", warErr.message);
  else console.log(`✅ Deleted ${warDel?.length || 0} warranties.`);

  const { data: notifDel, error: notifErr } = await supabase
    .from("notifications")
    .delete()
    .in("customer_name", demoNames)
    .select();
  if (notifErr) console.warn("⚠️ Notifications table not found or skip:", notifErr.message);
  else console.log(`✅ Deleted ${notifDel?.length || 0} notifications.`);

  // 6. Delete matching customers
  const { data: custDel, error: custErr } = await supabase
    .from("customers")
    .delete()
    .in("name", demoNames)
    .select();
  if (custErr) console.error("❌ Error deleting customers:", custErr.message);
  else console.log(`✅ Deleted ${custDel?.length || 0} customers.`);

  // 7. Delete customer user accounts
  const { data: userDel, error: userErr } = await supabase
    .from("users")
    .delete()
    .in("id", demoUserIds)
    .select();
  if (userErr) console.error("❌ Error deleting user:", userErr.message);
  else console.log(`✅ Deleted ${userDel?.length || 0} users.`);

  // 8. Delete activity logs containing names
  const { data: logs, error: selectErr } = await supabase
    .from("activity_logs")
    .select("id, details, user_name");
  if (selectErr) {
    console.error("❌ Error reading activity logs:", selectErr.message);
  } else if (logs) {
    const idsToDelete = logs
      .filter(log => {
        const matchDetails = /John Miller|Jessica Albright|Robert Delgado|Catherine Vance/i.test(log.details || "");
        const matchUser = demoNames.includes(log.user_name);
        return matchDetails || matchUser;
      })
      .map(log => log.id);
    
    if (idsToDelete.length > 0) {
      const { data: logDel, error: logErr } = await supabase
        .from("activity_logs")
        .delete()
        .in("id", idsToDelete)
        .select();
      if (logErr) console.error("❌ Error purging activity logs:", logErr.message);
      else console.log(`✅ Purged ${logDel?.length || 0} activity logs referencing USA demo data.`);
    } else {
      console.log("✅ No USA demo data referenced in activity logs.");
    }
  }

  // 9. Verification check for allauddin
  const { data: allauddin, error: authErr } = await supabase
    .from("users")
    .select("*")
    .eq("username", "allauddin")
    .maybeSingle();
  if (authErr) {
    console.warn("⚠️ Unable to verify allauddin user existence in live DB:", authErr.message);
  } else if (allauddin) {
    console.log(`✅ Verified: User 'allauddin' (${allauddin.name}) is intact and safe.`);
  } else {
    console.log("ℹ️ User 'allauddin' is not in database. This is normal if he hasn't been seeded yet.");
  }

  console.log("Live Supabase database purge completed.");
}

function cleanLocalFile() {
  const localDbPath = "./database.json";
  if (!fs.existsSync(localDbPath)) {
    console.log("ℹ️ No local database.json file found to clean.");
    return;
  }

  try {
    const content = fs.readFileSync(localDbPath, "utf8");
    const data = JSON.parse(content);

    console.log("Cleaning local database.json file...");

    if (data.users) {
      const orig = data.users.length;
      data.users = data.users.filter((u: any) => !demoUserIds.includes(u.id) && !demoNames.includes(u.name));
      console.log(`- Removed ${orig - data.users.length} users.`);
    }
    if (data.leads) {
      const orig = data.leads.length;
      data.leads = data.leads.filter((l: any) => !demoNames.includes(l.name));
      console.log(`- Removed ${orig - data.leads.length} leads.`);
    }
    if (data.customers) {
      const orig = data.customers.length;
      data.customers = data.customers.filter((c: any) => !demoNames.includes(c.name));
      console.log(`- Removed ${orig - data.customers.length} customers.`);
    }
    if (data.projects) {
      const orig = data.projects.length;
      data.projects = data.projects.filter((p: any) => !demoNames.includes(p.customerName));
      console.log(`- Removed ${orig - data.projects.length} projects.`);
    }
    if (data.tickets) {
      const orig = data.tickets.length;
      data.tickets = data.tickets.filter((t: any) => !demoNames.includes(t.customerName));
      console.log(`- Removed ${orig - data.tickets.length} tickets.`);
    }
    if (data.netMeteringTrackers) {
      let count = 0;
      const validLeadIds = new Set((data.leads || []).map((l: any) => l.id));
      for (const key of Object.keys(data.netMeteringTrackers)) {
        if (!validLeadIds.has(key)) {
          delete data.netMeteringTrackers[key];
          count++;
        }
      }
      console.log(`- Cleared ${count} net metering trackers.`);
    }
    if (data.paymentTracks) {
      let count = 0;
      const validLeadIds = new Set((data.leads || []).map((l: any) => l.id));
      for (const key of Object.keys(data.paymentTracks)) {
        if (!validLeadIds.has(key)) {
          delete data.paymentTracks[key];
          count++;
        }
      }
      console.log(`- Cleared ${count} payment tracks.`);
    }
    if (data.activityLogs) {
      const orig = data.activityLogs.length;
      data.activityLogs = data.activityLogs.filter((log: any) => {
        const matchDetails = /John Miller|Jessica Albright|Robert Delgado|Catherine Vance/i.test(log.details || "");
        const matchUser = demoNames.includes(log.userName);
        return !matchDetails && !matchUser;
      });
      console.log(`- Removed ${orig - data.activityLogs.length} activity logs.`);
    }
    if (data.whatsAppLogs) {
      const orig = data.whatsAppLogs.length;
      data.whatsAppLogs = data.whatsAppLogs.filter((log: any) => !demoNames.includes(log.customerName));
      console.log(`- Removed ${orig - data.whatsAppLogs.length} WhatsApp logs.`);
    }
    if (data.orders) {
      const orig = data.orders.length;
      data.orders = data.orders.filter((o: any) => !demoNames.includes(o.customerName));
      console.log(`- Removed ${orig - data.orders.length} orders.`);
    }
    if (data.warranties) {
      const orig = data.warranties.length;
      data.warranties = data.warranties.filter((w: any) => !demoNames.includes(w.customerName));
      console.log(`- Removed ${orig - data.warranties.length} warranties.`);
    }
    if (data.notifications) {
      const orig = data.notifications.length;
      data.notifications = data.notifications.filter((n: any) => !demoNames.includes(n.customerName));
      console.log(`- Removed ${orig - data.notifications.length} notifications.`);
    }

    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), "utf8");
    console.log("✅ Local database.json file cleanup completed successfully.");
  } catch (err: any) {
    console.error("❌ Failed to clean local database.json file:", err.message);
  }
}

async function run() {
  await cleanSupabase();
  cleanLocalFile();
  console.log(" Purge process completed successfully!");
}

run();
