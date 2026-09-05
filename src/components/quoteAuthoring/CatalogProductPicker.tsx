import React, { useMemo, useState } from "react";
import type { Product } from "../../types";

interface CatalogProductPickerProps {
  products: Product[];
  valueId: string;
  onSelect: (product: Product | null) => void;
  placeholder?: string;
  disabled?: boolean;
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
  const selected = products.find((p) => p.id === valueId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter((p) =>
          `${p.brand} ${p.name} ${p.model} ${p.sku}`.toLowerCase().includes(q)
        )
      : products;
    return list.slice(0, 40);
  }, [products, query]);

  return (
    <div className="relative">
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
        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-900"
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
                className="block w-full border-t border-slate-900 px-3 py-2 text-left hover:bg-slate-900"
                onClick={() => {
                  onSelect(product);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div className="text-xs font-semibold text-white truncate">{product.name}</div>
                <div className="text-[10px] text-slate-500">
                  {product.brand || "—"}
                  {product.source === "sunchaser_website" ? " · website" : " · CRM"}
                  {product.price ? ` · Rs. ${Number(product.price).toLocaleString()}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
