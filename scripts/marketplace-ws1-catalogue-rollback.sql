-- Marketplace WS1 — catalogue seed rollback (manual apply only)
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT execute unless you intend to remove the WS1 seed catalogue.
-- *****************************************************************************
--
-- Removes ONLY WS1-seeded catalogue rows (deterministic IDs).
-- Never deletes brands/categories still referenced by non-seed products.
-- Never deletes operational records created after seeding (non-ws1 IDs).
-- Does not touch costs, media, orders, or delivery tables.

begin;

delete from public.mp_product_variants
where id in ('mpvar_ws1_knox_krypton_eco_6_2kw_hybrid','mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid','mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid','mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid','mpvar_ws1_solis_6kw_ip66_l_plus_hybrid','mpvar_ws1_solis_8kw_ip66_l_plus_hybrid','mpvar_ws1_huawei_sun2000_5kw_hybrid','mpvar_ws1_huawei_sun2000_8kw_hybrid','mpvar_ws1_inverex_nitrox_10kw_hybrid','mpvar_ws1_maxpower_suntronic_6kw_hybrid','mpvar_ws1_longi_himo6_580w_mono','mpvar_ws1_longi_himo7_600w_ntype','mpvar_ws1_canadian_solar_hiku7_580w','mpvar_ws1_jinko_tiger_neo_580w','mpvar_ws1_ja_solar_deepblue_580w','mpvar_ws1_narada_5_12kwh_lithium','mpvar_ws1_knox_5_12kwh_lithium','mpvar_ws1_pylontech_us5000_4_8kwh','mpvar_ws1_inverex_lv2_6_lithium','mpvar_ws1_fronus_meta_10kw_ongrid','mpvar_ws1_solis_6kw_ongrid_string','mpvar_ws1_solar_mounting_structure_per_kw','mpvar_ws1_dc_solar_cable_6mm_per_meter','mpvar_ws1_mc4_solar_connectors_pair','mpvar_ws1_solar_lightning_arrester_dc','mpvar_ws1_ac_dc_distribution_box','mpvar_ws1_bi_directional_net_meter','mpvar_ws1_6kw_complete_hybrid_system','mpvar_ws1_10kw_complete_hybrid_system','mpvar_ws1_15kw_commercial_solar_system');

delete from public.mp_products
where id in ('mpprod_ws1_knox_krypton_eco_6_2kw_hybrid','mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid','mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid','mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid','mpprod_ws1_solis_6kw_ip66_l_plus_hybrid','mpprod_ws1_solis_8kw_ip66_l_plus_hybrid','mpprod_ws1_huawei_sun2000_5kw_hybrid','mpprod_ws1_huawei_sun2000_8kw_hybrid','mpprod_ws1_inverex_nitrox_10kw_hybrid','mpprod_ws1_maxpower_suntronic_6kw_hybrid','mpprod_ws1_longi_himo6_580w_mono','mpprod_ws1_longi_himo7_600w_ntype','mpprod_ws1_canadian_solar_hiku7_580w','mpprod_ws1_jinko_tiger_neo_580w','mpprod_ws1_ja_solar_deepblue_580w','mpprod_ws1_narada_5_12kwh_lithium','mpprod_ws1_knox_5_12kwh_lithium','mpprod_ws1_pylontech_us5000_4_8kwh','mpprod_ws1_inverex_lv2_6_lithium','mpprod_ws1_fronus_meta_10kw_ongrid','mpprod_ws1_solis_6kw_ongrid_string','mpprod_ws1_solar_mounting_structure_per_kw','mpprod_ws1_dc_solar_cable_6mm_per_meter','mpprod_ws1_mc4_solar_connectors_pair','mpprod_ws1_solar_lightning_arrester_dc','mpprod_ws1_ac_dc_distribution_box','mpprod_ws1_bi_directional_net_meter','mpprod_ws1_6kw_complete_hybrid_system','mpprod_ws1_10kw_complete_hybrid_system','mpprod_ws1_15kw_commercial_solar_system');

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
