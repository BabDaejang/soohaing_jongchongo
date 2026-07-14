// LLM HTTP 에러 — 프로바이더 HTTP 오류의 status 코드를 보존한다 (리팩토링 3 배치 1).
// 기존 catch 경로는 `instanceof Error`를 쓰므로 무영향(LLMHttpError extends Error).
// retryable 판정(status 429·503·529)은 서버 액션이 수행한다(배치 2·3).

export class LLMHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LLMHttpError";
  }
}
