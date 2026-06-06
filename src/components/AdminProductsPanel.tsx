import React, { useMemo, useState } from "react";
import { Edit3, LayoutGrid, Loader2, Trash2, X } from "lucide-react";
import type { Product } from "../types";
import { deleteCatalogProduct, updateCatalogProduct } from "../services/api";
import AppModal from "./ui/AppModal";
import { useToast } from "../lib/toast";

const CATEGORY_OPTIONS = [
  "Solar Panels",
  "Panels",
  "Inverters",
  "Batteries",
  "Structure",
  "Cables",
  "Protection",
  "Accessories",
  "Net Metering",
  "Civil Works",
];

function productImages(product: Product): string[] {
  return Array.isArray(product.images) ? product.images : [];
}

function specsText(product: Product): string {
  const specs = product.specifications;
  if (!specs) return "";
  if (typeof specs === "string") return specs;
  if (typeof specs === "object" && "description" in specs) {
    return String((specs as { description?: string }).description || "");
  }
  try {
    return JSON.stringify(specs);
  } catch {
    return "";
  }
}

function draftFromProduct(product: Product): Product {
  const images = productImages(product);
  return {
    ...product,
    images: images.length ? images : [""],
    specifications:
      typeof product.specifications === "object" && product.specifications
        ? product.specifications
        : { description: specsText(product) },
    installationRequired: product.installationRequired ?? false,
    serviceRequired: product.serviceRequired ?? false,
  };
}

interface AdminProductsPanelProps {
  products: Product[];
  onRefreshState: () => void | Promise<void>;
}

export default function AdminProductsPanel({ products, onRefreshState }: AdminProductsPanelProps) {
  const toast = useToast();
  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const fromData = products.map((p) => p.category).filter(Boolean);
    return Array.from(new Set([...CATEGORY_OPTIONS, ...fromData]));
  }, [products]);

  const openEdit = (product: Product) => {
    setEditing(product);
    setDraft(draftFromProduct(product));
  };

  const closeEdit = () => {
    setEditing(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const payload: Product = {
        ...draft,
        images: (draft.images || []).filter((url) => String(url || "").trim()),
        specifications: {
          ...(typeof draft.specifications === "object" ? draft.specifications : {}),
          description:
            specsText(draft) ||
            (typeof draft.specifications === "object"
              ? String((draft.specifications as { description?: string }).description || "")
              : ""),
        },
      };
      await updateCatalogProduct(payload);
      toast.success("Product saved.");
      closeEdit();
      await onRefreshState();
    } catch (err: any) {
      toast.error(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (product: Product) => {
    const label = product.sku || product.name;
    if (!window.confirm(`Delete product "${label}" from the catalog?`)) return;
    setDeletingId(product.id);
    try {
      await deleteCatalogProduct(product.id);
      if (editing?.id === product.id) closeEdit();
      toast.success(`Deleted ${label}.`);
      await onRefreshState();
    } catch (err: any) {
      toast.error(err.message || "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4 fade-in-entry">
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-amber-400" />
        <div>
          <h3 className="text-sm font-bold text-neutral-100">Product catalog</h3>
          <p className="text-[11px] text-neutral-500">Sales and invoice items · edit pricing and SKUs here</p>
        </div>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Price</th>
                <th className="py-3 px-4 text-right">Stock</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neutral-500">
                    No products in catalog yet.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="border-b border-neutral-800/60 hover:bg-neutral-800/40">
                    <td className="py-2.5 px-4 font-mono text-indigo-400">{p.sku || p.id}</td>
                    <td className="py-2.5 px-4 font-semibold text-neutral-100">{p.name}</td>
                    <td className="py-2.5 px-4 text-neutral-400">{p.category || "—"}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-amber-400">
                      {Number(p.price || 0).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right text-neutral-400">{p.stock ?? "—"}</td>
                    <td className="py-2.5 px-4 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="inline-flex items-center gap-1 bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded-lg text-amber-400"
                        title="Edit product"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        disabled={deletingId === p.id}
                        className="inline-flex items-center gap-1 bg-neutral-800 hover:bg-rose-950 px-2 py-1 rounded-lg text-rose-400 disabled:opacity-50"
                        title="Delete product"
                      >
                        {deletingId === p.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AppModal open={!!editing && !!draft} onClose={closeEdit} panelClassName="max-w-lg">
          <div className="w-full bg-neutral-900 border border-neutral-700 rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div>
                <p className="text-[10px] font-mono text-amber-500">{draft.sku || draft.id}</p>
                <h4 className="text-sm font-bold text-neutral-100">Edit product</h4>
              </div>
              <button type="button" onClick={closeEdit} className="text-neutral-500 hover:text-neutral-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="text-neutral-500 block mb-1">Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-neutral-500 block mb-1">Category</label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-neutral-500 block mb-1">Brand</label>
                  <input
                    value={draft.brand || ""}
                    onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-neutral-500 block mb-1">SKU</label>
                  <input
                    value={draft.sku || ""}
                    onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 block mb-1">Model</label>
                  <input
                    value={draft.model || ""}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-neutral-500 block mb-1">Price</label>
                  <input
                    type="number"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 block mb-1">Discount</label>
                  <input
                    type="number"
                    value={draft.discount}
                    onChange={(e) => setDraft({ ...draft, discount: Number(e.target.value) })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 block mb-1">Stock</label>
                  <input
                    type="number"
                    value={draft.stock}
                    onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                  />
                </div>
              </div>
              <div>
                <label className="text-neutral-500 block mb-1">Warranty</label>
                <input
                  value={draft.warrantyPeriod || ""}
                  onChange={(e) => setDraft({ ...draft, warrantyPeriod: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-500 block mb-1">Specifications</label>
                <textarea
                  rows={2}
                  value={specsText(draft)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      specifications: { description: e.target.value },
                    })
                  }
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="flex-1 bg-amber-500 text-neutral-950 font-bold py-2 rounded-xl disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-4 bg-neutral-800 text-neutral-200 rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
      </AppModal>
    </div>
  );
}
