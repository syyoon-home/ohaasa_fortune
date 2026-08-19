# 오하아사 — 오늘의 별자리 운세 (한국어)

일본 ABC 아사히방송 **오하아사(おはよう朝日です)** 별자리 운세를 매일 새벽에 가져와
한국어로 번역하고, 생일을 입력하면 내 운세 + 만세력 간이 정보 + 행운 아이템 제휴 링크까지
한 번에 보여주는 정적 웹 서비스입니다.

```
ohaasa-fortune/
├── index.html          # 메인 페이지 (생일 입력 → 오늘의 운세)
├── columns.html         # 12별자리 성격/궁합 칼럼
├── style.css
├── script.js             # 별자리·띠·일주 계산 + 데이터 렌더링
├── data/
│   └── latest.json       # 크롤러가 매일 갱신하는 오늘의 운세 데이터 (샘플 포함)
├── crawler/
│   ├── scrape_ohaasa.py  # 크롤링 + 번역 스크립트
│   └── requirements.txt
└── .github/workflows/daily-crawl.yml   # 매일 아침 자동 실행
```

## 1. 로컬에서 미리보기

서버 없이 `index.html`을 그냥 열면 `fetch("data/latest.json")`이 브라우저 보안 정책(CORS)에
막힐 수 있어요. 아래처럼 간단한 로컬 서버로 열어주세요.

