// =====================================================================
// 오하아사 — 오늘의 운세 프론트엔드 로직
// =====================================================================

const STORAGE_KEY = "ohaasa:birth-info";
const DATA_URL = "data/latest.json"; // GitHub Actions가 매일 이 파일을 갱신함

// 제휴 링크 ID — 쿠팡파트너스 아이디 (API 연동 실패/미설정 시에만 쓰이는 '즉석 검색 링크' 백업용)
// 정식 커미션 추적은 crawler/coupang_partners.py(오픈 API)가 만든 data.coupang_link가 우선 사용됩니다.
const COUPANG_PARTNER_TAG = "AF1448867";

// 정확한 만세력이 필요할 때 사용할 KASI 프록시 워커 주소.
// 비워두면(기본값) 아래 간이 계산 함수(getYearAnimal, getDayGanji)만 사용됩니다.
// kasi-proxy 배포 후 이 값을 워커 URL로 채워주세요. 예: "https://ohaasa-kasi-proxy.you.workers.dev"
const KASI_PROXY_URL = "https://ohaasa-kasi-proxy.dbsthdus0713.workers.dev";

// ---------------------------------------------------------------------
// 1. 별자리 계산 (서양 12궁)
// ---------------------------------------------------------------------
const ZODIAC_RANGES = [
  { sign: "염소자리", from: [12, 22], to: [1, 19] },
  { sign: "물병자리", from: [1, 20], to: [2, 18] },
  { sign: "물고기자리", from: [2, 19], to: [3, 20] },
  { sign: "양자리", from: [3, 21], to: [4, 19] },
  { sign: "황소자리", from: [4, 20], to: [5, 20] },
  { sign: "쌍둥이자리", from: [5, 21], to: [6, 21] },
  { sign: "게자리", from: [6, 22], to: [7, 22] },
  { sign: "사자자리", from: [7, 23], to: [8, 22] },
  { sign: "처녀자리", from: [8, 23], to: [9, 22] },
  { sign: "천칭자리", from: [9, 23], to: [10, 22] },
  { sign: "전갈자리", from: [10, 23], to: [11, 21] },
  { sign: "사수자리", from: [11, 22], to: [12, 21] },
];

function getZodiacSign(month, day) {
  for (const z of ZODIAC_RANGES) {
    const [fm, fd] = z.from;
    const [tm, td] = z.to;
    if (fm === tm) {
      if (month === fm && day >= fd && day <= td) return z.sign;
    } else if (fm > tm) {
      // 연말/연초를 걸치는 염소자리
      if ((month === fm && day >= fd) || (month === tm && day <= td)) return z.sign;
    } else {
      if ((month === fm && day >= fd) || (month === tm && day <= td) || (month > fm && month < tm)) {
        return z.sign;
      }
    }
  }
  return "염소자리";
}

// ---------------------------------------------------------------------
// 2. 띠 (12지 동물) — 양력 기준 간이 계산
//    ※ 음력 설날 이전 출생자는 실제 띠와 다를 수 있어요.
// ---------------------------------------------------------------------
const ANIMALS = ["쥐", "소", "호랑이", "토끼", "용", "뱀", "말", "양", "원숭이", "닭", "개", "돼지"];

function getYearAnimal(year) {
  const idx = ((year - 4) % 12 + 12) % 12;
  return ANIMALS[idx] + "띠";
}

// ---------------------------------------------------------------------
// 3. 일주(사주 60갑자) — 간이 계산
//    기준일: 1899-12-22 = 갑자(甲子)일 로 두고 날짜 차이를 60으로 나눈 나머지 사용
//    ※ 자정/자시(23시~01시) 등 시간대 경계는 반영하지 않은 간이 버전입니다.
// ---------------------------------------------------------------------
const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const ANCHOR_DATE = Date.UTC(1899, 11, 22); // 1899-12-22, 갑자일

function getDayGanji(dateObj) {
  const target = Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const diffDays = Math.floor((target - ANCHOR_DATE) / 86400000);
  const idx = ((diffDays % 60) + 60) % 60;
  return STEMS[idx % 10] + BRANCHES[idx % 12];
}

