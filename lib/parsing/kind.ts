// 파일 종류 판정 (순수, 클라이언트에서도 사용 가능 — server-only 아님).
export type FileKind = "spreadsheet" | "docx" | "pdf" | "image" | "unknown";

export function fileKind(filename: string, mimeType?: string): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "spreadsheet";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return "unknown";
}
