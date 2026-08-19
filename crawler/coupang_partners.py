"""
쿠팡파트너스 오픈 API 연동 모듈
------------------------------------------------
1. 상품검색 API  : 키워드로 실제 쿠팡 상품(제목/이미지/가격/정식 제휴 링크)을 가져온다.
2. 딥링크 생성 API: 일반 쿠팡 URL(검색결과 페이지 등)을 커미션 추적이 되는 단축 링크로 변환한다.
   -> 상품검색에서 결과가 없을 때 백업으로 사용.

절대 지키세요
------------------------------------------------
- ACCESS KEY / SECRET KEY는 절대 프론트엔드(JS, index.html 등)에 넣지 마세요.
  이 모듈은 GitHub Actions 같은 서버 환경에서만 실행되고, 그 결과(상품명/이미지/링크)만
  data/latest.json에 저장되어 프론트엔드로 전달됩니다. 키 자체는 절대 노출되지 않아요.
- 환경변수 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 로 주입받습니다.
  로컬 테스트 시: export COUPANG_ACCESS_KEY=... / export COUPANG_SECRET_KEY=...
  GitHub Actions: 저장소 Settings > Secrets and variables > Actions 에 등록.

발급 방법
------------------------------------------------
1. https://partners.coupang.com 가입 및 심사 통과
2. 마이페이지 > Open API 메뉴에서 ACCESS KEY / SECRET KEY 발급

주의: 쿠팡 측 API 스펙/정책은 사전 공지 없이 바뀔 수 있습니다. 호출이 계속 실패하면
파트너스 사이트의 최신 Open API 문서를 다시 확인해주세요.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DOMAIN = "https://api-gateway.coupang.com"
SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search"
DEEPLINK_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink"

ACCESS_KEY = os.environ.get("COUPANG_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("COUPANG_SECRET_KEY", "")


def is_configured() -> bool:
    return bool(ACCESS_KEY and SECRET_KEY)


def _signed_headers(method: str, path_with_query: str) -> dict:
    if "?" in path_with_query:
        path, query = path_with_query.split("?", 1)
    else:
        path, query = path_with_query, ""

    now = time.gmtime()
    datetime_gmt = time.strftime("%y%m%d", now) + "T" + time.strftime("%H%M%S", now) + "Z"
    message = datetime_gmt + method + path + query
    signature = hmac.new(SECRET_KEY.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"CEA algorithm=HmacSHA256, access-key={ACCESS_KEY}, "
        f"signed-date={datetime_gmt}, signature={signature}"
    )
    return {
        "Authorization": authorization,
        "Content-Type": "application/json;charset=UTF-8",
    }


def _request(method: str, path: str, query: dict | None = None, body: dict | None = None) -> dict:
    if not is_configured():
        raise RuntimeError(
            "COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수가 설정되지 않았습니다. "
            "쿠팡파트너스 API 연동을 원하지 않으면 이 함수를 호출하지 않아도 됩니다."
        )

    query_str = urllib.parse.urlencode(query, doseq=True) if query else ""
    path_with_query = f"{path}?{query_str}" if query_str else path
    url = DOMAIN + path_with_query

    headers = _signed_headers(method, path_with_query)
    data = json.dumps(body).encode("utf-8") if body is not None else None

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"쿠팡 API 호출 실패 ({e.code}): {detail}") from e


def search_products(keyword: str, limit: int = 1) -> list[dict]:
    """키워드로 실제 쿠팡 상품(제목/가격/이미지/정식 제휴 링크)을 가져온다.

    반환 항목 예시 키: productName, productPrice, productImage, productUrl, isRocket, isFreeShipping
    (필드명은 쿠팡 응답 스펙에 따름. 실제 응답을 한 번 print해서 확인해보는 걸 권장.)
    """
    result = _request("GET", SEARCH_PATH, query={"keyword": keyword, "limit": limit})
    return result.get("data", {}).get("productData", []) or []


def create_deeplink(urls: list[str]) -> list[dict]:
    """일반 쿠팡 URL을 커미션 추적이 되는 단축 링크(link.coupang.com/...)로 변환한다."""
    result = _request("POST", DEEPLINK_PATH, body={"coupangUrls": urls})
    return result.get("data", []) or []


if __name__ == "__main__":
    # 단독 실행 시 간단 테스트: python coupang_partners.py 케이워드
    keyword = sys.argv[1] if len(sys.argv) > 1 else "닭가슴살"
    print(f"'{keyword}' 검색 결과:")
    print(json.dumps(search_products(keyword, limit=3), ensure_ascii=False, indent=2))
