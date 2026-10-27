# 설정과 글꼴

## 개인 설정

기본 런타임 위치는 `~/.stoom-pwh/`입니다. 개인 설정은 `engine.config.local.json`, 런타임의 `config.json` 또는 `PWH_CONFIG`로 지정한 JSON 파일에 저장합니다. 설정 파일 안의 상대 경로는 그 파일이 있는 폴더를 기준으로 해석합니다.

설정 예시는 [engine.config.example.json](../engine.config.example.json)을 참고하세요. 개인 문서·설정·상용 글꼴은 공개 저장소나 배포 패키지에 포함하지 않습니다.

## 환경 변수

| 환경 변수 | 용도 |
| --- | --- |
| `PWH_RUNTIME_ROOT` | 실행파일·편집기·글꼴·출력의 기본 루트 |
| `PWH_CONFIG` | 개인 설정 JSON |
| `PWH_RHWP_PATH`, `PWH_PYTHON_PATH` | 실행파일·Python 경로 |
| `PWH_OUTPUT_ROOT` | 도구 기본 출력·공유 세션 기록 위치 |
| `PWH_STUDIO_PATH`, `PWH_EDITOR_SDK_PATH` | 준비된 Studio·SDK 위치 |
| `PWH_FONT_ROOT` | 글꼴 폴더 |
| `PWH_RENDER_FONT_FILES` | PNG/PDF에 공급할 글꼴 파일 경로의 JSON 배열 |
| `PWH_SERVER_RELEASE_ROOT` | 실행 중인 MCP 서버 소스의 보존 위치 |

## 편집기 글꼴

Windows 시스템·사용자 설치 글꼴과 설정 경로의 글꼴을 편집기 목록과 렌더러에 연결합니다. 편집기를 열 때 목록을 불러오므로 글꼴을 설치하거나 삭제한 경우 편집기를 다시 여세요.

같은 글꼴 이름이라도 파일·굵기·TTC face가 다르면 줄바꿈과 배치가 달라질 수 있습니다. 일부 가변 글꼴 축과 지원되지 않는 글꼴 형식은 반영되지 않을 수 있습니다.

## PNG/PDF 출력 글꼴

출력에 사용할 TTF/OTF/TTC 파일을 `renderFontFiles`로 지정할 수 있습니다.

```json
{
  "schemaVersion": 1,
  "renderFontFiles": ["./fonts/Regular.ttf", "./fonts/Bold.ttf"]
}
```

지정한 파일을 출력 작업에 공급하고 선택한 글꼴 정보를 결과에 기록합니다. 편집기 화면과 PNG/PDF 출력은 렌더 경로가 다르므로 최종 결과를 각각 확인하세요. 이 설정이 모든 글꼴 충돌이나 한컴 한글과의 조판 차이를 해결하는 것은 아닙니다.

런타임 설치·오프라인 사용·업그레이드는 [설치 상세 안내](engine-preservation.md)를 참고하세요.
