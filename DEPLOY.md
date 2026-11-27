# JLPT PASS 업데이트 배포 안내

- 저장소: https://github.com/kimjs37/jlpt-study
- 사이트: https://kimjs37.github.io/jlpt-study/
- 문제은행: 어휘 500문 + 문법 300문 + 독해 300문 (N1~N5 각 등급별 어휘 100문, 문법 60문, 독해 60문)

## 이번 업데이트

- 아이디 + 비밀번호 회원가입/로그인, 계정별 진도·정답률·오답노트 분리
- 비밀번호는 서버에서 PBKDF2-SHA-256 150,000회로 해시하며 평문 비밀번호는 저장하지 않음
- 30일 세션 토큰, 로그아웃 시 세션 폐기
- 모든 문항 4지선다. 일반 학습은 10문제 회차마다 정답 위치를 1~4번에 순환 배분하고, 오답노트는 보기와 정답 위치를 매번 다시 섞음
- 정답 확인 시 어휘·문법 보기의 뜻/설명 제공
- N3/N4/N5 후리가나(내장 단어 사전 기반). 한자 읽기 문제의 표적 단어에는 정답 읽기를 미리 표시하지 않음
- 10문제 결과, 정답률, 회차 오답 복습, 다음 회차 기능
- 기존 브라우저 `jlptpass` 로컬 기록 가져오기 지원

문항은 공개된 JLPT 유형과 학습 자료를 참고해 새로 작성한 연습문제입니다. 공식 기출 원문을 그대로 복제하지 않습니다. JLPT는 2010년 개정 이후 공식 어휘·문법 목록이나 최근 10년 출제 빈도 통계를 공개하지 않으므로, 등급 분류는 학습용 근사 분류이며 실제 기출 빈도 순위가 아닙니다.

## 1. Cloudflare D1 백업

Cloudflare Dashboard → Workers & Pages → D1 → `jlpt-study-progress`에서 기존 DB를 Export/백업합니다. 기존 유저명 방식의 `study_progress` 테이블은 변경하거나 삭제하지 않습니다. 새 인증 기록은 별도 `account_study_progress` 테이블에 저장합니다. 기존 유저명 기록은 소유자 확인이 불가능하므로 새 계정으로 자동 연결하지 않습니다. 브라우저에 남아 있는 기존 `jlptpass` 기록은 새 계정 로그인 후 **이전 브라우저 기록 가져오기**로 가져올 수 있습니다.

## 2. 계정용 D1 테이블 추가

저장소 루트에서 아래 명령을 실행합니다. 기존 데이터베이스 ID를 유지해야 합니다. SQL은 `IF NOT EXISTS`를 사용하므로 기존 학습 기록 테이블을 덮어쓰지 않습니다.

```bash
npx wrangler login
cd api
npx wrangler d1 execute jlpt-study-progress --remote --file=migrations/0001_accounts.sql
```

`api/wrangler.toml`의 `database_id`가 기존 DB ID인지 확인합니다. `PAGE_ORIGIN`은 `https://kimjs37.github.io`로 설정되어 있어야 합니다.

## 3. Worker 배포

같은 `api/` 폴더에서 이어서 실행합니다.

```bash
npx wrangler deploy
```

배포 후 Cloudflare가 표시하는 Worker 주소를 확인합니다. `index.html`의 `<meta name="jlpt-api-url">` 값이 해당 Worker의 `/api/progress` 주소와 일치해야 합니다. 현재 파일에는 기존 Worker 주소가 입력되어 있습니다. Cloudflare에서 다른 주소가 표시되면 그 주소로 바꿔 주세요.

## 4. GitHub Pages에 파일 업로드

아래 파일과 폴더를 저장소 `main` 브랜치의 동일한 경로에 업로드/덮어쓰기합니다.

- `index.html`
- `question-bank.js` (**반드시 함께 업로드**)
- `api/` 폴더 전체
- `.github/workflows/pages.yml`
- `DEPLOY.md`
- `README.md`

GitHub Actions에서 Pages 배포가 성공하면 사이트 주소는 그대로 유지됩니다. 저장소 Settings → Pages의 Build and deployment Source가 **GitHub Actions**인지 확인합니다.

## 5. 로그인/저장 확인

1. 사이트에서 회원가입을 선택합니다. 아이디는 한글·영문·숫자·`._-` 조합 3~24자, 비밀번호는 8~128자입니다.
2. 로그아웃 후 같은 아이디와 비밀번호로 다시 로그인합니다.
3. 문제를 풀고 새로고침한 뒤 기록이 유지되는지 확인합니다.
4. 다른 브라우저에서 로그인해 기록이 동기화되는지 확인합니다.

비밀번호 재설정 기능은 아직 없습니다. 비밀번호를 안전하게 보관하고 공용 PC에서는 로그아웃해 주세요. 세션 토큰은 브라우저 localStorage에 보관되며 30일 후 만료됩니다. 운영 환경에서는 Cloudflare의 로그인 엔드포인트에 rate limiting을 추가하는 것을 권장합니다.
