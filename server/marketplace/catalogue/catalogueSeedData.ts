/**
 * Frozen WS1 catalogue seed expectations (preflight-approved slugs + SKUs).
 * Source of truth for seed SQL generation and regression tests.
 * Do not rename slugs or SKUs without an explicit contract change.
 */
export type Ws1SeedProductExpectation = {
  slug: string;
  sku: string;
  websitePrice: number;
  originalPrice: number | null;
  brandSlug: string;
  brandName: string;
  categorySlug: string;
  featured: boolean;
  warranty: string;
  specifications: Record<string, string>;
  productId: string;
  variantId: string;
  brandId: string;
  categoryId: string;
  title: string;
  description: string;
  tags: string[];
};

export const WS1_SEED_CATEGORY_SLUGS = [
  "solar-inverters",
  "solar-panels",
  "lithium-batteries",
  "hybrid-systems",
  "accessories",
  "on-grid-inverters"
] as const;

export const WS1_SEED_BRAND_SLUGS = [
  "canadian-solar",
  "fronus",
  "generic",
  "growatt",
  "huawei",
  "inverex",
  "ja-solar",
  "jinko",
  "knox",
  "longi",
  "maxpower",
  "narada",
  "pylontech",
  "solis",
  "sunchaser"
] as const;

export const WS1_SEED_PRODUCTS: readonly Ws1SeedProductExpectation[] = [
  {
    "slug": "knox-krypton-eco-6-2kw-hybrid",
    "sku": "SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID",
    "websitePrice": 111000,
    "originalPrice": 120000,
    "brandSlug": "knox",
    "brandName": "Knox",
    "categorySlug": "solar-inverters",
    "featured": true,
    "warranty": "2 Years Official Warranty",
    "specifications": {
      "Power": "6.2KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "6600W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.6%",
      "Protection": "IP21",
      "Display": "LCD",
      "WiFi": "Built-in"
    },
    "productId": "mpprod_ws1_knox_krypton_eco_6_2kw_hybrid",
    "variantId": "mpvar_ws1_knox_krypton_eco_6_2kw_hybrid",
    "brandId": "mpbrand_ws1_knox",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Knox Krypton Eco 6.2KW IP-21 PV6600 Hybrid Solar Inverter",
    "description": "The Knox Krypton Eco 6.2KW is a powerful hybrid solar inverter with PV6600 input, built-in MPPT charge controller, and WiFi monitoring. Perfect for residential solar systems with battery backup capability.",
    "tags": [
      "knox",
      "hybrid",
      "6kw",
      "residential"
    ]
  },
  {
    "slug": "knox-krypton-6-5kw-pv9055-hybrid",
    "sku": "SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID",
    "websitePrice": 135000,
    "originalPrice": null,
    "brandSlug": "knox",
    "brandName": "Knox",
    "categorySlug": "solar-inverters",
    "featured": true,
    "warranty": "2 Years Official Warranty",
    "specifications": {
      "Power": "6.5KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "9055W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.8%",
      "Protection": "IP21",
      "WiFi": "Built-in"
    },
    "productId": "mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid",
    "variantId": "mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid",
    "brandId": "mpbrand_ws1_knox",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Knox Krypton 6.5KW PV9055 Hybrid Solar Inverter",
    "description": "Advanced 6.5KW hybrid inverter from Knox with high PV input of 9055W, dual MPPT trackers, and smart energy management. Ideal for medium-sized homes.",
    "tags": [
      "knox",
      "hybrid",
      "6.5kw"
    ]
  },
  {
    "slug": "growatt-min-6000tl-xh-6kw-hybrid",
    "sku": "SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID",
    "websitePrice": 175000,
    "originalPrice": null,
    "brandSlug": "growatt",
    "brandName": "Growatt",
    "categorySlug": "solar-inverters",
    "featured": true,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "6KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "8000W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.6%",
      "Protection": "IP65",
      "Display": "OLED",
      "WiFi": "Built-in"
    },
    "productId": "mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid",
    "variantId": "mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid",
    "brandId": "mpbrand_ws1_growatt",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Growatt MIN 6000TL-XH 6KW Hybrid Solar Inverter",
    "description": "Growatt MIN 6000TL-XH is a compact and efficient 6KW hybrid inverter with built-in MPPT, battery management, and remote monitoring via ShinePhone app.",
    "tags": [
      "growatt",
      "hybrid",
      "6kw",
      "ip65"
    ]
  },
  {
    "slug": "growatt-sph-8000tl3-8kw-hybrid",
    "sku": "SC-GROWATT_SPH_8000TL3_8KW_HYBRID",
    "websitePrice": 245000,
    "originalPrice": null,
    "brandSlug": "growatt",
    "brandName": "Growatt",
    "categorySlug": "solar-inverters",
    "featured": false,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "8KW",
      "Type": "Hybrid Three Phase",
      "MPPT": "Dual MPPT",
      "PVInput": "12000W",
      "BatteryVoltage": "48V",
      "Efficiency": "98%",
      "Protection": "IP65"
    },
    "productId": "mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid",
    "variantId": "mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid",
    "brandId": "mpbrand_ws1_growatt",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Growatt SPH 8000TL3-BH 8KW Three Phase Hybrid Inverter",
    "description": "Premium 8KW three-phase hybrid inverter from Growatt with advanced battery management and high efficiency for commercial installations.",
    "tags": [
      "growatt",
      "hybrid",
      "8kw",
      "three-phase",
      "commercial"
    ]
  },
  {
    "slug": "solis-6kw-ip66-l-plus-hybrid",
    "sku": "SC-SOLIS_6KW_IP66_L_PLUS_HYBRID",
    "websitePrice": 195000,
    "originalPrice": null,
    "brandSlug": "solis",
    "brandName": "Solis",
    "categorySlug": "solar-inverters",
    "featured": true,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "6KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "9000W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.7%",
      "Protection": "IP66",
      "Display": "LCD"
    },
    "productId": "mpprod_ws1_solis_6kw_ip66_l_plus_hybrid",
    "variantId": "mpvar_ws1_solis_6kw_ip66_l_plus_hybrid",
    "brandId": "mpbrand_ws1_solis",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Solis S6-EH1P 6KW IP66 L Plus Hybrid Inverter",
    "description": "Solis 6KW IP66 rated hybrid inverter with L Plus technology, outdoor installation ready, dual MPPT, and comprehensive battery compatibility.",
    "tags": [
      "solis",
      "hybrid",
      "6kw",
      "ip66",
      "outdoor"
    ]
  },
  {
    "slug": "solis-8kw-ip66-l-plus-hybrid",
    "sku": "SC-SOLIS_8KW_IP66_L_PLUS_HYBRID",
    "websitePrice": 315000,
    "originalPrice": null,
    "brandSlug": "solis",
    "brandName": "Solis",
    "categorySlug": "solar-inverters",
    "featured": false,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "8KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "12000W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.8%",
      "Protection": "IP66"
    },
    "productId": "mpprod_ws1_solis_8kw_ip66_l_plus_hybrid",
    "variantId": "mpvar_ws1_solis_8kw_ip66_l_plus_hybrid",
    "brandId": "mpbrand_ws1_solis",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Solis S6-EH1P 8KW IP66 L Plus Hybrid Inverter",
    "description": "Solis 8KW IP66 rated hybrid inverter with L Plus technology for larger residential and small commercial systems.",
    "tags": [
      "solis",
      "hybrid",
      "8kw",
      "ip66"
    ]
  },
  {
    "slug": "huawei-sun2000-5kw-hybrid",
    "sku": "SC-HUAWEI_SUN2000_5KW_HYBRID",
    "websitePrice": 210000,
    "originalPrice": null,
    "brandSlug": "huawei",
    "brandName": "Huawei",
    "categorySlug": "solar-inverters",
    "featured": true,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "5KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "7500W",
      "BatteryVoltage": "48V",
      "Efficiency": "98.6%",
      "Protection": "IP65",
      "WiFi": "Built-in"
    },
    "productId": "mpprod_ws1_huawei_sun2000_5kw_hybrid",
    "variantId": "mpvar_ws1_huawei_sun2000_5kw_hybrid",
    "brandId": "mpbrand_ws1_huawei",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Huawei SUN2000-5KTL-M1 5KW Hybrid Inverter",
    "description": "Huawei 5KW hybrid inverter with AI-powered energy management, built-in PID recovery, and FusionSolar app for smart monitoring.",
    "tags": [
      "huawei",
      "hybrid",
      "5kw",
      "premium"
    ]
  },
  {
    "slug": "huawei-sun2000-8kw-hybrid",
    "sku": "SC-HUAWEI_SUN2000_8KW_HYBRID",
    "websitePrice": 320000,
    "originalPrice": null,
    "brandSlug": "huawei",
    "brandName": "Huawei",
    "categorySlug": "solar-inverters",
    "featured": false,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "8KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "12000W",
      "Efficiency": "98.6%",
      "Protection": "IP65"
    },
    "productId": "mpprod_ws1_huawei_sun2000_8kw_hybrid",
    "variantId": "mpvar_ws1_huawei_sun2000_8kw_hybrid",
    "brandId": "mpbrand_ws1_huawei",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Huawei SUN2000-8KTL-M1 8KW Hybrid Inverter",
    "description": "Premium 8KW hybrid inverter from Huawei with industry-leading efficiency and smart energy management capabilities.",
    "tags": [
      "huawei",
      "hybrid",
      "8kw",
      "premium"
    ]
  },
  {
    "slug": "inverex-nitrox-10kw-hybrid",
    "sku": "SC-INVEREX_NITROX_10KW_HYBRID",
    "websitePrice": 285000,
    "originalPrice": null,
    "brandSlug": "inverex",
    "brandName": "Inverex",
    "categorySlug": "solar-inverters",
    "featured": false,
    "warranty": "2 Years Official Warranty",
    "specifications": {
      "Power": "10KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "14000W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.5%",
      "Protection": "IP21"
    },
    "productId": "mpprod_ws1_inverex_nitrox_10kw_hybrid",
    "variantId": "mpvar_ws1_inverex_nitrox_10kw_hybrid",
    "brandId": "mpbrand_ws1_inverex",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "Inverex Nitrox 10KW Hybrid Solar Inverter",
    "description": "Inverex Nitrox 10KW hybrid inverter with high PV input, dual MPPT, and robust build quality for large residential and commercial systems.",
    "tags": [
      "inverex",
      "hybrid",
      "10kw",
      "commercial"
    ]
  },
  {
    "slug": "maxpower-suntronic-6kw-hybrid",
    "sku": "SC-MAXPOWER_SUNTRONIC_6KW_HYBRID",
    "websitePrice": 115000,
    "originalPrice": null,
    "brandSlug": "maxpower",
    "brandName": "MaxPower",
    "categorySlug": "solar-inverters",
    "featured": false,
    "warranty": "2 Years Official Warranty",
    "specifications": {
      "Power": "6KW",
      "Type": "Hybrid",
      "MPPT": "Dual MPPT",
      "PVInput": "7000W",
      "BatteryVoltage": "48V",
      "Efficiency": "97.2%",
      "Protection": "IP21"
    },
    "productId": "mpprod_ws1_maxpower_suntronic_6kw_hybrid",
    "variantId": "mpvar_ws1_maxpower_suntronic_6kw_hybrid",
    "brandId": "mpbrand_ws1_maxpower",
    "categoryId": "mpcat_ws1_solar_inverters",
    "title": "MaxPower Suntronic 6KW PV7000 Hybrid Inverter",
    "description": "MaxPower Suntronic 6KW hybrid inverter with PV7000 input, MPPT charge controller, and WiFi monitoring for residential solar systems.",
    "tags": [
      "maxpower",
      "hybrid",
      "6kw",
      "budget"
    ]
  },
  {
    "slug": "longi-himo6-580w-mono",
    "sku": "SC-LONGI_HIMO6_580W_MONO",
    "websitePrice": 18500,
    "originalPrice": null,
    "brandSlug": "longi",
    "brandName": "Longi",
    "categorySlug": "solar-panels",
    "featured": true,
    "warranty": "12 Year Product + 25 Year Performance",
    "specifications": {
      "Power": "580W",
      "Type": "Monocrystalline PERC",
      "Efficiency": "22.3%",
      "Cells": "144 Half-Cut",
      "Dimensions": "2278x1134x35mm",
      "Weight": "28.6kg",
      "Connector": "MC4"
    },
    "productId": "mpprod_ws1_longi_himo6_580w_mono",
    "variantId": "mpvar_ws1_longi_himo6_580w_mono",
    "brandId": "mpbrand_ws1_longi",
    "categoryId": "mpcat_ws1_solar_panels",
    "title": "Longi Hi-MO 6 580W Mono PERC Solar Panel",
    "description": "Longi Hi-MO 6 580W monocrystalline solar panel with PERC technology, offering industry-leading efficiency and 25-year performance warranty.",
    "tags": [
      "longi",
      "580w",
      "mono",
      "tier1",
      "a-grade"
    ]
  },
  {
    "slug": "longi-himo7-600w-ntype",
    "sku": "SC-LONGI_HIMO7_600W_NTYPE",
    "websitePrice": 19500,
    "originalPrice": null,
    "brandSlug": "longi",
    "brandName": "Longi",
    "categorySlug": "solar-panels",
    "featured": true,
    "warranty": "12 Year Product + 30 Year Performance",
    "specifications": {
      "Power": "600W",
      "Type": "N-Type HPBC",
      "Efficiency": "23.2%",
      "Cells": "144 Half-Cut",
      "Dimensions": "2278x1134x35mm",
      "Weight": "29.2kg"
    },
    "productId": "mpprod_ws1_longi_himo7_600w_ntype",
    "variantId": "mpvar_ws1_longi_himo7_600w_ntype",
    "brandId": "mpbrand_ws1_longi",
    "categoryId": "mpcat_ws1_solar_panels",
    "title": "Longi Hi-MO 7 600W N-Type Solar Panel",
    "description": "Latest Longi Hi-MO 7 600W N-Type solar panel with HPBC technology for maximum energy yield and superior low-light performance.",
    "tags": [
      "longi",
      "600w",
      "n-type",
      "premium"
    ]
  },
  {
    "slug": "canadian-solar-hiku7-580w",
    "sku": "SC-CANADIAN_SOLAR_HIKU7_580W",
    "websitePrice": 18000,
    "originalPrice": null,
    "brandSlug": "canadian-solar",
    "brandName": "Canadian Solar",
    "categorySlug": "solar-panels",
    "featured": true,
    "warranty": "12 Year Product + 25 Year Performance",
    "specifications": {
      "Power": "580W",
      "Type": "Monocrystalline PERC",
      "Efficiency": "22.1%",
      "Cells": "144 Half-Cut",
      "Dimensions": "2278x1134x35mm",
      "Weight": "28.8kg"
    },
    "productId": "mpprod_ws1_canadian_solar_hiku7_580w",
    "variantId": "mpvar_ws1_canadian_solar_hiku7_580w",
    "brandId": "mpbrand_ws1_canadian_solar",
    "categoryId": "mpcat_ws1_solar_panels",
    "title": "Canadian Solar HiKu7 CS7L-580MS Mono PERC Panel",
    "description": "Canadian Solar HiKu7 580W mono PERC panel with half-cut cell technology for enhanced shade tolerance and higher energy output.",
    "tags": [
      "canadian-solar",
      "580w",
      "mono",
      "tier1"
    ]
  },
  {
    "slug": "jinko-tiger-neo-580w",
    "sku": "SC-JINKO_TIGER_NEO_580W",
    "websitePrice": 18200,
    "originalPrice": null,
    "brandSlug": "jinko",
    "brandName": "Jinko",
    "categorySlug": "solar-panels",
    "featured": false,
    "warranty": "12 Year Product + 30 Year Performance",
    "specifications": {
      "Power": "580W",
      "Type": "N-Type TOPCon",
      "Efficiency": "22.5%",
      "Cells": "144 Half-Cut",
      "Dimensions": "2278x1134x30mm",
      "Weight": "28.4kg"
    },
    "productId": "mpprod_ws1_jinko_tiger_neo_580w",
    "variantId": "mpvar_ws1_jinko_tiger_neo_580w",
    "brandId": "mpbrand_ws1_jinko",
    "categoryId": "mpcat_ws1_solar_panels",
    "title": "Jinko Tiger Neo 580W N-Type Solar Panel",
    "description": "Jinko Tiger Neo 580W N-Type panel with TOPCon technology delivering exceptional efficiency and temperature coefficient performance.",
    "tags": [
      "jinko",
      "580w",
      "n-type",
      "topcon"
    ]
  },
  {
    "slug": "ja-solar-deepblue-580w",
    "sku": "SC-JA_SOLAR_DEEPBLUE_580W",
    "websitePrice": 17800,
    "originalPrice": null,
    "brandSlug": "ja-solar",
    "brandName": "JA Solar",
    "categorySlug": "solar-panels",
    "featured": false,
    "warranty": "12 Year Product + 25 Year Performance",
    "specifications": {
      "Power": "580W",
      "Type": "Monocrystalline PERC",
      "Efficiency": "22.2%",
      "Cells": "144 Half-Cut",
      "Dimensions": "2278x1134x35mm",
      "Weight": "28.5kg"
    },
    "productId": "mpprod_ws1_ja_solar_deepblue_580w",
    "variantId": "mpvar_ws1_ja_solar_deepblue_580w",
    "brandId": "mpbrand_ws1_ja_solar",
    "categoryId": "mpcat_ws1_solar_panels",
    "title": "JA Solar DeepBlue 4.0 580W Mono PERC Panel",
    "description": "JA Solar DeepBlue 4.0 580W panel with advanced PERC technology, excellent low-light performance, and proven reliability.",
    "tags": [
      "ja-solar",
      "580w",
      "mono",
      "budget-tier1"
    ]
  },
  {
    "slug": "narada-5-12kwh-lithium",
    "sku": "SC-NARADA_5_12KWH_LITHIUM",
    "websitePrice": 245000,
    "originalPrice": null,
    "brandSlug": "narada",
    "brandName": "Narada",
    "categorySlug": "lithium-batteries",
    "featured": true,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Capacity": "5.12kWh",
      "Voltage": "51.2V",
      "Chemistry": "LiFePO4",
      "CycleLife": "6000+ cycles",
      "DoD": "95%",
      "BMS": "Built-in",
      "Stackable": "Yes",
      "Weight": "52kg"
    },
    "productId": "mpprod_ws1_narada_5_12kwh_lithium",
    "variantId": "mpvar_ws1_narada_5_12kwh_lithium",
    "brandId": "mpbrand_ws1_narada",
    "categoryId": "mpcat_ws1_lithium_batteries",
    "title": "Narada 5.12kWh 51.2V LiFePO4 Lithium Battery",
    "description": "Narada 5.12kWh lithium iron phosphate battery with 6000+ cycle life, built-in BMS, and stackable design for solar energy storage.",
    "tags": [
      "narada",
      "5kwh",
      "lithium",
      "lifepo4"
    ]
  },
  {
    "slug": "knox-5-12kwh-lithium",
    "sku": "SC-KNOX_5_12KWH_LITHIUM",
    "websitePrice": 235000,
    "originalPrice": null,
    "brandSlug": "knox",
    "brandName": "Knox",
    "categorySlug": "lithium-batteries",
    "featured": false,
    "warranty": "3 Years Official Warranty",
    "specifications": {
      "Capacity": "5.12kWh",
      "Voltage": "51.2V",
      "Current": "100Ah",
      "Chemistry": "LiFePO4",
      "CycleLife": "6000+ cycles",
      "BMS": "Built-in",
      "Stackable": "Yes"
    },
    "productId": "mpprod_ws1_knox_5_12kwh_lithium",
    "variantId": "mpvar_ws1_knox_5_12kwh_lithium",
    "brandId": "mpbrand_ws1_knox",
    "categoryId": "mpcat_ws1_lithium_batteries",
    "title": "Knox 5.12kWh 100Ah Lithium Battery",
    "description": "Knox 5.12kWh lithium battery with 100Ah capacity, built-in BMS, and parallel expansion capability for residential solar storage.",
    "tags": [
      "knox",
      "5kwh",
      "lithium"
    ]
  },
  {
    "slug": "pylontech-us5000-4-8kwh",
    "sku": "SC-PYLONTECH_US5000_4_8KWH",
    "websitePrice": 265000,
    "originalPrice": null,
    "brandSlug": "pylontech",
    "brandName": "Pylontech",
    "categorySlug": "lithium-batteries",
    "featured": true,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Capacity": "4.8kWh",
      "Voltage": "48V",
      "Chemistry": "LiFePO4",
      "CycleLife": "6000+ cycles",
      "DoD": "95%",
      "BMS": "Built-in",
      "Stackable": "Up to 16 units"
    },
    "productId": "mpprod_ws1_pylontech_us5000_4_8kwh",
    "variantId": "mpvar_ws1_pylontech_us5000_4_8kwh",
    "brandId": "mpbrand_ws1_pylontech",
    "categoryId": "mpcat_ws1_lithium_batteries",
    "title": "Pylontech US5000 4.8kWh Lithium Battery",
    "description": "Pylontech US5000 4.8kWh lithium battery with industry-leading cycle life, modular design, and wide inverter compatibility.",
    "tags": [
      "pylontech",
      "4.8kwh",
      "lithium",
      "premium"
    ]
  },
  {
    "slug": "inverex-lv2-6-lithium",
    "sku": "SC-INVEREX_LV2_6_LITHIUM",
    "websitePrice": 188000,
    "originalPrice": 200000,
    "brandSlug": "inverex",
    "brandName": "Inverex",
    "categorySlug": "lithium-batteries",
    "featured": false,
    "warranty": "2 Years Official Warranty",
    "specifications": {
      "Capacity": "2.6kWh",
      "Voltage": "25.6V",
      "Current": "104Ah",
      "Chemistry": "Lithium-Ion",
      "CycleLife": "4000+ cycles",
      "BMS": "Built-in"
    },
    "productId": "mpprod_ws1_inverex_lv2_6_lithium",
    "variantId": "mpvar_ws1_inverex_lv2_6_lithium",
    "brandId": "mpbrand_ws1_inverex",
    "categoryId": "mpcat_ws1_lithium_batteries",
    "title": "Inverex LV2.6 25.6V 104Ah Lithium-Ion Battery",
    "description": "Inverex LV2.6 compact lithium battery with 2.6kWh capacity, ideal for smaller solar systems and backup power.",
    "tags": [
      "inverex",
      "2.6kwh",
      "lithium",
      "compact"
    ]
  },
  {
    "slug": "fronus-meta-10kw-ongrid",
    "sku": "SC-FRONUS_META_10KW_ONGRID",
    "websitePrice": 165000,
    "originalPrice": null,
    "brandSlug": "fronus",
    "brandName": "Fronus",
    "categorySlug": "on-grid-inverters",
    "featured": true,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "10KW",
      "Type": "On-Grid",
      "MPPT": "Dual MPPT",
      "PVInput": "14000W",
      "Efficiency": "98.2%",
      "Protection": "IP65",
      "NetMetering": "Yes"
    },
    "productId": "mpprod_ws1_fronus_meta_10kw_ongrid",
    "variantId": "mpvar_ws1_fronus_meta_10kw_ongrid",
    "brandId": "mpbrand_ws1_fronus",
    "categoryId": "mpcat_ws1_on_grid_inverters",
    "title": "Fronus Meta 10KW PV14000 Battery Less On-Grid Inverter",
    "description": "Fronus Meta 10KW on-grid inverter designed for net metering systems. Battery-less operation with high PV input for maximum grid export.",
    "tags": [
      "fronus",
      "10kw",
      "on-grid",
      "net-metering"
    ]
  },
  {
    "slug": "solis-6kw-ongrid-string",
    "sku": "SC-SOLIS_6KW_ONGRID_STRING",
    "websitePrice": 145000,
    "originalPrice": null,
    "brandSlug": "solis",
    "brandName": "Solis",
    "categorySlug": "on-grid-inverters",
    "featured": false,
    "warranty": "5 Years Official Warranty",
    "specifications": {
      "Power": "6KW",
      "Type": "On-Grid",
      "MPPT": "Dual MPPT",
      "PVInput": "9000W",
      "Efficiency": "97.8%",
      "Protection": "IP66"
    },
    "productId": "mpprod_ws1_solis_6kw_ongrid_string",
    "variantId": "mpvar_ws1_solis_6kw_ongrid_string",
    "brandId": "mpbrand_ws1_solis",
    "categoryId": "mpcat_ws1_on_grid_inverters",
    "title": "Solis S6-GR1P 6KW On-Grid String Inverter",
    "description": "Solis 6KW on-grid string inverter for residential net metering with high efficiency and reliable grid-tied operation.",
    "tags": [
      "solis",
      "6kw",
      "on-grid",
      "net-metering"
    ]
  },
  {
    "slug": "solar-mounting-structure-per-kw",
    "sku": "SC-SOLAR_MOUNTING_STRUCTURE_PER_KW",
    "websitePrice": 8000,
    "originalPrice": null,
    "brandSlug": "sunchaser",
    "brandName": "SunChaser",
    "categorySlug": "accessories",
    "featured": false,
    "warranty": "10 Years Structural Warranty",
    "specifications": {
      "Material": "Galvanized Steel",
      "Type": "Rooftop/Ground Mount",
      "WindRating": "Up to 150 km/h",
      "Tilt": "Adjustable 10-30°"
    },
    "productId": "mpprod_ws1_solar_mounting_structure_per_kw",
    "variantId": "mpvar_ws1_solar_mounting_structure_per_kw",
    "brandId": "mpbrand_ws1_sunchaser",
    "categoryId": "mpcat_ws1_accessories",
    "title": "Solar Panel Mounting Structure (Per KW)",
    "description": "Heavy-duty galvanized steel solar panel mounting structure. Suitable for rooftop and ground-mount installations. Price per KW.",
    "tags": [
      "mounting",
      "structure",
      "rooftop"
    ]
  },
  {
    "slug": "dc-solar-cable-6mm-per-meter",
    "sku": "SC-DC_SOLAR_CABLE_6MM_PER_METER",
    "websitePrice": 150,
    "originalPrice": null,
    "brandSlug": "generic",
    "brandName": "Generic",
    "categorySlug": "accessories",
    "featured": false,
    "warranty": "N/A",
    "specifications": {
      "Size": "6mm²",
      "Type": "DC Solar Cable",
      "Rating": "1000V DC",
      "Certification": "TUV",
      "UVResistant": "Yes"
    },
    "productId": "mpprod_ws1_dc_solar_cable_6mm_per_meter",
    "variantId": "mpvar_ws1_dc_solar_cable_6mm_per_meter",
    "brandId": "mpbrand_ws1_generic",
    "categoryId": "mpcat_ws1_accessories",
    "title": "DC Solar Cable 6mm² (Per Meter)",
    "description": "UV-resistant 6mm² DC solar cable for connecting solar panels. TUV certified with excellent weather resistance.",
    "tags": [
      "cable",
      "dc",
      "6mm"
    ]
  },
  {
    "slug": "mc4-solar-connectors-pair",
    "sku": "SC-MC4_SOLAR_CONNECTORS_PAIR",
    "websitePrice": 300,
    "originalPrice": null,
    "brandSlug": "generic",
    "brandName": "Generic",
    "categorySlug": "accessories",
    "featured": false,
    "warranty": "N/A",
    "specifications": {
      "Type": "MC4",
      "Rating": "30A / 1000V DC",
      "Protection": "IP67",
      "Material": "PPO + Copper"
    },
    "productId": "mpprod_ws1_mc4_solar_connectors_pair",
    "variantId": "mpvar_ws1_mc4_solar_connectors_pair",
    "brandId": "mpbrand_ws1_generic",
    "categoryId": "mpcat_ws1_accessories",
    "title": "MC4 Solar Connectors (Pair)",
    "description": "High-quality MC4 solar connectors for reliable panel-to-cable connections. IP67 rated and TUV certified.",
    "tags": [
      "mc4",
      "connectors"
    ]
  },
  {
    "slug": "solar-lightning-arrester-dc",
    "sku": "SC-SOLAR_LIGHTNING_ARRESTER_DC",
    "websitePrice": 5000,
    "originalPrice": null,
    "brandSlug": "generic",
    "brandName": "Generic",
    "categorySlug": "accessories",
    "featured": false,
    "warranty": "1 Year Warranty",
    "specifications": {
      "Type": "DC SPD",
      "Rating": "1000V DC",
      "Protection": "Type II",
      "Discharge": "40kA"
    },
    "productId": "mpprod_ws1_solar_lightning_arrester_dc",
    "variantId": "mpvar_ws1_solar_lightning_arrester_dc",
    "brandId": "mpbrand_ws1_generic",
    "categoryId": "mpcat_ws1_accessories",
    "title": "Solar Lightning Arrester DC 1000V",
    "description": "DC surge protection device for solar systems. Protects inverters and panels from lightning and voltage surges.",
    "tags": [
      "lightning",
      "arrester",
      "protection"
    ]
  },
  {
    "slug": "ac-dc-distribution-box",
    "sku": "SC-AC_DC_DISTRIBUTION_BOX",
    "websitePrice": 12000,
    "originalPrice": null,
    "brandSlug": "sunchaser",
    "brandName": "SunChaser",
    "categorySlug": "accessories",
    "featured": false,
    "warranty": "1 Year Warranty",
    "specifications": {
      "Type": "Distribution Box",
      "Includes": "AC+DC Breakers, SPD, MCBs",
      "Material": "Metal Enclosure",
      "Protection": "IP54"
    },
    "productId": "mpprod_ws1_ac_dc_distribution_box",
    "variantId": "mpvar_ws1_ac_dc_distribution_box",
    "brandId": "mpbrand_ws1_sunchaser",
    "categoryId": "mpcat_ws1_accessories",
    "title": "AC/DC Distribution Box Complete",
    "description": "Complete AC/DC distribution box with breakers, surge protection, and proper labeling for solar installations.",
    "tags": [
      "distribution",
      "box",
      "breakers"
    ]
  },
  {
    "slug": "bi-directional-net-meter",
    "sku": "SC-BI_DIRECTIONAL_NET_METER",
    "websitePrice": 15000,
    "originalPrice": null,
    "brandSlug": "generic",
    "brandName": "Generic",
    "categorySlug": "accessories",
    "featured": false,
    "warranty": "2 Years Warranty",
    "specifications": {
      "Type": "Bi-Directional",
      "Phase": "Single/Three Phase",
      "Display": "LCD",
      "Communication": "RS485",
      "Accuracy": "Class 1"
    },
    "productId": "mpprod_ws1_bi_directional_net_meter",
    "variantId": "mpvar_ws1_bi_directional_net_meter",
    "brandId": "mpbrand_ws1_generic",
    "categoryId": "mpcat_ws1_accessories",
    "title": "Bi-Directional Net Metering Meter",
    "description": "Bi-directional energy meter for net metering systems. Records both import and export energy for accurate billing.",
    "tags": [
      "meter",
      "net-metering",
      "bi-directional"
    ]
  },
  {
    "slug": "6kw-complete-hybrid-system",
    "sku": "SC-6KW_COMPLETE_HYBRID_SYSTEM",
    "websitePrice": 850000,
    "originalPrice": 950000,
    "brandSlug": "sunchaser",
    "brandName": "SunChaser",
    "categorySlug": "hybrid-systems",
    "featured": true,
    "warranty": "Component-specific warranty terms confirmed in the final quotation.",
    "specifications": {
      "SystemSize": "6KW",
      "Inverter": "6KW Hybrid",
      "Panels": "10x 580W Tier-1",
      "Battery": "5.12kWh Lithium",
      "Structure": "Included",
      "Cables": "Included",
      "Installation": "Included",
      "MonthlyBillRange": "PKR 15,000-25,000"
    },
    "productId": "mpprod_ws1_6kw_complete_hybrid_system",
    "variantId": "mpvar_ws1_6kw_complete_hybrid_system",
    "brandId": "mpbrand_ws1_sunchaser",
    "categoryId": "mpcat_ws1_hybrid_systems",
    "title": "6KW Complete Hybrid Solar System Package",
    "description": "Complete 6KW hybrid solar system including inverter, panels, battery, mounting structure, cables, and installation. Perfect for 3-4 bedroom homes with 15,000-25,000 PKR monthly bills.",
    "tags": [
      "complete",
      "system",
      "6kw",
      "residential",
      "package"
    ]
  },
  {
    "slug": "10kw-complete-hybrid-system",
    "sku": "SC-10KW_COMPLETE_HYBRID_SYSTEM",
    "websitePrice": 1450000,
    "originalPrice": 1600000,
    "brandSlug": "sunchaser",
    "brandName": "SunChaser",
    "categorySlug": "hybrid-systems",
    "featured": true,
    "warranty": "Component-specific warranty terms confirmed in the final quotation.",
    "specifications": {
      "SystemSize": "10KW",
      "Inverter": "10KW Hybrid",
      "Panels": "17x 580W Tier-1",
      "Battery": "10.24kWh Lithium",
      "Structure": "Included",
      "Cables": "Included",
      "Installation": "Included",
      "MonthlyBillRange": "PKR 25,000-50,000"
    },
    "productId": "mpprod_ws1_10kw_complete_hybrid_system",
    "variantId": "mpvar_ws1_10kw_complete_hybrid_system",
    "brandId": "mpbrand_ws1_sunchaser",
    "categoryId": "mpcat_ws1_hybrid_systems",
    "title": "10KW Complete Hybrid Solar System Package",
    "description": "Complete 10KW hybrid solar system for larger homes and small commercial setups. Includes premium inverter, panels, battery bank, and full installation.",
    "tags": [
      "complete",
      "system",
      "10kw",
      "commercial",
      "package"
    ]
  },
  {
    "slug": "15kw-commercial-solar-system",
    "sku": "SC-15KW_COMMERCIAL_SOLAR_SYSTEM",
    "websitePrice": 2200000,
    "originalPrice": 2500000,
    "brandSlug": "sunchaser",
    "brandName": "SunChaser",
    "categorySlug": "hybrid-systems",
    "featured": false,
    "warranty": "Component-specific warranty terms confirmed in the final quotation.",
    "specifications": {
      "SystemSize": "15KW",
      "Inverter": "15KW Three Phase Hybrid",
      "Panels": "26x 580W Tier-1",
      "Battery": "15.36kWh Lithium",
      "Structure": "Included",
      "Installation": "Included",
      "MonthlyBillRange": "PKR 50,000-100,000"
    },
    "productId": "mpprod_ws1_15kw_commercial_solar_system",
    "variantId": "mpvar_ws1_15kw_commercial_solar_system",
    "brandId": "mpbrand_ws1_sunchaser",
    "categoryId": "mpcat_ws1_hybrid_systems",
    "title": "15KW Commercial Solar System Package",
    "description": "Premium 15KW commercial solar system with three-phase inverter, high-efficiency panels, and industrial-grade battery storage.",
    "tags": [
      "complete",
      "system",
      "15kw",
      "commercial",
      "three-phase"
    ]
  }
] as const;

