# velog-mcp

Velog GraphQL API를 감싼 MCP(Model Context Protocol) 서버. Claude Code(또는 Claude Desktop)에서 Velog 글 조회·작성·수정을 할 수 있게 해준다.

## 노출되는 도구

| 도구 | 인증 필요 | 설명 |
|------|-----------|------|
| `velog_whoami` | ✅ | 토큰 유효성·로그인 사용자 정보 확인 |
| `velog_list_posts` | ⛔ | 사용자/태그/커서로 글 목록 조회 (`temp_only`는 ✅) |
| `velog_get_post` | ⛔ | `id` 또는 `username + url_slug`로 단건 조회 |
| `velog_write_post` | ✅ | 새 글 작성 (`is_temp=true`면 임시저장) |
| `velog_edit_post` | ✅ | 기존 글 수정 (모든 필수 필드 재전송) |

## 빌드

```bash
cd /Users/seonwoo_jung/workspace/velog-mcp
npm install
npm run build   # 또는 npx tsc
```

산출물: `dist/index.js` (shebang 포함, stdio MCP 서버).

## VELOG_ACCESS_TOKEN 얻기

Velog는 공식 토큰 발급 API가 없으므로 브라우저 쿠키에서 가져온다.

1. Chrome/Safari에서 https://velog.io 로그인
2. DevTools → Application → Cookies → `https://velog.io`
3. **`access_token`** 항목의 Value 복사
4. 만료 시 (보통 1시간) 다시 추출

> 토큰은 로그인 세션 전체에 접근 가능한 자격증명이다. 노출되지 않도록 주의.

## Claude Code에 등록

```bash
claude mcp add velog \
  -e VELOG_ACCESS_TOKEN=<여기에_토큰> \
  -- node /Users/seonwoo_jung/workspace/velog-mcp/dist/index.js
```

확인:

```bash
claude mcp list
claude mcp get velog
```

이후 Claude Code 세션에서 `velog_*` 도구가 자동 노출된다.

## 직접 호출 테스트 (CLI 디버깅용)

```bash
# tools/list
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| node dist/index.js
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `VELOG_ACCESS_TOKEN` | (없음) | 로그인 쿠키. 인증 도구 사용 시 필수 |
| `VELOG_ENDPOINT` | `https://v3.velog.io/graphql` | GraphQL endpoint 오버라이드 |

## 주의

- Velog GraphQL은 **비공식**이라 스펙이 예고 없이 바뀔 수 있다.
- 삭제 mutation은 공개 스키마에 노출되지 않아 이 서버는 지원하지 않는다 (Velog 웹에서 직접 처리).
- `velog_edit_post`는 GraphQL 특성상 모든 필수 필드를 다시 보내야 한다. 일부만 바꾸려면 `velog_get_post`로 현재 값을 가져와 머지한 뒤 호출.
