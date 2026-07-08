import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 파싱 라이브러리는 Node 네이티브 동작에 의존하므로 번들 대신 런타임 require로 외부화한다(세션 5).
  serverExternalPackages: ["xlsx", "mammoth", "unpdf"],
};

export default nextConfig;
