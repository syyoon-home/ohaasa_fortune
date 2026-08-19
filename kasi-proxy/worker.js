/**
 * KASI(한국천문연구원) 음양력정보 API 프록시 — Cloudflare Worker
 * ------------------------------------------------------------------
 * 목적: KASI_SERVICE_KEY(인증키)를 브라우저에 절대 노출하지 않고,
 *       방문자가 생일을 입력할 때마다 이 워커를 거쳐 KASI API를 안전하게 호출한다.
 *
 * 대상 서비스: 음양력 정보제공 서비스 (LrsrCldInfoService) / 오퍼레이션: getLunCalInfo
 *   - "OpenAPI활용가이드_...음양력_정보제공_서비스_v1_1.docx" 기준으로 작성함.
 *   - 응답은 XML만 확인됨(JSON 파라미터 지원 여부 문서에 명시 안 됨) → XML을 직접 파싱한다.
 *
 * 요청 예시:
 *   GET https://<your-worker>.workers.dev/ganji?date=1997-03-14
 *
 * 응답 예시 (성공 시):
 *   {
 *     "solarDate": "1997-03-14",
 *     "lunarDate": "1997-02-06",     // 음력 연-월-일
 *     "isLeapMonth": false,           // 윤달 여부
 *     "yearGanji": "정축(丁丑)",       // 연간지 (세차) — 띠 계산에 사용
 *     "monthGanji": "계묘(癸卯)",      // 월간지 (월건) — 추후 월주 확장용
 *     "dayGanji": "임신(壬申)",        // 일간지 (일진) — 일주 계산에 사용
 *     "weekday": "금"                 // 요일
 *   }
 *
 * 배포 방법
 * ------------------------------------------------------------------
 * 1. Node.js 설치 후: npm install -g wrangler
 * 2. cd kasi-proxy && wrangler login
 * 3. wrangler secret put KASI_SERVICE_KEY
 *    -> 이때 프롬프트에 data.go.kr에서 발급받은 "일반 인증키(Decoding)" 값을 입력
 *       (인코딩된 키 말고 디코딩된 키를 넣어야 함. 아래 코드에서 encodeURIComponent로 다시 인코딩함)
 * 4. wrangler deploy
 * 5. 배포 후 나오는 https://xxxxx.workers.dev 주소를 script.js의 KASI_PROXY_URL에 넣기
 */

const KASI_ENDPOINT =
  "http://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo";

// 요청을 허용할 프론트엔드 도메인 (배포 후 실제 도메인으로 좁혀두는 걸 권장)
const ALLOWED_ORIGIN = "*"; // 예: "https://your-username.github.io"

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...corsHeaders() },
  });
}

// KASI 응답이 XML이라 가벼운 정규식 파서로 필요한 태그만 뽑아낸다.
// (Cloudflare Workers 런타임엔 DOMParser가 없어서 이 방식이 제일 간단하고 안전함)
function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : "";
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/ganji") {
      return jsonResponse({ error: "not found" }, 404);
    }

    const dateStr = url.searchParams.get("date"); // YYYY-MM-DD
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return jsonResponse({ error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" }, 400);
    }
    const [solYear, solMonth, solDay] = dateStr.split("-");

    const serviceKey = env.KASI_SERVICE_KEY; // wrangler secret으로 주입, 코드에 직접 쓰지 않음
    if (!serviceKey) {
      return jsonResponse({ error: "서버에 KASI_SERVICE_KEY가 설정되지 않았습니다." }, 500);
    }

    const apiUrl =
      `${KASI_ENDPOINT}?serviceKey=${serviceKey}` +
      `&solYear=${solYear}&solMonth=${pad2(solMonth)}&solDay=${pad2(solDay)}`;

    try {
      const res = await fetch(apiUrl);
      const xml = await res.text();

      const resultCode = extractTag(xml, "resultCode");
      if (resultCode && resultCode !== "00") {
        const resultMsg = extractTag(xml, "resultMsg");
        return jsonResponse({ error: `KASI API 오류 (${resultCode}): ${resultMsg}`, raw: xml }, 502);
      }

      // resultCode 태그 자체가 없는 경우 (인증 실패 등은 다른 XML 포맷으로 옴: <cmmMsgHeader>)
      const errMsg = extractTag(xml, "errMsg");
      if (errMsg) {
        const authMsg = extractTag(xml, "returnAuthMsg");
        return jsonResponse({ error: `KASI 인증 오류: ${errMsg} (${authMsg})`, raw: xml }, 502);
      }

      const lunYear = extractTag(xml, "lunYear");
      const lunMonth = extractTag(xml, "lunMonth");
      const lunDay = extractTag(xml, "lunDay");

      if (!lunYear) {
        return jsonResponse({ error: "KASI 응답에 데이터가 없습니다.", raw: xml }, 502);
      }

      return jsonResponse({
        solarDate: dateStr,
        lunarDate: `${lunYear}-${pad2(lunMonth)}-${pad2(lunDay)}`,
        isLeapMonth: extractTag(xml, "lunLeapmonth") === "윤",
        yearGanji: extractTag(xml, "lunSecha"), // 연간지 (띠 계산용)
        monthGanji: extractTag(xml, "lunWolgeon"), // 월간지 (추후 월주 확장용)
        dayGanji: extractTag(xml, "lunIljin"), // 일간지 (일주 계산용)
        weekday: extractTag(xml, "solWeek"),
      });
    } catch (e) {
      return jsonResponse({ error: `KASI API 호출 실패: ${e.message}` }, 502);
    }
  },
};
