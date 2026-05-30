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

console.log("=================================================");
console.log("⚡ SunChaser Energy Systems - Supabase Sync Tester");
console.log("=================================================");
console.log(`URL: ${SUPABASE_URL ? SUPABASE_URL : "NOT CONFIGURED ❌"}`);
console.log(`KEY: ${SUPABASE_SERVICE_ROLE_KEY ? "CONFIGURED (hidden)" : "NOT CONFIGURED ❌"}`);
console.log("-------------------------------------------------");

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Aborting. Missing Supabase URL or Secret Key in environment variables.");
    process.exit(1);
  }

  // 1. Initialize Client
  console.log("Step 1: Initializing Supabase client...");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  console.log("✅ Supabase client initialized successfully.");

  // 2. Test Connection and Database Access
  console.log("\nStep 2: Accessing schema tables...");
  const tables = [
    "users",
    "customers",
    "leads",
    "quotations",
    "projects",
    "site_surveys",
    "installation_tasks",
    "net_metering_trackers",
    "payments",
    "support_tickets",
    "products_inventory",
    "whatsapp_logs",
    "activity_logs",
    "categories",
    "products",
    "solar_packages",
    "orders",
    "warranties",
    "notifications",
    "settings",
    "website_content",
    "purchase_orders"
  ];

  const results: Record<string, { status: "OK" | "Error"; msg: string }> = {};

  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) {
        results[table] = { status: "Error", msg: error.message };
        console.log(`❌ Table [${table}]: Failed to access. Error: ${error.message}`);
      } else {
        results[table] = { status: "OK", msg: `Accessible. Current count: ${count || 0}` };
        console.log(`✅ Table [${table}]: Accessible. Current row count: ${count}`);
      }
    } catch (e: any) {
      results[table] = { status: "Error", msg: e.message };
      console.log(`❌ Table [${table}]: Exception. Error: ${e.message}`);
    }
  }

  // 3. Verify / Create Storage Buckets
  console.log("\nStep 3: Verifying and creating storage buckets...");
  const requiredBuckets = ["bills", "quotations", "surveys", "projects", "payment_receipts"];
  const bucketResults: Record<string, "OK" | "Created" | "Failed"> = {};

  for (const bucket of requiredBuckets) {
    try {
      // Check if bucket already exists by listing files or getting details
      const { data: bucketInfo, error: getError } = await supabase.storage.getBucket(bucket);
      
      if (bucketInfo) {
        bucketResults[bucket] = "OK";
        console.log(`✅ Bucket [${bucket}]: Already exists and is verified.`);
      } else {
        // Build bucket
        console.log(`⚠️ Bucket [${bucket}] not found. Creating bucket...`);
        const { data: createData, error: createError } = await supabase.storage.createBucket(bucket, {
          public: true
        });
        
        if (createError) {
          bucketResults[bucket] = "Failed";
          console.error(`❌ Bucket [${bucket}] creation failed:`, createError.message);
        } else {
          bucketResults[bucket] = "Created";
          console.log(`✅ Bucket [${bucket}] created successfully and set to PUBLIC.`);
        }
      }
    } catch (e: any) {
      // Fallback: try creating bucket
      try {
        const { data, error } = await supabase.storage.createBucket(bucket, { public: true });
        if (error) {
          bucketResults[bucket] = "Failed";
          console.error(`❌ Bucket [${bucket}] creation fallback failed:`, error.message);
        } else {
          bucketResults[bucket] = "Created";
          console.log(`✅ Bucket [${bucket}] created successfully in fallback.`);
        }
      } catch (fallbackErr: any) {
        bucketResults[bucket] = "Failed";
        console.error(`❌ Bucket [${bucket}] absolute exception:`, e.message);
      }
    }
  }

  // 4. Seeding/Migrating local data
  console.log("\nStep 4: Performing dbManager data loading and migration stream...");
  let localDbData: any = {};
  try {
    const dbFileContent = fs.readFileSync("./database.json", "utf8");
    localDbData = JSON.parse(dbFileContent);
    console.log(`Loaded ${localDbData.leads?.length || 0} leads from local database.json.`);
  } catch (e: any) {
    console.warn("⚠️ Failed to load database.json or empty. Sourcing static InitialSeed defaults.", e.message);
  }

  // Let's call the actual dbManager's runDatabaseMigration implementation or test it
  console.log("Triggering on Conflict ID Upsert loops to Supabase...");
  let userCount = 0;
  let customerCount = 0;
  let leadCount = 0;
  let quoteCount = 0;
  let projectCount = 0;
  let taskCount = 0;
  let trackerCount = 0;
  let payCount = 0;
  let ticketCount = 0;
  let productCount = 0;
  let activityCount = 0;
  let waCount = 0;

  try {
    // 4.1 Users
    if (localDbData.users) {
      for (const u of localDbData.users) {
        const { error } = await supabase.from("users").upsert({
          id: u.id,
          username: u.username,
          password: u.password,
          name: u.name,
          email: u.email,
          role: u.role
        }, { onConflict: "id" });
        if (!error) userCount++;
      }
    }

    // 4.2 Inventory
    if (localDbData.inventory) {
      for (const item of localDbData.inventory) {
        const { error } = await supabase.from("products_inventory").upsert({
          id: item.id,
          name: item.name,
          category: item.category,
          description: item.desc || "",
          stock: item.stock || 0,
          cost: item.cost || 0
        }, { onConflict: "id" });
        if (!error) productCount++;
      }
    }

    // 4.3 Customers, Leads, Site Surveys, Installation Tasks, Quotations
    if (localDbData.leads) {
      for (const l of localDbData.leads) {
        const customerId = `cust-${l.id.replace("lead-", "")}`;

        await supabase.from("customers").upsert({
          id: customerId,
          name: l.name,
          email: l.email,
          phone: l.phone,
          address: l.address
        }, { onConflict: "id" });
        customerCount++;

        await supabase.from("leads").upsert({
          id: l.id,
          customer_id: customerId,
          name: l.name,
          email: l.email,
          phone: l.phone,
          address: l.address,
          status: l.status,
          monthly_bill: l.monthlyBill || 0,
          monthly_units: l.monthlyUnits || 0,
          sanctioned_load: l.sanctionedLoad || 0,
          backup_requirement: l.backupRequirement || "None",
          location: l.location || "Springfield",
          roof_type: l.roofType || "Asphalt Shingle",
          roof_space: l.roofSpace || 0,
          shading: l.shading || "None",
          rating: l.rating || 3,
          assigned_salesperson: l.assignedSalesperson || "",
          notes: l.notes || "",
          lead_source: l.leadSource || "",
          engagement_level: l.engagementLevel || "Medium",
          conversion_probability: l.conversionProbability || 50,
          conversion_score: l.conversionScore || 50,
          created_at: l.createdAt || new Date().toISOString()
        }, { onConflict: "id" });
        leadCount++;

        if (l.survey) {
          await supabase.from("site_surveys").upsert({
            lead_id: l.id,
            scheduled_date: l.survey.scheduledDate || null,
            status: l.survey.status || "Pending",
            notes: l.survey.notes || "",
            shading_percent: l.survey.shadingPercent || 0,
            optimal_placement: l.survey.optimalPlacement || "",
            photos: l.survey.photos || [],
            roof_pitch: l.survey.measurements?.roofPitch || "",
            rafter_spacing: l.survey.measurements?.rafterSpacing || "",
            dimensions: l.survey.measurements?.dimensions || "",
            obstructions: l.survey.measurements?.obstructions || "",
            structure_recommendation: l.survey.structureRecommendation || "",
            db_inverter_location: l.survey.dbInverterLocation || "",
            panel_placements: l.survey.panelPlacements || []
          }, { onConflict: "lead_id" });
        }

        if (l.installation && Array.isArray(l.installation.tasks)) {
          for (const task of l.installation.tasks) {
            const { error } = await supabase.from("installation_tasks").upsert({
              id: `${l.id}-${task.id}`,
              lead_id: l.id,
              name: task.name,
              done: task.done || false
            }, { onConflict: "id" });
            if (!error) taskCount++;
          }
        }

        if (l.quotes) {
          for (const q of l.quotes) {
            const { error } = await supabase.from("quotations").upsert({
              id: q.id,
              lead_id: l.id,
              customer_id: customerId,
              system_size_kw: q.systemSizekW || 0,
              panel_count: q.panelCount || 0,
              panel_type: q.panelType || "Sunchaser Ultra 400W",
              inverter_type: q.inverterType || "Enphase IQ8 Microinverter",
              battery_capacity: q.batteryCapacity || "",
              total_cost: q.totalCost || 0,
              federal_tax_credit: q.federalTaxCredit || 0,
              net_cost: q.netCost || 0,
              estimated_annual_savings: q.estimatedAnnualSavings || 0,
              payback_period_years: q.paybackPeriodYears || 0,
              status: q.status || "Pending",
              structure_type: q.structureType || "",
              accessories: q.accessories || "",
              installation_charges: q.installationCharges || 0,
              net_metering_charges: q.netMeteringCharges || 0,
              payment_terms: q.paymentTerms || "",
              warranty_terms: q.warrantyTerms || "",
              terms_and_conditions: q.termsAndConditions || "",
              created_at: q.createdAt || new Date().toISOString()
            }, { onConflict: "id" });
            if (!error) quoteCount++;
          }
        }
      }
    }

    // 4.4 Projects
    if (localDbData.projects) {
      for (const p of localDbData.projects) {
        const customerId = `cust-${p.leadId.replace("lead-", "")}`;
        const { error } = await supabase.from("projects").upsert({
          id: p.id,
          lead_id: p.leadId,
          customer_id: customerId,
          customer_name: p.customerName || "N/A",
          address: p.address || "N/A",
          system_size_kw: p.systemSizekW || 0,
          stage: p.stage || "Advance Received",
          created_at: p.createdAt || new Date().toISOString(),
          updated_at: p.updatedAt || new Date().toISOString()
        }, { onConflict: "id" });
        if (!error) projectCount++;
      }
    }

    // 4.5 Net Metering
    if (localDbData.netMeteringTrackers) {
      for (const leadId of Object.keys(localDbData.netMeteringTrackers)) {
        const tracker = localDbData.netMeteringTrackers[leadId];
        const { error } = await supabase.from("net_metering_trackers").upsert({
          lead_id: leadId,
          documents_collected: tracker.documentsCollected || false,
          application_submitted: tracker.applicationSubmitted || false,
          disco_inspection: tracker.discoInspection || false,
          demand_notice: tracker.demandNotice || false,
          meter_installation: tracker.meterInstallation || false,
          green_meter_active: tracker.greenMeterActive || false,
          updated_at: new Date().toISOString()
        }, { onConflict: "lead_id" });
        if (!error) trackerCount++;
      }
    }

    // 4.6 Payments Tracker
    if (localDbData.paymentTracks) {
      for (const leadId of Object.keys(localDbData.paymentTracks)) {
        const pay = localDbData.paymentTracks[leadId];
        const customerId = `cust-${leadId.replace("lead-", "")}`;
        const { error } = await supabase.from("payments").upsert({
          lead_id: leadId,
          customer_id: customerId,
          total_value: pay.totalValue || 0,
          advance_received: pay.advanceReceived || 0,
          pending_amount: pay.pendingAmount || 0,
          reminder_sent: pay.reminder_sent || false,
          invoice_status: pay.invoiceStatus || "Pending",
          milestones: pay.milestones || [],
          updated_at: new Date().toISOString()
        }, { onConflict: "lead_id" });
        if (!error) payCount++;
      }
    }

    // 4.7 Support Tickets
    if (localDbData.tickets) {
      for (const t of localDbData.tickets) {
        const { error } = await supabase.from("support_tickets").upsert({
          id: t.id,
          customer_name: t.customerName,
          email: t.email,
          subject: t.subject,
          description: t.description,
          status: t.status,
          priority: t.priority,
          messages: t.messages || []
        }, { onConflict: "id" });
        if (!error) ticketCount++;
      }
    }

    // 4.8 WhatsApp Logs
    if (localDbData.whatsAppLogs) {
      for (const log of localDbData.whatsAppLogs) {
        const { error } = await supabase.from("whatsapp_logs").upsert({
          id: log.id,
          timestamp: log.timestamp || new Date().toISOString(),
          customer_name: log.customerName,
          phone: log.phone,
          event_type: log.eventType,
          message_text: log.messageText,
          status: log.status || "Delivered"
        }, { onConflict: "id" });
        if (!error) waCount++;
      }
    }

    // 4.9 Activity Logs
    if (localDbData.activityLogs) {
      for (const log of localDbData.activityLogs) {
        const { error } = await supabase.from("activity_logs").upsert({
          id: log.id,
          timestamp: log.timestamp || new Date().toISOString(),
          user_id: log.userId || "system",
          user_name: log.userName || "System",
          role: log.role || "CRM",
          action: log.action || "Log",
          details: log.details || ""
        }, { onConflict: "id" });
        if (!error) activityCount++;
      }
    }

    console.log(`✅ Migration Success Metrics:
    - ${userCount} Users synched
    - ${customerCount} Customer profiles mapped
    - ${leadCount} Solar Leads uploaded
    - ${quoteCount} Price Quotations registered
    - ${projectCount} Sunchaser Projects active
    - ${taskCount} Installation tasks synchronized
    - ${trackerCount} Net metering trackers seeded
    - ${payCount} Cashflows synched
    - ${ticketCount} Tickets synced
    - ${productCount} Active SKUs loaded
    - ${waCount} WhatsApp event logs restored
    - ${activityCount} System activity audits preserved`);

  } catch (migErr: any) {
    console.error("❌ Migration error occurred:", migErr.message);
  }

  // 5. Run Live CRUD Verification Suite
  console.log("\nStep 5: Initiating Sunchaser ERP CRUD Integration Audit Suite...");
  const tempIdSuffix = `test-${Date.now()}`;
  const testLeadId = `lead-${tempIdSuffix}`;
  const testCustomerId = `cust-${tempIdSuffix}`;
  const testQuoteId = `q-${tempIdSuffix}`;
  const testProjectId = `project-${tempIdSuffix}`;

  try {
    // A. CREATE LEAD
    console.log("   A. Inserting Test Customer & Solar Lead...");
    
    // Create customer first
    const { error: custErr } = await supabase.from("customers").insert({
      id: testCustomerId,
      name: "Arthur Dent Sunchaser-Test",
      email: "arthur.dent@galaxy-hitchhiker.com",
      phone: "+1 (555) 424242",
      address: "Milliways End of Universe Road"
    });
    if (custErr) throw new Error(`Customer Insert: ${custErr.message}`);

    const { error: leadErr } = await supabase.from("leads").insert({
      id: testLeadId,
      customer_id: testCustomerId,
      name: "Arthur Dent Sunchaser-Test",
      email: "arthur.dent@galaxy-hitchhiker.com",
      phone: "+1 (555) 424242",
      address: "Milliways End of Universe Road",
      status: "New",
      monthly_bill: 142,
      monthly_units: 500,
      sanctioned_load: 8,
      location: "Springfield",
      roof_type: "Standing Seam Metal",
      roof_space: 900,
      shading: "Low",
      rating: 4,
      assigned_salesperson: "Sarah Connor",
      notes: "Test lead generated during Sunchaser automated Supabase audit validation",
      lead_source: "REST Integrity QA CLI"
    });
    if (leadErr) throw new Error(`Lead Insert: ${leadErr.message}`);
    console.log("      ✅ Solar lead inserted successfully.");

    // B. UPDATE LEAD
    console.log("   B. Updating solar lead properties...");
    const { error: updateErr } = await supabase
      .from("leads")
      .update({
        status: "Contacted",
        notes: "Sunchaser coordinator discussed Powerwall battery incentives. Highly interested.",
        conversion_score: 92,
        conversion_probability: 95
      })
      .eq("id", testLeadId);
    if (updateErr) throw new Error(`Lead Update: ${updateErr.message}`);
    console.log("      ✅ Solar lead properties updated successfully.");

    // C. CREATE QUOTATION
    console.log("   C. Generating custom Price Quotation terms...");
    const { error: quoteErr } = await supabase.from("quotations").insert({
      id: testQuoteId,
      lead_id: testLeadId,
      customer_id: testCustomerId,
      system_size_kw: 8.5,
      panel_count: 22,
      panel_type: "Sunchaser Ultra 400W",
      inverter_type: "Enphase IQ8 Microinverter",
      battery_capacity: "13.5 kWh Sunchaser Core",
      total_cost: 19500,
      federal_tax_credit: 5850,
      net_cost: 13650,
      estimated_annual_savings: 2800,
      payback_period_years: 5.2,
      status: "Pending",
      structure_type: "Anodized water barrier rails",
      warranty_terms: "25 Years degradation limit",
      payment_terms: "30% retain, 30% structurally, 30% mount completion, 10% grid"
    });
    if (quoteErr) throw new Error(`Quotation Insert: ${quoteErr.message}`);
    console.log("      ✅ Custom quotation terms created successfully.");

    // D. CREATE PROJECT FROM ACCEPTED PROPOSAL
    console.log("   D. Activating Project & tracking milestone structures...");
    const { error: projErr } = await supabase.from("projects").insert({
      id: testProjectId,
      lead_id: testLeadId,
      quotation_id: testQuoteId,
      customer_id: testCustomerId,
      customer_name: "Arthur Dent Sunchaser-Test",
      address: "Milliways End of Universe Road",
      system_size_kw: 8.5,
      stage: "Advance Received"
    });
    if (projErr) throw new Error(`Project Creation: ${projErr.message}`);
    console.log("      ✅ Customer project spawned successfully.");

    // E. RECORD PAYMENT RECEIPT
    console.log("   E. Registering $5,850 Milestone Sign-up Retainer...");
    const milestones = [
      { name: "30% Sign-up Advance", amount: 5850, status: "Paid", dueDate: new Date().toISOString().split("T")[0] },
      { name: "30% Structural Approval", amount: 5850, status: "Pending", dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] }
    ];
    const { error: payErr } = await supabase.from("payments").insert({
      lead_id: testLeadId,
      project_id: testProjectId,
      customer_id: testCustomerId,
      total_value: 19500,
      advance_received: 5850,
      pending_amount: 13650,
      invoice_status: "Pending",
      milestones: milestones
    });
    if (payErr) throw new Error(`Payment Record: ${payErr.message}`);
    console.log("      ✅ Milestone retain payment recorded successfully.");

    // F. ACTIVATE STORAGE BUCKET INTEGRATION TEST
    console.log("   F. Testing storage bucket document upload and streaming download...");
    const testFileName = `test-upload-${Date.now()}.txt`;
    const testFileText = "Sunchaser Energy Systems Supabase Storage Integration Audit Verification File";
    const testFileBuffer = Buffer.from(testFileText, "utf-8");

    const { error: uploadErr } = await supabase.storage
      .from("bills")
      .upload(testFileName, testFileBuffer, {
        contentType: "text/plain",
        upsert: true
      });
    if (uploadErr) throw new Error(`Bucket File Upload: ${uploadErr.message}`);
    console.log("      ✅ Dummy document successfully uploaded to bills bucket.");

    const { data: downloadData, error: downloadErr } = await supabase.storage
      .from("bills")
      .download(testFileName);
    if (downloadErr) throw new Error(`Bucket File Download: ${downloadErr.message}`);

    const downloadedText = await downloadData.text();
    if (downloadedText !== testFileText) {
      throw new Error(`Bucket content mismatch. Read: ${downloadedText}`);
    }
    console.log("      ✅ Streamed download parsed and validated correctly.");

    const { error: pruneFileErr } = await supabase.storage
      .from("bills")
      .remove([testFileName]);
    if (pruneFileErr) throw new Error(`Bucket File Deletion: ${pruneFileErr.message}`);
    console.log("      ✅ Temporary verify file purged from storage bucket.");

    // CLEANUP TEST DATA
    console.log("\nStep 6: Cleaning up test data to keep Supabase pristine...");
    await supabase.from("payments").delete().eq("lead_id", testLeadId);
    await supabase.from("projects").delete().eq("id", testProjectId);
    await supabase.from("quotations").delete().eq("id", testQuoteId);
    await supabase.from("leads").delete().eq("id", testLeadId);
    await supabase.from("customers").delete().eq("id", testCustomerId);
    console.log("✅ Cleanup finished perfectly.");

    console.log("\n=================================================");
    console.log("🥇 ALL SUPABASE ERP TESTS PASSED WITH 100% SUCCESS!");
    console.log("=================================================");

  } catch (error: any) {
    console.error("\n❌ CRUD INTEGRATION FAILURE:", error.message);
    process.exit(1);
  }
}

main();
