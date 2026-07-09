import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { isPurgeEligible } from "@/lib/retention";
import { writeAuditLog } from "@/lib/audit";

type Client = SupabaseClient<Database>;

// Storage 원본 객체 삭제. 같은 storage_path를 참조하는 다른 제출물이 있으면
// (스프레드시트 1파일→다행 공유) 객체는 남긴다. 호출부가 해당 행의 storage_path=null 처리.
export async function deleteOriginalObject(
  supabase: Client,
  storagePath: string,
  exceptSubmissionId: string,
): Promise<void> {
  const { count } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("storage_path", storagePath)
    .neq("id", exceptSubmissionId);
  if ((count ?? 0) > 0) return; // 다른 제출물이 아직 참조 중 → 객체 유지
  const { error } = await supabase.storage.from("originals").remove([storagePath]);
  if (error) throw new Error(`원본 삭제 실패: ${error.message}`);
}

// N일 자동 삭제 배치 (SPEC 5.3 보조 정책). service role(admin) 클라이언트로 실행.
// isPurgeEligible로 승인·경과 자격을 판정 — 미승인 원본은 절대 삭제하지 않는다(INV-5).
export async function purgeExpiredOriginals(admin: Client): Promise<{ purged: number }> {
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, file_retention_days")
    .not("file_retention_days", "is", null);
  if (error) throw new Error(error.message);

  let purged = 0;
  const now = new Date();

  for (const project of projects ?? []) {
    const retention = project.file_retention_days;
    if (retention == null) continue;

    const { data: subs } = await admin
      .from("submissions")
      .select("id, storage_path, extraction_approved_at")
      .eq("project_id", project.id)
      .not("storage_path", "is", null)
      .not("extraction_approved_at", "is", null);

    for (const s of subs ?? []) {
      if (!s.storage_path) continue;
      if (!isPurgeEligible(s.extraction_approved_at, retention, now)) continue;
      await deleteOriginalObject(admin, s.storage_path, s.id);
      await admin.from("submissions").update({ storage_path: null }).eq("id", s.id);
      await writeAuditLog({
        actorId: null,
        action: "original_file.delete",
        entity: "submissions",
        entityId: s.id,
        detail: { reason: "auto_retention", retention_days: retention },
      });
      purged += 1;
    }
  }
  return { purged };
}
