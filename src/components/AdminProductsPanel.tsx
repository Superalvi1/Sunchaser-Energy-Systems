import React from "react";
import { LayoutGrid } from "lucide-react";
import type { Product } from "../types";

export default function AdminProductsPanel({ products }: { products: Product[] }) {
  return (
    <div className="space-y-4 fade-in-entry">
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-amber-400" />
        <div>
          <h3 className="text-sm font-bold text-neutral-100">Product catalog</h3>
          <p className="text-[11px] text-neutral-500">
            Sales and invoice items · edit full records in Manual Control Panel
          </p>
        </div>
      </div>
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-neutral-500">
                    No products in catalog yet.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="border-b border-neutral-800/60 hover:bg-neutral-800/40">
                    <td className="py-2.5 px-4 font-semibold text-neutral-100">{p.name}</td>
                    <td className="py-2.5 px-4 text-neutral-400">{p.category || "—"}</td>
                    <td className="py-2.5 px-4 text-neutral-400">{p.unit || "pcs"}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-amber-400">
                      {Number(p.price || 0).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
