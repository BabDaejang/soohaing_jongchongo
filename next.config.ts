import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 파싱 라이브러리는 Node 네이티브 동작에 의존하므로 번들 대신 런타임 require로 외부화한다(세션 5).
  serverExternalPackages: ["xlsx", "mammoth", "unpdf"],
  // 예시 생기부 파일 업로드(서버 액션 경유, 세션 8a 확장)가 기본 1MB를 넘을 수 있어 상향.
  // 제출물 원본 업로드는 브라우저→Storage 직행이라 이 제한과 무관(세션 5).
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
