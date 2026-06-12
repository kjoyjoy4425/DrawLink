// 카카오톡/인스타그램 등 "인앱 브라우저" 감지 → 외부 브라우저로 열도록 안내.
// 인앱 웹뷰에서는 소켓/캔버스/이미지가 깨지는 경우가 많아 정상 플레이가 어렵다.

function detectInApp() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('kakaotalk')) return 'kakao';
  if (ua.includes('instagram')) return 'instagram';
  if (ua.includes('fban') || ua.includes('fbav') || ua.includes('fb_iab')) return 'facebook';
  if (ua.includes('line/')) return 'line';
  if (ua.includes('naver(inapp') || ua.includes('whale')) return 'naver';
  if (ua.includes('daumapps')) return 'daum';
  if (ua.includes('band/')) return 'band';
  // 안드로이드 WebView 일반 패턴 (정식 크롬은 'wv' 없음)
  if (/; wv\)/.test(navigator.userAgent) && /android/i.test(ua)) return 'webview';
  return null;
}

function isAndroid() { return /android/i.test(navigator.userAgent); }

// 가능하면 외부 브라우저로 자동 전환 시도
function tryOpenExternal(app) {
  const url = location.href;
  if (app === 'kakao') {
    // 카카오톡 전용: 외부 브라우저 강제 오픈
    location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    return true;
  }
  if (isAndroid()) {
    // 안드로이드 크롬 인텐트
    const clean = url.replace(/^https?:\/\//, '');
    location.href = 'intent://' + clean +
      '#Intent;scheme=https;package=com.android.chrome;end';
    return true;
  }
  return false; // iOS 기타 인앱은 수동 안내만 가능
}

function showGuide(app) {
  const overlay = document.getElementById('inapp-overlay');
  if (!overlay) return;
  const android = isAndroid();
  const steps = android
    ? '오른쪽 위(또는 아래) <b>⋮ 메뉴</b>를 누른 뒤<br><b>‘다른 브라우저로 열기’</b>를 선택하세요.'
    : '오른쪽 아래 <b>공유/메뉴 버튼</b>을 누른 뒤<br><b>‘Safari로 열기’</b>를 선택하세요.';
  document.getElementById('inapp-steps').innerHTML = steps;

  const btn = document.getElementById('inapp-open-btn');
  if (btn) {
    btn.onclick = () => { if (!tryOpenExternal(app)) copyLink(); };
  }
  const copyBtn = document.getElementById('inapp-copy-btn');
  if (copyBtn) copyBtn.onclick = copyLink;

  overlay.style.display = 'flex';
}

function copyLink() {
  const url = location.href;
  navigator.clipboard?.writeText(url).then(
    () => alert('주소가 복사되었습니다.\n브라우저(크롬/사파리)에 붙여넣어 접속하세요!'),
    () => prompt('아래 주소를 복사해 브라우저에 붙여넣으세요:', url)
  );
}

export function initInAppGuard() {
  const app = detectInApp();
  if (!app) return false;
  // 카카오/안드로이드는 자동 전환을 먼저 시도하고, 실패 대비 안내도 표시
  if (app === 'kakao' || isAndroid()) tryOpenExternal(app);
  // 자동 전환이 막히는 경우를 대비해 안내 오버레이도 항상 표시
  showGuide(app);
  return true;
}