export const WS1_SEED_SLUGS = WS1_SEED_PRODUCTS.map((p) => p.slug);
export const WS1_SEED_SKUS = WS1_SEED_PRODUCTS.map((p) => p.sku);
export const WS1_SEED_PRODUCT_IDS = WS1_SEED_PRODUCTS.map((p) => p.productId);
export const WS1_SEED_VARIANT_IDS = WS1_SEED_PRODUCTS.map((p) => p.variantId);
export const WS1_SEED_BRAND_IDS = [
  "mpbrand_ws1_canadian_solar",
  "mpbrand_ws1_fronus",
  "mpbrand_ws1_generic",
  "mpbrand_ws1_growatt",
  "mpbrand_ws1_huawei",
  "mpbrand_ws1_inverex",
  "mpbrand_ws1_ja_solar",
  "mpbrand_ws1_jinko",
  "mpbrand_ws1_knox",
  "mpbrand_ws1_longi",
  "mpbrand_ws1_maxpower",
  "mpbrand_ws1_narada",
  "mpbrand_ws1_pylontech",
  "mpbrand_ws1_solis",
  "mpbrand_ws1_sunchaser"
] as const;
export const WS1_SEED_CATEGORY_IDS = [
  "mpcat_ws1_solar_inverters",
  "mpcat_ws1_solar_panels",
  "mpcat_ws1_lithium_batteries",
  "mpcat_ws1_hybrid_systems",
  "mpcat_ws1_accessories",
  "mpcat_ws1_on_grid_inverters"
] as const;
