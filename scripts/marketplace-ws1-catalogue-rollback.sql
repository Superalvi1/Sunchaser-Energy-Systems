-- Marketplace WS1 — catalogue seed rollback (manual apply only)
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT execute unless you intend to remove the WS1 seed catalogue.
-- *****************************************************************************
--
-- Cascade-safe rollback of WS1-seeded catalogue rows only.
--
-- Behavior:
-- 1. Deletes a seeded variant ONLY when no dependent rows reference it in any
--    WS0 table that FKs mp_product_variants (cascade or restrict):
--      mp_supplier_products, mp_price_overrides, mp_price_history,
--      mp_product_costs, mp_cart_items, mp_order_items, mp_price_alerts,
--      mp_media (variant-scoped).
--    Any such dependent is treated as operational and is retained; the seeded
--    variant parent is therefore also retained.
-- 2. Deletes a seeded product ONLY when:
--      - no variants remain (seeded or non-seeded);
--      - no product-scoped dependents remain in tables that FK mp_products /
--        carry product_id alongside variant FKs:
--        mp_media, mp_price_history, mp_supplier_products, mp_price_overrides,
--        mp_product_costs, mp_cart_items, mp_order_items, mp_price_alerts.
--    This prevents ON DELETE CASCADE from removing later operational rows
--    (non-seeded variants, media, mappings, overrides, history, costs, alerts).
-- 3. Never deletes operational/non-seeded child rows.
-- 4. Deletes seeded brands/categories only when no remaining product references
--    them (including retained seeded products and non-seed products).
-- 5. Seed-only catalogue rows without operational dependencies are removed.
-- 6. Transactional, deterministic, and safely repeatable.
-- 7. Does not touch delivery, payments, or unrelated CRM tables.

begin;

-- ---------------------------------------------------------------------------
-- 1. Seeded variants — only when no operational dependents exist
-- ---------------------------------------------------------------------------
delete from public.mp_product_variants v
where v.id in ('mpvar_ws1_knox_krypton_eco_6_2kw_hybrid','mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid','mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid','mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid','mpvar_ws1_solis_6kw_ip66_l_plus_hybrid','mpvar_ws1_solis_8kw_ip66_l_plus_hybrid','mpvar_ws1_huawei_sun2000_5kw_hybrid','mpvar_ws1_huawei_sun2000_8kw_hybrid','mpvar_ws1_inverex_nitrox_10kw_hybrid','mpvar_ws1_maxpower_suntronic_6kw_hybrid','mpvar_ws1_longi_himo6_580w_mono','mpvar_ws1_longi_himo7_600w_ntype','mpvar_ws1_canadian_solar_hiku7_580w','mpvar_ws1_jinko_tiger_neo_580w','mpvar_ws1_ja_solar_deepblue_580w','mpvar_ws1_narada_5_12kwh_lithium','mpvar_ws1_knox_5_12kwh_lithium','mpvar_ws1_pylontech_us5000_4_8kwh','mpvar_ws1_inverex_lv2_6_lithium','mpvar_ws1_fronus_meta_10kw_ongrid','mpvar_ws1_solis_6kw_ongrid_string','mpvar_ws1_solar_mounting_structure_per_kw','mpvar_ws1_dc_solar_cable_6mm_per_meter','mpvar_ws1_mc4_solar_connectors_pair','mpvar_ws1_solar_lightning_arrester_dc','mpvar_ws1_ac_dc_distribution_box','mpvar_ws1_bi_directional_net_meter','mpvar_ws1_6kw_complete_hybrid_system','mpvar_ws1_10kw_complete_hybrid_system','mpvar_ws1_15kw_commercial_solar_system')
  and not exists (
    select 1 from public.mp_supplier_products d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_price_overrides d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_price_history d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_product_costs d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_cart_items d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_order_items d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_price_alerts d where d.variant_id = v.id
  )
  and not exists (
    select 1 from public.mp_media d where d.variant_id = v.id
  );

-- ---------------------------------------------------------------------------
-- 2. Seeded products — only when no variants/product dependents remain
-- ---------------------------------------------------------------------------
delete from public.mp_products p
where p.id in ('mpprod_ws1_knox_krypton_eco_6_2kw_hybrid','mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid','mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid','mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid','mpprod_ws1_solis_6kw_ip66_l_plus_hybrid','mpprod_ws1_solis_8kw_ip66_l_plus_hybrid','mpprod_ws1_huawei_sun2000_5kw_hybrid','mpprod_ws1_huawei_sun2000_8kw_hybrid','mpprod_ws1_inverex_nitrox_10kw_hybrid','mpprod_ws1_maxpower_suntronic_6kw_hybrid','mpprod_ws1_longi_himo6_580w_mono','mpprod_ws1_longi_himo7_600w_ntype','mpprod_ws1_canadian_solar_hiku7_580w','mpprod_ws1_jinko_tiger_neo_580w','mpprod_ws1_ja_solar_deepblue_580w','mpprod_ws1_narada_5_12kwh_lithium','mpprod_ws1_knox_5_12kwh_lithium','mpprod_ws1_pylontech_us5000_4_8kwh','mpprod_ws1_inverex_lv2_6_lithium','mpprod_ws1_fronus_meta_10kw_ongrid','mpprod_ws1_solis_6kw_ongrid_string','mpprod_ws1_solar_mounting_structure_per_kw','mpprod_ws1_dc_solar_cable_6mm_per_meter','mpprod_ws1_mc4_solar_connectors_pair','mpprod_ws1_solar_lightning_arrester_dc','mpprod_ws1_ac_dc_distribution_box','mpprod_ws1_bi_directional_net_meter','mpprod_ws1_6kw_complete_hybrid_system','mpprod_ws1_10kw_complete_hybrid_system','mpprod_ws1_15kw_commercial_solar_system')
  and not exists (
    select 1 from public.mp_product_variants d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_media d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_price_history d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_supplier_products d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_price_overrides d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_product_costs d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_cart_items d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_order_items d where d.product_id = p.id
  )
  and not exists (
    select 1 from public.mp_price_alerts d where d.product_id = p.id
  );

-- ---------------------------------------------------------------------------
-- 3. Seeded brands/categories — only when unreferenced
-- ---------------------------------------------------------------------------
delete from public.mp_brands b
where b.id in ('mpbrand_ws1_canadian_solar','mpbrand_ws1_fronus','mpbrand_ws1_generic','mpbrand_ws1_growatt','mpbrand_ws1_huawei','mpbrand_ws1_inverex','mpbrand_ws1_ja_solar','mpbrand_ws1_jinko','mpbrand_ws1_knox','mpbrand_ws1_longi','mpbrand_ws1_maxpower','mpbrand_ws1_narada','mpbrand_ws1_pylontech','mpbrand_ws1_solis','mpbrand_ws1_sunchaser')
  and not exists (
    select 1 from public.mp_products p where p.brand_id = b.id
  );

delete from public.mp_categories c
where c.id in ('mpcat_ws1_solar_inverters','mpcat_ws1_solar_panels','mpcat_ws1_lithium_batteries','mpcat_ws1_hybrid_systems','mpcat_ws1_accessories','mpcat_ws1_on_grid_inverters')
  and not exists (
    select 1 from public.mp_products p where p.category_id = c.id
  );

commit;
