import React, { useCallback, useRef, useState } from "react";
import { CheckCircle2, FileText, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import type { User } from "../types";
import { uploadAdminCustomerDocumentWithProgress } from "../services/api";
import {
  CUSTOMER_DOCUMENT_ACCEPT,
  formatDocumentSize,
  isImageMime,
  readFileAsDataUrl,
  validateCustomerDocumentFile,
} from "../lib/customerDocumentUpload";

interface CustomerDocumentUploaderProps {
  staffUser: User;
  customerId: string;
  documentType: string;
  title?: string;
  projectId?: string;
  visibleToCustomer?: boolean;
  internalOnly?: boolean;
  notes?: string;
  disabled?: boolean;
  onSuccess?: (doc: Record<string, unknown>) => void;
}

export default function CustomerDocumentUploader({
  staffUser,
  customerId,
  documentType,
  title,
  projectId,
  visibleToCustomer = true,
  internalOnly = false,
  notes,
  disabled,
  onSuccess,
}: CustomerDocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetSelection = useCallback(() => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setProgress(0);
    setError(null);
  }, [previewUrl]);

  const uploadFile = async (picked: File) => {
    const validationError = validateCustomerDocumentFile(picked);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!customerId.trim()) {
      setError("Customer ID is required before uploading.");
      return;
    }

    setError(null);
    setSuccess(null);
    setFile(picked);
    setUploading(true);
    setProgress(0);

    if (isImageMime(picked.type)) {
      setPreviewUrl(URL.createObjectURL(picked));
    } else {
      setPreviewUrl(null);
    }

    try {
      const base64Data = await readFileAsDataUrl(picked, setProgress);
      const doc = await uploadAdminCustomerDocumentWithProgress(
        staffUser,
        {
          customerId: customerId.trim(),
          base64Data,
          fileName: picked.name,
          mimeType: picked.type || undefined,
          documentType,
          title: title?.trim() || picked.name,
          visibleToCustomer: internalOnly ? false : visibleToCustomer,
          internalOnly,
          notes,
          projectId: projectId?.trim() || undefined,
        },
        (pct) => setProgress(Math.max(pct, 46))
      );
      setProgress(100);
      setSuccess(`"${doc.title || picked.name}" uploaded successfully.`);
      onSuccess?.(doc);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      resetSelection();
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const picked = e.dataTransfer.files?.[0];
    if (picked) void uploadFile(picked);
  };

  const canInteract = !disabled && !uploading && !!customerId.trim();

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (canInteract) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => canInteract && inputRef.current?.click()}
        className={`md:col-span-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-amber-400 bg-amber-500/10"
            : "border-slate-700 bg-slate-950/50 hover:border-slate-600"
        } ${!canInteract ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <Upload className="h-8 w-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-200">Drag and drop a file here</p>
        <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG, or DOCX · max 25 MB</p>
        <button
          type="button"
          disabled={!canInteract}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white"
        >
          Choose File
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={CUSTOMER_DOCUMENT_ACCEPT}
          className="hidden"
          disabled={!canInteract}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void uploadFile(picked);
            e.target.value = "";
          }}
        />
      </div>

      {!customerId.trim() && (
        <p className="text-xs text-slate-500 font-mono">Enter a Customer ID to enable upload.</p>
      )}

      {file && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex items-start gap-3">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-14 w-14 rounded-lg object-cover border border-slate-700" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-amber-500/10">
              {file.type.startsWith("image/") ? (
                <ImageIcon className="h-6 w-6 text-amber-400" />
              ) : (
                <FileText className="h-6 w-6 text-amber-400" />
              )}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{file.name}</p>
            <p className="text-xs text-slate-500">{formatDocumentSize(file.size)}</p>
            {uploading && (
              <div className="mt-2">
                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">{progress}%</p>
              </div>
            )}
          </div>
          {!uploading && (
            <button type="button" onClick={resetSelection} className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
          {uploading && <Loader2 className="h-5 w-5 text-amber-400 animate-spin shrink-0" />}
        </div>
      )}

      {success && (
        <p className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </p>
      )}
      {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
    </div>
  );
}
