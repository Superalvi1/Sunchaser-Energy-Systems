# WS1 Public Catalogue — Product Activation Review (NON-EXECUTABLE)

Status: **REVIEW ONLY — zero products are currently authorized for activation.**

This document is a review artifact. It contains **no executable SQL** and must
not be used as a runbook. Activating products (setting
`mp_products.ws1_public = true`) requires a standalone, separately reviewed
DML change plus explicit owner authorization.

Related contract: `scripts/marketplace-ws1-public-rpc-contract.sql`
(fail-closed gate `mp_products.ws1_public boolean NOT NULL DEFAULT false`).

---

## 1. Proposed WS1 scope (30 product IDs)

These are the 30 curated WS1 seed products that were *proposed* for the public
storefront. Listing an ID here is **not** authorization.

| # | Product ID | Status |
|---|---|---|
| 1 | `mpprod_ws1_knox_krypton_eco_6_2kw_hybrid` | Not authorized |
| 2 | `mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid` | Not authorized |
| 3 | `mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid` | Not authorized |
| 4 | `mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid` | Not authorized |
| 5 | `mpprod_ws1_solis_6kw_ip66_l_plus_hybrid` | Not authorized |
| 6 | `mpprod_ws1_solis_8kw_ip66_l_plus_hybrid` | Not authorized |
| 7 | `mpprod_ws1_huawei_sun2000_5kw_hybrid` | Not authorized |
| 8 | `mpprod_ws1_huawei_sun2000_8kw_hybrid` | Not authorized |
| 9 | `mpprod_ws1_inverex_nitrox_10kw_hybrid` | **Evidence-blocked** |
| 10 | `mpprod_ws1_maxpower_suntronic_6kw_hybrid` | Not authorized |
| 11 | `mpprod_ws1_longi_himo6_580w_mono` | Not authorized |
| 12 | `mpprod_ws1_longi_himo7_600w_ntype` | Not authorized |
| 13 | `mpprod_ws1_canadian_solar_hiku7_580w` | Not authorized |
| 14 | `mpprod_ws1_jinko_tiger_neo_580w` | Not authorized |
| 15 | `mpprod_ws1_ja_solar_deepblue_580w` | Not authorized |
| 16 | `mpprod_ws1_narada_5_12kwh_lithium` | Not authorized |
| 17 | `mpprod_ws1_knox_5_12kwh_lithium` | Not authorized |
| 18 | `mpprod_ws1_pylontech_us5000_4_8kwh` | **Evidence-blocked** |
| 19 | `mpprod_ws1_inverex_lv2_6_lithium` | **Evidence-blocked** |
| 20 | `mpprod_ws1_fronus_meta_10kw_ongrid` | **Evidence-blocked** |
| 21 | `mpprod_ws1_solis_6kw_ongrid_string` | Not authorized |
| 22 | `mpprod_ws1_solar_mounting_structure_per_kw` | Not authorized |
| 23 | `mpprod_ws1_dc_solar_cable_6mm_per_meter` | Not authorized |
| 24 | `mpprod_ws1_mc4_solar_connectors_pair` | Not authorized |
| 25 | `mpprod_ws1_solar_lightning_arrester_dc` | Not authorized |
| 26 | `mpprod_ws1_ac_dc_distribution_box` | Not authorized |
| 27 | `mpprod_ws1_bi_directional_net_meter` | Not authorized |
| 28 | `mpprod_ws1_6kw_complete_hybrid_system` | Not authorized |
| 29 | `mpprod_ws1_10kw_complete_hybrid_system` | Not authorized |
| 30 | `mpprod_ws1_15kw_commercial_solar_system` | Not authorized |

## 2. Evidence-blocked products (4)

The following four products are locked by the supplier-evidence gate
(`EVIDENCE_BLOCKER_VARIANT_IDS`, enforced by
`server/marketplace/suppliers/evidenceBlockers.ts` and the WS4 ingestion
trigger `EVIDENCE_BLOCKER` exception). They cannot be activated until verified
supplier evidence is supplied and the blocker is formally cleared.

| Product ID | Blocked variant ID |
|---|---|
| `mpprod_ws1_inverex_nitrox_10kw_hybrid` | `mpvar_ws1_inverex_nitrox_10kw_hybrid` |
| `mpprod_ws1_pylontech_us5000_4_8kwh` | `mpvar_ws1_pylontech_us5000_4_8kwh` |
| `mpprod_ws1_inverex_lv2_6_lithium` | `mpvar_ws1_inverex_lv2_6_lithium` |
| `mpprod_ws1_fronus_meta_10kw_ongrid` | `mpvar_ws1_fronus_meta_10kw_ongrid` |

## 3. Authorization status

- Products authorized for activation right now: **0 (zero)**.
- The blanket "enable all 30" DML that previously appeared (commented) in the
  migration has been **removed** and must not be reintroduced.
- Any future activation must be per-product (or per explicitly reviewed batch),
  never blanket.

## 4. Gates required before any future activation DML

Each product must satisfy **all** of the following before its
`ws1_public` flag may be set to `true`:

### 4.1 Media gate
- At least one public image exists with `published = true`.
- `role <> 'receipt'` (receipts are never public).
- `rights_status` is one of `own`, `licensed`, `supplier_approved`.
- `approved_by IS NOT NULL` and `approved_at IS NOT NULL` (named approver and
  approval timestamp recorded).
- `source_url` is non-null, HTTPS, and passes the server's exact hostname
  allowlist (`SUPPLIER_IMAGE_HOSTS` / `MARKETPLACE_OWN_IMAGE_HOSTS` /
  `MARKETPLACE_LICENSED_IMAGE_HOSTS`).

### 4.2 Price gate
- The default variant's public price must satisfy the public-price policy:
  `website_price_state` in (`priced_auto`, `priced_override`),
  `stock_status = 'in_stock'`, and a positive finite price — otherwise the
  public price is emitted as null (confirm-price behavior preserved).
- No unapproved automatic price may be exposed for `unknown`, `sold_out`, or
  `backorder` stock states.

### 4.3 Evidence gate
- The product's variant must not be in `EVIDENCE_BLOCKER_VARIANT_IDS`.
- Supplier-sourced data must have verified evidence on file (WS4 ingestion
  requirement).

### 4.4 Process gate
- Owner (CEO) authorization recorded for the specific product list.
- Standalone DML review separate from schema migrations.
- Rollback plan identified (set `ws1_public = false` for the same IDs).

## 5. Explicit non-goals

- No executable activation SQL exists in this repository.
- The v2 public RPCs return nothing until at least one product passes all
  gates above and is activated through a reviewed DML change.
