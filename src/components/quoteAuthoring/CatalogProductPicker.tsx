import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "../../types";
import { WEBSITE_CATALOG_SOURCE } from "../../lib/websiteCatalog/allowlist";
import { useOverlayBackClose } from "../../lib/useOverlayBackClose";

interface CatalogProductPickerProps {
  products: Product[];
  valueId: string;
  onSelect: (product: Product | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Runtime website rows are untrusted. Keep objects/arrays out of React children and form state. */
export function safeCatalogText(value: unknown, depth = 0): string {
  if (value == null || depth > 5) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCatalogText(item, depth + 1)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "label", "name", "text", "title", "displayValue"]) {
      if (!(key in record)) continue;
      const candidate = safeCatalogText(record[key], depth + 1);
      if (candidate) return candidate;
    }
    return Object.values(record).map((item) => safeCatalogText(item, depth + 1)).filter(Boolean).slice(0, 4).join(", ");
  }
  return "";
}

function safeCatalogNumber(value: unknown): number {
  const direct = typeof value === "object" && value != null ? safeCatalogText(value) : value;
  const parsed = Number(direct);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sanitizeCatalogProduct(product: Product): Product {
  const runtime = product as unknown as Record<string, unknown>;
  const rawSpecs = runtime.specifications && typeof runtime.specifications === "object" && !Array.isArray(runtime.specifications)
    ? (runtime.specifications as Record<string, unknown>)
    : {};
  const specifications = Object.fromEntries(Object.entries(rawSpecs).map(([key, value]) => [key, safeCatalogText(value)]));
  const safe = {
    ...product,
    id: safeCatalogText(runtime.id) || String(product.id || ""),
    name: safeCatalogText(runtime.name) || "Unnamed product",
    brand: safeCatalogText(runtime.brand),
    model: safeCatalogText(runtime.model),
    sku: safeCatalogText(runtime.sku),
    warrantyPeriod: safeCatalogText(runtime.warrantyPeriod),
    availability: safeCatalogText(runtime.availability),
    category: safeCatalogText(runtime.category),
    price: safeCatalogNumber(runtime.price),
    specifications,
  } as Product & { wattageCapacity?: string };
  if ("wattageCapacity" in runtime) safe.wattageCapacity = safeCatalogText(runtime.wattageCapacity);
  return safe;
}

function identityBits(product: Product): string {
  const runtime = product as Product & { wattageCapacity?: unknown };
  const source = product.source === WEBSITE_CATALOG_SOURCE ? "website" : "CRM";
  const price = safeCatalogNumber(product.price);
  return [safeCatalogText(product.brand) || "—", safeCatalogText(product.model), safeCatalogText(runtime.wattageCapacity), price > 0 ? `Rs. ${price.toLocaleString()}` : "", source, safeCatalogText(product.availability)].filter(Boolean).join(" · ");
}

export default function CatalogProductPicker({ products, valueId, onSelect, placeholder = "Search website / CRM products", disabled }: CatalogProductPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRaw = products.find((p) => safeCatalogText(p.id) === valueId) || null;
  const selected = selectedRaw ? sanitizeCatalogProduct(selectedRaw) : null;
  const closePicker = () => { setOpen(false); setQuery(""); };
  useOverlayBackClose(open, closePicker);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePicker();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? products.filter((p) => {
      const runtime = p as Product & { wattageCapacity?: unknown };
      const haystack = [safeCatalogText(p.brand), safeCatalogText(p.name), safeCatalogText(p.model), safeCatalogText(p.sku), safeCatalogText(runtime.wattageCapacity), safeCatalogText(p.availability)].join(" ").toLowerCase();
      return haystack.includes(q);
    }) : products;
    return list.slice(0, 40);
  }, [products, query]);

  return (
    <div ref={rootRef} className="relative">
      <input
        value={open ? query : selected ? `${selected.brand ? selected.brand + " · " : ""}${selected.name}` : query}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 md:min-h-0"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-[60vh] w-full overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950 shadow-xl md:max-h-56">
          <button type="button" className="flex min-h-[44px] w-full items-center px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-900 md:min-h-0 md:block" onClick={() => { onSelect(null); closePicker(); }}>
            Clear / custom
          </button>
          {filtered.length === 0 ? <p className="px-3 py-2 text-xs text-slate-600">No matching products</p> : filtered.map((rawProduct) => {
            const product = sanitizeCatalogProduct(rawProduct);
            return (
              <button key={product.id || safeCatalogText(rawProduct.id)} type="button" className="block min-h-[48px] w-full border-t border-slate-900 px-3 py-2 text-left hover:bg-slate-900 md:min-h-0" onClick={() => { onSelect(product); closePicker(); }}>
                <div className="truncate text-xs font-semibold text-white">{product.name}</div>
                <div className="text-[10px] text-slate-500">{identityBits(product)}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
