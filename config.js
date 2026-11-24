/*
 * 人事工作看板｜設定（這個檔案任何人都看得到，不要放密碼）
 *
 * HR_AUTH.clientId：Google 登入的「OAuth 用戶端 ID」，是公開資訊。目前借用「倉儲 IT 整合中心」的
 *   （網址同樣在 cheesedukead4.github.io 底下，所以登入一樣能用；Google 登入視窗會顯示那個 App 的名稱）。
 *   雲端後端（雲端後端/Code.gs）的 GOOGLE_CLIENT_ID_ 必須是同一個 ID。
 * HR_CLOUD.url：本 App 的 Apps Script 網頁應用程式網址（結尾 /exec），見「使用說明.md」。
 */
window.HR_AUTH = {
  clientId: '108931232819-5iv3i1uf96nhq0ihlbtq9thh17em2jn8.apps.googleusercontent.com'
};

window.HR_CLOUD = {
  url: 'https://script.google.com/macros/s/AKfycbx4KyYp5yzs8qU_T5lznuCcmdvFoSX7CwxLQZlje4wbECz5JqtD7U4U3irnFiW-wHr4/exec'
};
