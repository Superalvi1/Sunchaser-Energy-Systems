import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import {
  buildSolarProduct,
  createInMemoryProductCatalog,
  createSolarProduct,
  InMemoryProductCatalog,
  isSolarProductCategory,
  isSolarProductUnit,
  requireActiveProduct,
  validateSolarProduct,
} from "./ProductCatalog.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("isSolarProductCategory accepts panel", isSolarProductCategory("panel"));
check("isSolarProductCategory accepts dc_cable", isSolarProductCategory("dc_cable"));
check("isSolarProductCategory rejects unknown", !isSolarProductCategory("widget"));

check("isSolarProductUnit accepts piece", isSolarProductUnit("piece"));
check("isSolarProductUnit rejects unknown", !isSolarProductUnit("gallon"));

check("valid product passes validation", validateSolarProduct(buildSolarProduct()).ok);
check("valid product trims id", (() => {
  const r = validateSolarProduct(buildSolarProduct({ id: " p1 " }));
  return r.ok && r.product.id === "p1";
})());

check("missing id rejected", !validateSolarProduct(buildSolarProduct({ id: "" })).ok);
check("invalid category rejected", !validateSolarProduct(buildSolarProduct({ category: "not-a-category" as never })).ok);
check("missing name rejected", !validateSolarProduct(buildSolarProduct({ name: "" })).ok);
check("missing brand rejected", !validateSolarProduct(buildSolarProduct({ brand: "" })).ok);
check("invalid unit rejected", !validateSolarProduct(buildSolarProduct({ unit: "gallon" as never })).ok);
check("negative unitCost rejected", !validateSolarProduct(buildSolarProduct({ unitCost: -1 })).ok);
check("negative unitPrice rejected", !validateSolarProduct(buildSolarProduct({ unitPrice: -1 })).ok);
check("non-object specs rejected", !validateSolarProduct(buildSolarProduct({ specs: null as never })).ok);
check("non-boolean active rejected", !validateSolarProduct(buildSolarProduct({ active: "yes" as never })).ok);
check("zero unitCost is valid (free/bundled item)", validateSolarProduct(buildSolarProduct({ unitCost: 0 })).ok);

check("createSolarProduct returns product for valid input", createSolarProduct(buildSolarProduct()).id === "panel-longi-550");
check(
  "createSolarProduct throws QuotationEngineError for invalid input",
  (() => {
    try {
      createSolarProduct(buildSolarProduct({ name: "" }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "product_catalog";
    }
  })()
);

check("createInMemoryProductCatalog returns an InMemoryProductCatalog", createInMemoryProductCatalog() instanceof InMemoryProductCatalog);
check("new catalog is empty", createInMemoryProductCatalog().size() === 0);

check("register + get round-trips", (() => {
  const catalog = createInMemoryProductCatalog();
  const product = buildSolarProduct();
  catalog.register(product);
  return catalog.get(product.id)?.id === product.id;
})());

check("get returns null for unknown id", createInMemoryProductCatalog().get("missing") === null);

check("register increments size", (() => {
  const catalog = createInMemoryProductCatalog();
  catalog.register(buildSolarProduct({ id: "p1" }));
  return catalog.size() === 1;
})());

check("register overwrites an existing id without growing size", (() => {
  const catalog = createInMemoryProductCatalog();
  catalog.register(buildSolarProduct({ id: "p1", name: "Old" }));
  catalog.register(buildSolarProduct({ id: "p1", name: "New" }));
  return catalog.size() === 1 && catalog.get("p1")?.name === "New";
})());

check("listByCategory returns only matching, active products", (() => {
  const catalog = createInMemoryProductCatalog();
  catalog.register(buildSolarProduct({ id: "p1", category: "panel" }));
  catalog.register(buildSolarProduct({ id: "p2", category: "inverter", name: "Inv" }));
  return catalog.listByCategory("panel").length === 1 && catalog.listByCategory("panel")[0].id === "p1";
})());

check("listByCategory excludes inactive products", (() => {
  const catalog = createInMemoryProductCatalog();
  catalog.register(buildSolarProduct({ id: "p1", category: "panel", active: false }));
  return catalog.listByCategory("panel").length === 0;
})());

check("listByCategory returns sorted by id", (() => {
  const catalog = createInMemoryProductCatalog();
  catalog.register(buildSolarProduct({ id: "p2", category: "panel" }));
  catalog.register(buildSolarProduct({ id: "p1", category: "panel" }));
  return catalog.listByCategory("panel").map((p) => p.id).join(",") === "p1,p2";
})());

check("listActive excludes inactive products", (() => {
  const catalog = createInMemoryProductCatalog();
  catalog.register(buildSolarProduct({ id: "p1", active: true }));
  catalog.register(buildSolarProduct({ id: "p2", active: false }));
  return catalog.listActive().length === 1;
})());

check(
  "requireActiveProduct returns the product when found and active",
  requireActiveProduct(
    (() => {
      const c = createInMemoryProductCatalog();
      c.register(buildSolarProduct({ id: "p1" }));
      return c;
    })(),
    "p1"
  ).id === "p1"
);

check(
  "requireActiveProduct throws QuotationEngineError when missing",
  (() => {
    try {
      requireActiveProduct(createInMemoryProductCatalog(), "missing");
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "product_catalog";
    }
  })()
);

check(
  "requireActiveProduct throws when the product is inactive",
  (() => {
    const catalog = createInMemoryProductCatalog();
    catalog.register(buildSolarProduct({ id: "p1", active: false }));
    try {
      requireActiveProduct(catalog, "p1");
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

console.log(`\nProductCatalog tests: ${pass} passed`);
