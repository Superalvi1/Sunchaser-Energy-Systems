import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "../../types";
import { WEBSITE_CATALOG_SOURCE } from "../../lib/websiteCatalog/allowlist";

interface CatalogProductPickerProps {
  products: Product[];
  valueId: string;
  onSelect: (product: Product | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

function identityBits(product: Product): string {
  const source = product.source === WEBSITE_CATALOG_SOURCE ? "website" : "CRM";
  return [
    product.brand || "—",
    product.model || "",
    product.wattageCapacity || "",
    product.price ? `Rs. ${Number(product.price).toLocaleString()}` : "",
    source,
    product.availability || "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function CatalogProductPicker({
  products,
  valueId,
  onSelect,
  placeholder = "Search website / CRM products",
  disabled,
}: CatalogProductPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = products.find((p) => p.id === valueId) || null;

  // Without this the results list stays open after a tap elsewhere, which on a
  // phone leaves a panel floating over the next field.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter((p) =>
          `${p.brand} ${p.name} ${p.model} ${p.sku} ${p.wattageCapacity || ""} ${p.availability || ""}`
            .toLowerCase()
            .includes(q)
        )
      : products;
    return list.slice(0, 40);
  }, [products, query]);

  return (
    <div ref={rootRef} className="relative">
      <input
        value={open ? query : selected ? `${selected.brand ? selected.brand + " · " : ""}${selected.name}` : query}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 md:min-h-0"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-[60vh] w-full overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950 shadow-xl md:max-h-56">
          <button
            type="button"
            className="flex min-h-[44px] w-full items-center px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-900 md:min-h-0 md:block"
            onClick={() => {
              onSelect(null);
              setQuery("");
              setOpen(false);
            }}
          >
            Clear / custom
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-600">No matching products</p>
          ) : (
            filtered.map((product) => (
              <button
                key={product.id}
                type="button"
                className="block min-h-[48px] w-full border-t border-slate-900 px-3 py-2 text-left hover:bg-slate-900 md:min-h-0"
                onClick={() => {
                  onSelect(product);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div className="text-xs font-semibold text-white truncate">{product.name}</div>
                <div className="text-[10px] text-slate-500">{identityBits(product)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}