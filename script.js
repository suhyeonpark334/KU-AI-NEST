// =====================================================================
// [설정] Google Sheets 저장 연동 (Apps Script 웹앱)
// PRD ## 7 Google Sheets 데이터 설계에서 [연동 필요]로 판단됨
// -----------------------------------------------------------------
// 1) Google Sheets에서 새 스프레드시트를 만든다.
// 2) 확장 프로그램 > Apps Script 에서 아래와 같은 doPost 함수를 작성 후
//    "배포 > 웹 앱"으로 배포하고, 그때 생성되는 웹앱 URL을 아래
//    SHEETS_WEBHOOK_URL 에 붙여넣는다. (자세한 안내는 채팅 답변 3번 참고)
// 3) URL을 넣지 않으면(빈 문자열이면) 저장은 건너뛰고 콘솔에만 기록되며,
//    화면 흐름 자체는 정상적으로 계속 진행된다. (수강생 테스트 목적)
// =====================================================================
const SHEETS_WEBHOOK_URL = ""; // 예: "https://script.google.com/macros/s/xxxxx/exec"

// -----------------------------------------------------------------
// [AI 역할 대체 로직] 트리거 유형 -> 후보 스낵 카테고리 매칭표
// PRD ## 3 AI 기능 스펙: "미리 정의된 매칭표를 그대로 조합"
// 실제 AI 모델 호출 없이, 정해진 규칙만 사용 (데모)
// 효과·성공률·건강상 이점에 대한 확정 문구는 포함하지 않음
// -----------------------------------------------------------------
const TRIGGER_MATCH_TABLE = {
  "식후": {
    title: "식후 트리거 예시 구성",
    body:
      "· 무설탕 껌 또는 사탕 (구강 자극 대체)\n" +
      "· 오이·당근 등 아삭한 채소 스틱 (씹는 행동 대체)\n" +
      "· 따뜻한 차 한 잔 (자리 이동·마무리 루틴 대체)\n\n" +
      "예시 구성일 뿐이며, 실제 배송 여부와 구성은 검증되지 않았습니다."
  },
  "출근길": {
    title: "출근길 / 이동 중 트리거 예시 구성",
    body:
      "· 휴대가 간편한 소분 견과류 또는 말린 과일\n" +
      "· 무설탕 껌 (손과 입을 동시에 대체)\n" +
      "· 생수 또는 무카페인 음료\n\n" +
      "예시 구성일 뿐이며, 실제 배송 여부와 구성은 검증되지 않았습니다."
  },
  "야근_스트레스": {
    title: "야근 / 업무 스트레스 트리거 예시 구성",
    body:
      "· 오래 씹을 수 있는 저당 스낵 (긴 충동 시간 대응)\n" +
      "· 파프리카 스틱 등 아삭한 채소\n" +
      "· 무설탕 껌\n\n" +
      "예시 구성일 뿐이며, 실제 배송 여부와 구성은 검증되지 않았습니다."
  },
  "음주_후": {
    title: "음주 후 트리거 예시 구성",
    body:
      "· 미지근한 물 또는 무카페인 차\n" +
      "· 무설탕 껌\n" +
      "· 소분된 견과류\n\n" +
      "예시 구성일 뿐이며, 실제 배송 여부와 구성은 검증되지 않았습니다."
  },
  "기타": {
    title: "일반 대체 구성 예시",
    body:
      "· 무설탕 껌 또는 사탕\n" +
      "· 아삭한 채소 스틱 (당근·오이 등)\n" +
      "· 소분된 견과류\n\n" +
      "트리거 시간대가 더 명확해지면 예시 구성도 달라질 수 있습니다."
  }
};

// -----------------------------------------------------------------
// 상태 저장 (한 번의 세션 동안만 유지)
// -----------------------------------------------------------------
const state = {
  trigger: null,
  quitDays: null,
  contact: "",
  reaction: null,
  comment: ""
};

// -----------------------------------------------------------------
// 화면 전환 유틸
// -----------------------------------------------------------------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

// =====================================================================
// 화면 1 -> 2 : 랜딩 -> 입력
// =====================================================================
document.getElementById("btn-start").addEventListener("click", () => {
  showScreen("screen-input");
});