```bash
cd ohaasa-fortune
python -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

## 2. 무료 배포: GitHub Pages + GitHub Actions

1. 이 폴더를 GitHub 저장소로 push 합니다.
2. 저장소 **Settings → Pages**에서 배포 브랜치를 `main`(또는 `gh-pages`) / 루트로 지정합니다.
3. **Settings → Actions → General → Workflow permissions**에서
   "Read and write permissions"를 켜주세요. (크롤러가 `data/*.json`을 커밋하려면 필요합니다.)
4. `.github/workflows/daily-crawl.yml`이 매일 **KST 오전 7시**에 자동 실행되어
   `crawler/scrape_ohaasa.py`를 돌리고, 결과를 `data/latest.json`으로 커밋합니다.
   - `workflow_dispatch`가 켜져 있어서 Actions 탭에서 수동 실행도 가능합니다.

## 3. 크롤러 실제 동작시키기 전에 꼭 확인할 것

`crawler/scrape_ohaasa.py`의 `SELECTORS` 딕셔너리는 **예시 값**입니다.
실제 오하아사 페이지를 크롬 개발자도구(F12)로 열어서,
순위/별자리명/코멘트/행운아이템이 들어있는 태그의 class를 확인하고
`SELECTORS` 값을 실제 구조에 맞게 바꿔주세요. 방송사가 페이지를 개편하면
이 부분만 다시 맞춰주면 됩니다.

번역은 기본적으로 무료 `deep-translator`(구글 번역 기반)를 사용합니다.
더 자연스러운 번역이 필요하면 `translate()` 함수만 DeepL API나 Gemini API 호출로
바꿔치기하면 됩니다.

> **저작권 관련 참고**: 오하아사 콘텐츠는 방송사 소유입니다. 이 스크립트는 원문 전체를
> 그대로 복제하지 않고 순위·핵심 코멘트·행운아이템 위주로 요약해 저장하도록 설계했지만,
> 상업적으로 운영할 계획이라면 방송사 측에 콘텐츠 사용 관련 문의를 해보시는 걸 권장해요.

## 4. 수익화 연결하기

### 구글 애드센스
`index.html`의 `<div class="ad-placeholder">` 부분을 애드센스에서 발급받은
`<ins class="adsbygoogle">` 스니펫으로 교체하세요.

### 쿠팡파트너스 제휴 (오픈 API 연동 — 권장)

`crawler/coupang_partners.py`가 쿠팡파트너스 오픈 API를 호출해서, 매일 크롤링 시점에
행운아이템 키워드로 **실제 상품(제목/이미지/가격/정식 제휴 링크)**을 검색해
`data/latest.json`에 함께 저장합니다. 프론트엔드는 그 값을 그대로 보여주기만 하고,
API 키는 절대 프론트엔드에 노출되지 않습니다.

**설정 방법**
1. https://partners.coupang.com 가입 → 심사 통과
2. 마이페이지 > Open API 메뉴에서 **ACCESS KEY / SECRET KEY** 발급
3. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**에서
   아래 두 개를 등록합니다.
   - `COUPANG_ACCESS_KEY`
   - `COUPANG_SECRET_KEY`
4. `.github/workflows/daily-crawl.yml`은 이미 이 두 Secret을 크롤러 실행 시 환경변수로
   넘기도록 설정되어 있어서, 추가 작업 없이 바로 동작합니다.

**로컬에서 테스트하고 싶다면**
```bash
export COUPANG_ACCESS_KEY="발급받은 값"
export COUPANG_SECRET_KEY="발급받은 값"
cd crawler
python coupang_partners.py 닭가슴살   # 검색 결과 JSON이 콘솔에 출력됨
```

**API 키가 없어도 괜찮아요.** `COUPANG_ACCESS_KEY`/`COUPANG_SECRET_KEY`가 설정되지 않으면
크롤러는 이 단계를 조용히 건너뛰고, 프론트엔드(`script.js`)가 예전처럼 검색 URL을
즉석에서 만들어 보여줍니다 (`COUPANG_PARTNER_TAG` 값 사용, 정식 커미션 트래킹은 보장되지 않음).

**참고**
- 상품검색 API에서 결과가 없는 키워드는 검색결과 페이지 자체를 딥링크 API로 변환해서 사용합니다.
- 쿠팡 오픈 API 응답 필드명(`productName`, `productImage` 등)은 쿠팡 측 정책에 따라 바뀔 수 있어요.
  `coupang_partners.py`를 단독 실행해서 실제 응답 구조를 한 번 확인해보시는 걸 추천합니다.
- 필수 고지 문구("이 포스팅은 쿠팡 파트너스 활동의 일환으로...")는 `index.html`에 이미 포함돼 있어요.

## 5. 만세력(사주) 정확도 높이기 — KASI 프록시(선택)

기본값은 **60갑자 순환을 이용한 간이 계산**이에요 (API 키 필요 없음, 지금 그대로도 충분히 쓸만함).
더 정확한 만세력이 필요하면 `kasi-proxy/` 폴더의 Cloudflare Worker를 배포해서 연결할 수 있어요.

> **왜 프록시가 필요한가요?**
> KASI 인증키를 `script.js`(브라우저)에 직접 넣으면 누구나 소스보기로 볼 수 있고,
> 악용되면 하루 호출 한도가 금방 소진돼요. 그래서 키는 서버(Cloudflare Worker)에만 두고,
> 브라우저는 그 서버를 통해서만 값을 받아옵니다.

**배포 방법**
```bash
npm install -g wrangler
cd kasi-proxy
wrangler login
wrangler secret put KASI_SERVICE_KEY   # 프롬프트가 뜨면 data.go.kr에서 받은 인증키 입력
wrangler deploy
```
배포가 끝나면 `https://ohaasa-kasi-proxy.<계정>.workers.dev` 같은 주소가 나와요.
이 주소를 `script.js`의 `KASI_PROXY_URL`에 넣어주세요.

```js
const KASI_PROXY_URL = "https://ohaasa-kasi-proxy.<계정>.workers.dev";
```

`KASI_PROXY_URL`을 비워두면(기본값) 자동으로 간이 계산을 사용하니, 프록시를 배포하지 않아도
사이트는 정상 작동합니다. 프록시 호출이 실패해도(네트워크 오류, 한도 초과 등) 자동으로
간이 계산으로 대체되도록(fallback) 만들어져 있어요.

**참고**: `kasi-proxy/worker.js`는 KASI **음양력 정보제공 서비스(LrsrCldInfoService) /
getLunCalInfo** 오퍼레이션의 실제 응답 스펙(XML, `lunSecha`=연간지, `lunWolgeon`=월간지,
`lunIljin`=일간지)을 기준으로 작성되어 있어요. `wrangler secret put` 시 넣는 값은
**일반 인증키(Decoding)** 를 사용하세요 (Encoding 키를 넣으면 워커에서 다시 인코딩할 때
이중 인코딩되어 오류가 날 수 있어요).

## 6. 개인정보

생일/시간 입력값은 `localStorage`에만 저장되고 서버로 전송되지 않습니다.
공유 서버 저장이 필요해지면 (예: 여러 기기 동기화) 별도 백엔드/DB 설계가 필요해요.
