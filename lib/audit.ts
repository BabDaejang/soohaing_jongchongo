import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 감사 로그 기록 (DATA_MODEL 14절). insert는 service role 전용이므로 admin 클라이언트로 쓴다.
// detail에 API 키 평문·시크릿을 절대 넣지 않는다 (SPEC 3절, CLAUDE 코딩 규칙).
export type AuditEntry = {
  actorId: string | null;
  action: string; // 예: profile.approve, profile.reject, profile.delete, api_key.set, api_key.delete
  entity: string; // 대상 테이블명
  entityId?: string | null;
  detail?: Record<string, unknown>;
};

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    detail: entry.detail ?? null,
  });
  if (error) {
    // 감사 기록 실패가 주 작업을 되돌리진 않지만, 원인 파악을 위해 로그만 남긴다(키·평문 없음).
    console.error("audit_logs 기록 실패:", error.message);
  }
}
