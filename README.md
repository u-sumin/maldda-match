# 말따 MATCH v3 — 미암기 기본값, 50문항, 일회용 백업 코드

## 기존 GitHub Pages 게임만 업데이트 (바로 작동)

1. `index.html` 파일을 다운로드합니다.
2. GitHub 저장소 `https://github.com/u-sumin/maldda-match`로 이동합니다.
3. `index.html`을 열고 연필 모양(Edit this file)을 눌러 기존 내용을 교체하거나, GitHub 웹 업로드로 같은 이름의 파일을 교체해 커밋합니다. **새 파일 이름은 반드시 `index.html`**입니다.
4. `https://u-sumin.github.io/maldda-match/`에 접속해 확인합니다.

변경 사항: **문제 보관함 최초 필터 미암기**, **페이지당 50문항**. 기존 문제 및 그림(HTML 안에 내장), 게임 설정, JSON 백업 및 로컬 암기 기록은 유지됩니다.

## 일회용 코드 백업 (서버 추가 설정 필요)

GitHub Pages는 정적 웹사이트이므로 다른 기기에서 12자리 코드 하나로 기록을 교환하는 서버 기능이 없습니다. 별도로 **Cloudflare Worker + D1**을 설정해야 합니다. `cloudflare-backup-server` 디렉터리는 GitHub Pages에 올릴 필요가 없습니다.

### 1. Cloudflare 회원가입 및 데이터베이스 만들기

- `https://dash.cloudflare.com/`에 로그인합니다.
- **Workers & Pages → D1 SQL Database** (UI에서는 'Storage & databases → D1' 등으로 표시될 수 있음)에서 D1 데이터베이스 `maldda-match-backups`를 만듭니다.
- SQL을 직접 실행할 필요는 없습니다. 백업 Worker가 첫 연결 시 필요한 테이블을 자동으로 만듭니다. `schema.sql`은 참고용입니다.

### 2. Worker 만들고 D1 연결하기

- **Workers & Pages → Create → Worker**에서 `maldda-match-backup` Worker를 만듭니다.
- **Edit code**에서 기본 예제 코드를 `cloudflare-backup-server/worker.js`의 내용으로 교체하고 Deploy를 누릅니다.
- Worker의 **Bindings → Add binding → D1 database**를 선택합니다.
  - **Variable name: `DB`** (대문자 정확히)
  - Database: `maldda-match-backups`
- Save / Deploy한 뒤 Worker의 `https://....workers.dev/health` 주소를 열었을 때 `{"ok":true,"status":"ready"}`가 보이면 성공입니다.

참고 공식 안내: https://developers.cloudflare.com/d1/get-started/

### 3. 게임과 서버 연결하기

- GitHub Pages 게임을 열고 하단의 **일회용 코드로 암기 기록 옮기기**에서 서버 주소에 Cloudflare Worker의 `https://....workers.dev` 주소를 입력합니다.
- **주소 저장 → 연결 확인**을 누릅니다.
- 다른 기기에서도 Worker 주소를 한 번 입력해 저장해야 합니다.
- 원하면 `index.html`의 `const DEFAULT_BACKUP_SERVER = '';`를 `const DEFAULT_BACKUP_SERVER = 'https://....workers.dev';`로 수정해 재배포하면, 새 기기에서도 서버 주소를 매번 입력하지 않아도 됩니다.

### 사용 방법

- **기기 A:** 암기 체크를 한 상태로 `일회용 백업 코드 만들기` 클릭 → 12자리 코드 발급 → 코드를 복사합니다.
- **기기 B:** 같은 사이트에서 서버 주소를 저장한 뒤 12자리 코드를 입력 → `코드로 가져오기` → 확인.
- 기록은 기기 B의 기존 체크 상태를 **교체**합니다. 따라서 기기 B에 중요한 기록이 있다면 먼저 JSON 파일로 백업하세요.
- 코드는 **24시간 뒤 만료**되며 **최초 성공한 복원 1회에만 사용**됩니다. 자동 동기화는 지원하지 않습니다.
- 백업 서버는 **암기 완료된 문제 ID만** 보관합니다. 문제 본문과 이미지 등은 전송하지 않습니다.
- 이 서비스는 Cloudflare Worker와 데이터베이스가 삭제되거나 연결이 중단되면 사용할 수 없습니다. JSON 파일 백업은 독립적으로 계속 작동합니다.

### 문제 해결

- `DB 바인딩` 오류: Workers → Bindings에서 D1 DB를 `DB`라는 변수 이름으로 연결했는지 확인합니다.
- `D1 백업 테이블` 오류: D1 데이터베이스 연결을 확인합니다. 자동 생성이 실패했다면 D1 콘솔에서 `schema.sql`을 직접 실행해 보세요.
- `허용되지 않은 사이트` 오류: `worker.js`의 `ALLOWED_ORIGIN`이 사이트의 실제 Origin(`https://u-sumin.github.io`)과 일치하는지 확인합니다.
- HTTPS 사이트가 아닌 로컬 파일에서 열면 코드 백업은 작동하지 않습니다. **GitHub Pages 주소에서 이용하세요.**
