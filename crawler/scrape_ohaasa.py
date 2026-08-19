"""
오하아사(おはよう朝日です) 별자리 운세 크롤러
------------------------------------------------
1. ABC 방송 오하아사 페이지에서 오늘의 12별자리 순위 / 운세 코멘트 / 행운의 아이템을 가져온다.
2. 일본어 텍스트를 한국어로 번역한다. (기본: deep-translator의 GoogleTranslator, 무료/무키)
   - 더 자연스러운 번역이 필요하면 DeepL, Gemini API로 교체 가능 (아래 translate() 함수만 갈아끼우면 됨)
3. 결과를 /data/YYYY-MM-DD.json 과 /data/latest.json 으로 저장한다.
   -> GitHub Actions가 이 파일을 커밋하면, 정적 프론트엔드(index.html)가 fetch로 읽어간다.

주의사항 (반드시 읽어주세요)
------------------------------------------------
- 오하아사 공식 페이지는 방송사 소유 콘텐츠입니다. 원문 그대로 대량 재게시하면 저작권/이용약관 이슈가
  생길 수 있어요. 이 스크립트는 "요약 + 핵심 정보(순위, 키워드, 행운아이템)" 위주로 가공해서 저장하도록
  짜여 있습니다. 상업 서비스로 운영할 계획이라면 방송사에 콘텐츠 사용 관련 문의를 해보는 걸 권장합니다.
- 실제 페이지의 HTML 구조(class명, 태그 구조)는 아사히 방송이 개편할 때마다 바뀔 수 있습니다.
  아래 SELECTORS 딕셔너리 부분만 실제 페이지를 보고 맞춰주시면 됩니다.
  (Chrome 개발자도구 → 우클릭 '검사' → 순위/운세 텍스트가 들어있는 태그의 class를 확인)
"""

import json
import re
import sys
import time
import urllib.parse
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ------------------------------------------------------------------
# 설정
# ------------------------------------------------------------------

TARGET_URL = "https://www.asahi.co.jp/ohaasa/week/horoscope/index.html"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KST = timezone(timedelta(hours=9))

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# 일본어 별자리 -> 한국어 별자리 매핑 (표준 12궁)
ZODIAC_JA_TO_KO = {
    "おひつじ座": "양자리",
    "おうし座": "황소자리",
    "ふたご座": "쌍둥이자리",
    "かに座": "게자리",
    "しし座": "사자자리",
    "おとめ座": "처녀자리",
    "てんびん座": "천칭자리",
    "さそり座": "전갈자리",
    "いて座": "사수자리",
    "やぎ座": "염소자리",
    "みずがめ座": "물병자리",
    "うお座": "물고기자리",
}

# 실제 페이지 구조 (2026-08 기준, asahi.co.jp/ohaasa/week/horoscope)
#   <ul class="oa_horoscope_list">
#     <li class="rank1 scorpio">
#       <dl>
#         <dt><span class="horo_rank">1</span><span class="horo_name ...">さそり座</span></dt>
#         <dd class="horo_txt">코멘트1\t코멘트2\t코멘트3\t\t\t행운의것</dd>
#       </dl>
#     </li>
#     ...
#   </ul>
# dd.horo_txt 안에는 코멘트 여러 줄 + 행운아이템이 전부 탭(\t)으로 구분되어 한 텍스트 노드에 들어있음.
# (빈 탭 필드가 섞여 있어서 파싱 시 빈 문자열은 걸러내야 함)
SELECTORS = {
    "ranking_item": "ul.oa_horoscope_list > li",
    "rank_no": ".horo_rank",
    "sign_name": ".horo_name",
    "txt_block": ".horo_txt",  # 코멘트 + 행운의것이 함께 들어있는 블록
}

# li의 class(rank1 scorpio 등)에 붙는 영문 별자리 슬러그 -> 한국어 매핑 (이중 검증/백업용)
ZODIAC_EN_TO_KO = {
    "aries": "양자리",
    "taurus": "황소자리",
    "gemini": "쌍둥이자리",
    "cancer": "게자리",
    "leo": "사자자리",
    "virgo": "처녀자리",
    "libra": "천칭자리",
    "scorpio": "전갈자리",
    "sagittarius": "사수자리",
    "capricorn": "염소자리",
    "aquarius": "물병자리",
    "pisces": "물고기자리",
}


