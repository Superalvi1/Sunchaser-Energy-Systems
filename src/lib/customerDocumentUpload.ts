export const CUSTOMER_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export const CUSTOMER_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function resolveCustomerDocumentMime(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
  return EXT_TO_MIME[ext] || null;
}

export function validateCustomerDocumentFile(file: File): string | null {
  if (file.size > CUSTOMER_DOCUMENT_MAX_BYTES) {
    return "File exceeds the 25 MB limit.";
  }
  if (!resolveCustomerDocumentMime(file)) {
    return "Only PDF, JPG, PNG, and DOCX files are allowed.";
  }
  return null;
}

export function readFileAsDataUrl(
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 45));
      }
    };
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function isImageMime(mime?: string | null) {
  return !!mime && mime.startsWith("image/");
}

export function formatDocumentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