// =====================================================================
// 화면 2 -> 3 : 입력 -> 결과 (AI 처리)
// PRD 필수 조건: 트리거 시간대 + 경과일수 선택 + 개인정보 동의 체크
// 동의 전에는 다음 단계로 진행되지 않도록 구현
// =====================================================================
document.getElementById("btn-to-result").addEventListener("click", () => {
  const triggerInput = document.querySelector('input[name="trigger"]:checked');
  const quitDaysInput = document.getElementById("quit-days");
  const consentInput = document.getElementById("consent-check");
  const contactInput = document.getElementById("contact");
  const errorEl = document.getElementById("input-error");

  const isValid =
    triggerInput !== null &&
    quitDaysInput.value !== "" &&
    consentInput.checked === true;

  if (!isValid) {
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;

  // 상태 저장
  state.trigger = triggerInput.value;
  state.quitDays = quitDaysInput.value;
  state.contact = contactInput.value.trim();

  // 결과 화면으로 이동 + AI 처리 시작
  showScreen("screen-result");
  runAiMatching(state.trigger);
});

// =====================================================================
// [AI 처리 → AI 결과 표시] 구간
// 실제 AI 모델 호출 없이 규칙 기반 매칭으로 데모 흐름을 구현.
// 로딩 상태를 잠시 보여준 뒤 결과를 표시해 "AI가 처리하는 흐름"을 체감하게 함.
// =====================================================================
function runAiMatching(triggerKey) {
  const loadingEl = document.getElementById("ai-loading");
  const resultEl = document.getElementById("ai-result");

  loadingEl.hidden = false;
  resultEl.hidden = true;

  // 실제 서비스에서는 이 지점에서 서버/AI API를 호출하게 됨.
  // 지금은 브라우저 내 매칭표만 사용하는 데모이므로 약간의 지연만 흉내냄.
  setTimeout(() => {
    const match = TRIGGER_MATCH_TABLE[triggerKey] || TRIGGER_MATCH_TABLE["기타"];

    document.getElementById("result-title").textContent = match.title;
    document.getElementById("result-body").textContent = match.body;

    loadingEl.hidden = true;
    resultEl.hidden = false;
  }, 900);
}

// =====================================================================
// 화면 3 -> 4 : 결과 -> 피드백
// =====================================================================
document.getElementById("btn-to-feedback").addEventListener("click", () => {
  showScreen("screen-feedback");
});

// =====================================================================
// 화면 4 -> 5 : 피드백 -> 완료 (제출 + Sheets 저장)
// =====================================================================
document.getElementById("btn-submit").addEventListener("click", async () => {
  const reactionInput = document.querySelector('input[name="reaction"]:checked');
  const commentInput = document.getElementById("free-comment");
  const errorEl = document.getElementById("feedback-error");

  if (!reactionInput) {
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;

  state.reaction = reactionInput.value;
  state.comment = commentInput.value.trim();

  await saveToSheets(state);

  showScreen("screen-done");
});

// =====================================================================
// Google Sheets 저장 (Apps Script 웹앱으로 POST)
// PRD ## 7의 데이터 1~6 항목을 그대로 전송
// SHEETS_WEBHOOK_URL이 비어있으면 콘솔 로그만 남기고 넘어감 (개발/테스트 편의)
// =====================================================================
async function saveToSheets(data) {
  const payload = {
    trigger: data.trigger,           // 데이터1: 트리거 시간대
    quitDays: data.quitDays,         // 데이터2: 금연 경과일수
    matchedType: data.trigger,       // 데이터3: 노출된 예시 구성 유형(트리거와 동일 키 사용)
    reaction: data.reaction,         // 데이터4: 반응 유형
    comment: data.comment,           // 데이터5: 자유 서술 피드백
    contact: data.contact,           // 데이터6: 연락처(선택 입력)
    submittedAt: new Date().toISOString()
  };

  if (!SHEETS_WEBHOOK_URL) {
    console.log("[Sheets 저장 생략 - 웹앱 URL 미설정] 저장될 데이터:", payload);
    return;
  }

  try {
    await fetch(SHEETS_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors", // Apps Script 웹앱 특성상 no-cors로 전송 (응답 확인은 불가하나 저장은 됨)
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("Sheets 저장 중 오류:", err);
    // 저장 실패해도 사용자 플로우는 막지 않음 (완료 화면으로 계속 진행)
  }
}
