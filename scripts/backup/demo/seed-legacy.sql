-- Legacy-style synthetic data: quotations kept ONLY in lead notes (the pre-migration behaviour), duplicates, soft delete, staff notes.
insert into public.customers (id, name, email, phone, address) values
  ('cust-leg-1','Legacy Client One','','923015550001','Lahore'),
  ('cust-leg-2','Legacy Client Two','','923015550002','Karachi'),
  ('cust-leg-3','Legacy Client Three','three@example.test','923015550003','Islamabad'),
  ('cust-leg-4','Legacy Client Four','','923015550004','Lahore'),
  ('cust-leg-6','Legacy Client Six (dup A)','','923015550006','Multan'),
  ('cust-leg-7','Legacy Client Six (dup B)','','923015550006','Multan');
insert into public.leads (id, customer_id, name, email, phone, address, location, status, lead_source, notes, created_at, deleted_at) values
 ('lead-leg-1','cust-leg-1','Legacy Client One','','923015550001','Lahore','Lahore','New','Smart Quote',
  E'SMART_QUOTE_V1\nQuote: SES-20260920-1001\nSystem: 8 kW\nEstimate: PKR 1050000\nPanel: 14 x Synthetic 645W\nInverter: 1 x Synthetic 8kW\nBattery: Not included\nStructure: L2\nGenerated: 2026-09-20T10:00:00.000Z\nSnapshot: {"lines":[{"category":"Equipment","description":"Panel","specification":"645W","unit":"pcs","quantity":14,"unitPricePkr":27735,"totalPkr":388290}],"subtotalPkr":388290,"discountPkr":0}\nPdfArchive: {"quoteNumber":"SES-20260920-1001","fileName":"Sunchaser-Quotation-SES-20260920-1001.pdf","fileUrl":"/api/storage/object/customer-documents/c21hcnQtcXVvdGVzL2xlYWQtbGVnLTEvU0VTLTIwMjYwOTIwLTEwMDEucGRm?sig=0000000000000000000000000000000000000000000000000000000000000000","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","savedAt":"2026-09-20T10:01:00.000Z","sizeBytes":1024}',
  '2026-09-20T10:00:00Z', null),
 ('lead-leg-2','cust-leg-2','Legacy Client Two','','923015550002','Karachi','Karachi','Contacted','Smart Quote',
  E'SMART_QUOTE_V1\nQuote: SES-20260921-2002\nSystem: 12 kW\nEstimate: PKR 1650000\nPanel: 20 x Synthetic 645W\nInverter: 1 x Synthetic 12kW\nBattery: 1 x Synthetic 10kWh\nStructure: L2\nGenerated: 2026-09-21T09:30:00.000Z',
  '2026-09-21T09:30:00Z', null),
 ('lead-leg-3','cust-leg-3','Legacy Client Three','three@example.test','923015550003','Islamabad','Islamabad','New','Website','Prefers WhatsApp. Callback after 5pm.', '2026-09-22T08:00:00Z', null),
 ('lead-leg-4','cust-leg-4','Legacy Client Four','','923015550004','Lahore','Lahore','Quoted','Smart Quote',
  E'SMART_QUOTE_V1\nQuote: SES-20260923-3003\nSystem: 6 kW\nEstimate: PKR 820000\nPanel: 10 x Synthetic 645W\nInverter: 1 x Synthetic 6kW\nBattery: Not included\nStructure: L1\nGenerated: 2026-09-23T12:00:00.000Z\nStaff: client wants a site survey on Saturday.',
  '2026-09-23T12:00:00Z', null),
 ('lead-leg-5',null,'Legacy Deleted Client','','923015550005','Lahore','Lahore','New','Smart Quote',
  E'SMART_QUOTE_V1\nQuote: SES-20260924-4004\nSystem: 8 kW\nEstimate: PKR 1000000\nPanel: x\nInverter: x\nBattery: x\nStructure: x\nGenerated: 2026-09-24T12:00:00.000Z',
  '2026-09-24T12:00:00Z', '2026-09-25T00:00:00Z'),
 ('lead-leg-6','cust-leg-6','Legacy Client Six (dup A)','','923015550006','Multan','Multan','New','Smart Quote',
  E'SMART_QUOTE_V1\nQuote: SES-20260926-5005\nSystem: 8 kW\nEstimate: PKR 1000000\nPanel: x\nInverter: x\nBattery: x\nStructure: x\nGenerated: 2026-09-26T12:00:00.000Z',
  '2026-09-26T12:00:00Z', null),
 ('lead-leg-7','cust-leg-7','Legacy Client Six (dup B)','','923015550006','Multan','Multan','New','Smart Quote',
  E'SMART_QUOTE_V1\nQuote: SES-20260927-5006\nSystem: 10 kW\nEstimate: PKR 1300000\nPanel: x\nInverter: x\nBattery: x\nStructure: x\nGenerated: 2026-09-27T12:00:00.000Z',
  '2026-09-27T12:00:00Z', null),
 ('lead-leg-8',null,'Legacy No Notes','','923015550008','Lahore','Lahore','New','Website',null,'2026-09-28T12:00:00Z', null);