@dataclass
class SignFortune:
    rank: int
    sign_ja: str
    sign_ko: str
    comment_ja: str
    comment_ko: str
    lucky_item_ja: str
    lucky_item_ko: str
    lucky_item_category: str = "accessory"  # "book" | "accessory" (참고용, 현재 프론트는 미사용)
    coupang_link: str = ""            # 정식 제휴 링크 (상품 링크 또는 딥링크)
    coupang_product_name: str = ""    # 실제 상품명 (검색 성공 시)
    coupang_product_image: str = ""   # 상품 이미지 URL (검색 성공 시)
    coupang_product_price: str = ""   # 상품 가격 (검색 성공 시)


def fetch_html(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def parse_txt_block(raw_text: str) -> tuple[str, str]:
    """dd.horo_txt 안의 탭 구분 텍스트를 (코멘트, 행운의것)으로 분리.
    예: "エネルギッシュに過ごせそう\\t集中力もグンと高まるよ\\t積極的なアクションにツキあり\\t\\t\\tささみ"
        -> 코멘트: "エネルギッシュに過ごせそう 集中力もグンと高まるよ 積極的なアクションにツキあり"
           행운의것: "ささみ"
    빈 탭 필드는 무시하고, 마지막 비어있지 않은 필드를 행운의것으로 취급한다.
    """
    parts = [p.strip() for p in raw_text.split("\t") if p.strip()]
    if len(parts) <= 1:
        # 탭이 사라지고 공백으로 렌더링되는 경우 대비 (연속 공백 2칸 이상을 구분자로 재시도)
        alt_parts = [p.strip() for p in re.split(r"\s{2,}", raw_text) if p.strip()]
        if len(alt_parts) > 1:
            parts = alt_parts
    if not parts:
        return "", ""
    if len(parts) == 1:
        # 행운의것 없이 코멘트만 있는 경우 대비
        return parts[0], ""
    lucky = parts[-1]
    comment = " ".join(parts[:-1])
    return comment, lucky


def guess_lucky_category(lucky_ko: str) -> str:
    """행운의것 한국어 번역 결과를 보고 대략적인 카테고리를 추정 (제휴 링크 버튼 노출용)."""
    book_keywords = ["책", "만화", "소설", "에세이", "문고본", "잡지"]
    if any(k in lucky_ko for k in book_keywords):
        return "book"
    # 나머지는 쿠팡 검색으로 커버(음식/색/소품/인형 등 전부 검색 가능한 상품)
    return "accessory"


def parse_fortunes(html: str) -> list[SignFortune]:
    soup = BeautifulSoup(html, "html.parser")
    items = soup.select(SELECTORS["ranking_item"])

    if not items:
        raise RuntimeError(
            "운세 항목을 찾지 못했습니다. SELECTORS 값을 실제 페이지 구조에 맞게 수정해주세요."
        )

    results: list[SignFortune] = []
    for el in items:
        rank_el = el.select_one(SELECTORS["rank_no"])
        sign_el = el.select_one(SELECTORS["sign_name"])
        txt_el = el.select_one(SELECTORS["txt_block"])

        if not sign_el:
            continue

        sign_ja_raw = sign_el.get_text(strip=True)
        # "おひつじ座" 처럼 별자리명만 추출
        sign_ja = next((k for k in ZODIAC_JA_TO_KO if k in sign_ja_raw), sign_ja_raw)
        sign_ko = ZODIAC_JA_TO_KO.get(sign_ja, sign_ja)

        # li class(rank1 scorpio 등)에 붙은 영문 슬러그로 이중 검증 (다르면 로그만 남기고 진행)
        classes = el.get("class", [])
        en_slug = next((c for c in classes if c in ZODIAC_EN_TO_KO), None)
        if en_slug and ZODIAC_EN_TO_KO[en_slug] != sign_ko:
            print(
                f"[warning] 별자리 불일치: 텍스트={sign_ko} / class={ZODIAC_EN_TO_KO[en_slug]}",
                file=sys.stderr,
            )

        rank_text = rank_el.get_text(strip=True) if rank_el else ""
        rank_num = int(re.sub(r"\D", "", rank_text) or 0)

        raw_txt = txt_el.get_text() if txt_el else ""
        comment_ja, lucky_ja = parse_txt_block(raw_txt)

        results.append(
            SignFortune(
                rank=rank_num,
                sign_ja=sign_ja,
                sign_ko=sign_ko,
                comment_ja=comment_ja,
                comment_ko="",  # translate() 단계에서 채움
                lucky_item_ja=lucky_ja,
                lucky_item_ko="",
            )
        )

    return results


def translate(text: str) -> str:
    """일본어 -> 한국어 번역. 기본은 무료 deep-translator(GoogleTranslator).
    더 자연스러운 결과가 필요하면 DeepL / Gemini API 등으로 교체하세요.
    """
    if not text:
        return ""
    try:
        from deep_translator import GoogleTranslator

        return GoogleTranslator(source="ja", target="ko").translate(text)
    except Exception as e:  # 번역 실패 시 원문 유지 + 로그
        print(f"[translate warning] '{text[:20]}...' 번역 실패: {e}", file=sys.stderr)
        return text


def translate_all(fortunes: list[SignFortune]) -> list[SignFortune]:
    for f in fortunes:
        f.comment_ko = translate(f.comment_ja)
        f.lucky_item_ko = translate(f.lucky_item_ja)
        f.lucky_item_category = guess_lucky_category(f.lucky_item_ko)
        time.sleep(0.3)  # 번역 API 과호출 방지
    return fortunes


def attach_coupang_links(fortunes: list[SignFortune]) -> list[SignFortune]:
    """쿠팡파트너스 오픈 API로 각 별자리의 행운아이템에 실제 상품/정식 제휴 링크를 붙인다.
    COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수가 없으면 조용히 건너뛴다
    (이 경우 프론트엔드가 예전처럼 검색 URL을 즉석에서 만들어 사용함).
    """
    import coupang_partners as cp

    if not cp.is_configured():
        print("[info] 쿠팡파트너스 API 키가 없어 링크 생성을 건너뜁니다.", file=sys.stderr)
        return fortunes

    for f in fortunes:
        keyword = f.lucky_item_ko or f.lucky_item_ja
        if not keyword:
            continue
        try:
            products = cp.search_products(keyword, limit=1)
            if products:
                p = products[0]
                f.coupang_product_name = p.get("productName", "")
                f.coupang_product_image = p.get("productImage", "")
                f.coupang_product_price = str(p.get("productPrice", ""))
                f.coupang_link = p.get("productUrl", "")
            else:
                # 검색 결과가 없으면 검색결과 페이지 자체를 딥링크로 변환
                search_url = (
                    "https://www.coupang.com/np/search?q="
                    + urllib.parse.quote(keyword)
                )
                links = cp.create_deeplink([search_url])
                f.coupang_link = links[0]["shortenUrl"] if links else search_url
        except Exception as e:
            print(f"[coupang warning] '{keyword}' 처리 실패: {e}", file=sys.stderr)
        time.sleep(0.3)  # API 과호출 방지

    return fortunes


def save(fortunes: list[SignFortune]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now(KST).strftime("%Y-%m-%d")

    payload = {
        "date": today,
        "source": TARGET_URL,
        "generated_at": datetime.now(KST).isoformat(),
        "fortunes": [asdict(f) for f in fortunes],
    }

    (DATA_DIR / f"{today}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA_DIR / "latest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"저장 완료: data/{today}.json, data/latest.json ({len(fortunes)}개 별자리)")


def main() -> None:
    html = fetch_html(TARGET_URL)
    fortunes = parse_fortunes(html)
    fortunes = translate_all(fortunes)
    fortunes = attach_coupang_links(fortunes)
    fortunes.sort(key=lambda f: f.rank)
    save(fortunes)


if __name__ == "__main__":
    main()