// ---------------------------------------------------------------------
// 3-1. KASI 프록시에서 정확한 만세력 가져오기 (설정된 경우에만 시도)
// ---------------------------------------------------------------------
async function fetchGanjiFromKASI(dateStr) {
  if (!KASI_PROXY_URL) return null;
  try {
    const res = await fetch(`${KASI_PROXY_URL}/ganji?date=${dateStr}`);
    if (!res.ok) throw new Error(`프록시 응답 오류: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data; // { solarDate, lunarDate, yearGanji, dayGanji, raw }
  } catch (err) {
    console.warn("KASI 프록시 호출 실패, 간이 계산으로 대체합니다:", err);
    return null;
  }
}

// ---------------------------------------------------------------------
// 4. 로컬스토리지 저장/불러오기
// ---------------------------------------------------------------------
function saveBirthInfo(date, time) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date, time }));
}
function loadBirthInfo() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// 5. 제휴 링크 생성
// ---------------------------------------------------------------------
function buildCoupangLink(keyword) {
  const q = encodeURIComponent(keyword);
  // ⚠️ 주의: 이건 검색 URL에 파트너스 ID를 붙인 "임시" 방식입니다.
  // 쿠팡파트너스는 공식적으로 link.coupang.com/a/... 형태의 전용 딥링크(파트너스 사이트의
  // "링크 생성기" 또는 오픈 API로 생성)를 통해서만 수수료가 확실히 트래킹됩니다.
  // 이 방식이 실제로 커미션 집계가 되는지 반드시 쿠팡파트너스 대시보드에서 확인해보세요.
  // 정확하게 하려면 쿠팡파트너스 오픈 API(상품 검색 API)로 검색어 -> 실제 딥링크를
  // 서버(크롤러 쪽)에서 미리 생성해 data/latest.json에 함께 저장하는 방식을 추천합니다.
  return `https://www.coupang.com/np/search?component=&q=${q}&channel=${COUPANG_PARTNER_TAG}`;
}

// ---------------------------------------------------------------------
// 6. 렌더링
// ---------------------------------------------------------------------
async function loadFortuneData() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("운세 데이터를 불러오지 못했어요.");
  return res.json();
}

function renderResult(data, mySign, animal, ganji, birthDateObj, isPrecise) {
  const fortunes = data.fortunes || [];
  const mine = fortunes.find((f) => f.sign_ko === mySign);

  document.getElementById("result-section").hidden = false;

  document.getElementById("today-rank-badge").textContent = mine
    ? `오늘 ${mine.rank}위 / 12`
    : "-";
  document.getElementById("result-sign").textContent = mySign;
  document.getElementById("result-meta").textContent =
    `${data.date} 기준 · 오하아사 순위 반영`;
  document.getElementById("result-comment").textContent = mine
    ? mine.comment_ko
    : "오늘의 데이터에서 해당 별자리를 찾지 못했어요. 잠시 후 다시 시도해주세요.";

  // 행운 아이템 + 제휴 링크
  const luckyName = mine ? (mine.coupang_product_name || mine.lucky_item_ko) : "-";
  document.getElementById("lucky-name").textContent = luckyName;

  // 쿠팡 API가 미리 만들어둔 정식 링크가 있으면 그걸 쓰고, 없으면 즉석 검색 링크로 대체
  const coupangEl = document.getElementById("lucky-link-coupang");
  coupangEl.href =
    mine && mine.coupang_link ? mine.coupang_link : buildCoupangLink(mine ? mine.lucky_item_ko : "");

  const imgEl = document.getElementById("lucky-product-image");
  if (mine && mine.coupang_product_image) {
    imgEl.src = mine.coupang_product_image;
    imgEl.hidden = false;
  } else {
    imgEl.hidden = true;
  }

  const priceEl = document.getElementById("lucky-price");
  if (mine && mine.coupang_product_price) {
    const num = Number(mine.coupang_product_price);
    priceEl.textContent = Number.isFinite(num) ? `${num.toLocaleString()}원` : mine.coupang_product_price;
    priceEl.hidden = false;
  } else {
    priceEl.hidden = true;
  }

  // 만세력
  document.getElementById("manse-zodiac").textContent = mySign;
  document.getElementById("manse-animal").textContent = animal;
  document.getElementById("manse-ganji").textContent = ganji + (ganji.endsWith("일") ? "" : "일");

  const noteEl = document.getElementById("manse-note-text");
  if (noteEl) {
    noteEl.textContent = isPrecise
      ? "한국천문연구원(KASI) 데이터를 기반으로 계산했어요."
      : "60갑자 순환을 이용한 간이 계산이에요. 음력설 이전 출생자는 띠가 다를 수 있어요.";
  }

  // 전체 순위
  const list = document.getElementById("ranking-list");
  list.innerHTML = "";
  fortunes
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .forEach((f) => {
      const li = document.createElement("li");
      if (f.sign_ko === mySign) li.classList.add("is-me");
      li.innerHTML = `
        <span class="rk-num">${f.rank}위</span>
        <span class="rk-sign">${f.sign_ko}</span>
        <span class="rk-comment">${f.comment_ko}</span>
      `;
      list.appendChild(li);
    });
}

async function showFortuneFor(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const birthDateObj = new Date(y, m - 1, d);

  const mySign = getZodiacSign(m, d);

  // 1순위: KASI 프록시(정확한 만세력) 시도 -> 실패/미설정 시 간이 계산으로 대체
  const kasi = await fetchGanjiFromKASI(dateStr);
  const animal = kasi?.yearGanji ? animalFromYearGanji(kasi.yearGanji) : getYearAnimal(y);
  const ganji = kasi?.dayGanji || getDayGanji(birthDateObj);
  const isPrecise = Boolean(kasi);

  try {
    const data = await loadFortuneData();
    renderResult(data, mySign, animal, ganji, birthDateObj, isPrecise);
    document.getElementById("result-section").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    alert("운세 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}

// KASI가 돌려주는 "정축(丁丑)" 같은 연간지 문자열에서 띠 동물 이름을 뽑아냄
function animalFromYearGanji(yearGanjiText) {
  const found = BRANCHES.findIndex((b) => yearGanjiText.includes(b));
  if (found === -1) return yearGanjiText; // 매칭 실패 시 원문 그대로 표시
  return ANIMALS[found] + "띠";
}

// ---------------------------------------------------------------------
// 7. 초기화
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("birth-form");
  const dateInput = document.getElementById("birth-date");
  const timeInput = document.getElementById("birth-time");

  const saved = loadBirthInfo();
  if (saved && saved.date) {
    dateInput.value = saved.date;
    if (saved.time) timeInput.value = saved.time;
    showFortuneFor(saved.date);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const date = dateInput.value;
    const time = timeInput.value;
    if (!date) return;
    saveBirthInfo(date, time);
    showFortuneFor(date);
  });
});
