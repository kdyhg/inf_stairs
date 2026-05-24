# INF STAIRS

키보드로 좌우 계단을 빠르게 올라가는 20초 제한 레트로 계단 게임입니다. 원작 에셋을 복제하지 않고, 픽셀풍 분위기와 단순한 좌우 계단 규칙을 바탕으로 새로 만든 구현입니다.

## 기능

- 시작 전 닉네임 입력 필수
- 좌우 방향키로 한 칸 이동
- `Shift` + 좌우 방향키로 같은 방향 계단을 두 칸 이동
- 다음 계단 방향은 랜덤 생성
- 방향을 틀리면 즉시 종료
- 제한시간 20초
- 올라간 층수가 점수
- 랭킹은 브라우저 로컬 저장소가 아니라 Google 스프레드시트에 저장
- 새로고침 버튼으로 서버 랭킹 재조회

## 실행

```bash
npm start
```

브라우저에서 `http://localhost:3000`을 열면 됩니다.

## Google Sheets 랭킹 설정

랭킹 저장 대상 시트:
`https://docs.google.com/spreadsheets/d/1GbYD5LIF3I514aPHo4V6dGbxQafWJMONwxI_osXFtaY/edit?gid=0#gid=0`

서버가 Google Sheets API로 시트를 읽고 쓰려면 아래 환경변수가 필요합니다.

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1GbYD5LIF3I514aPHo4V6dGbxQafWJMONwxI_osXFtaY
GOOGLE_SHEET_GID=0
```

서비스 계정 이메일을 위 스프레드시트에 편집자로 공유해야 점수가 저장됩니다. 시트가 비어 있으면 서버가 첫 저장 시 `id`, `nickname`, `score`, `elapsedMs`, `createdAt` 헤더를 자동으로 만듭니다.

## 배포 메모

GitHub Pages 같은 정적 호스팅만으로는 Google Sheets 랭킹 저장이 동작하지 않습니다. Node 서버가 실행되는 환경에 위 Google 환경변수를 설정해야 합니다.
