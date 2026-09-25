// ===== НАСТРОЙКИ ПОДКЛЮЧЕНИЯ =====
// 1) Вставь сюда данные своего проекта Firebase
//    (Firebase Console → ⚙ Project settings → General → Your apps → Web app → SDK setup and configuration → Config).
//    Эти ключи НЕ секретные — их можно спокойно хранить на GitHub, защиту обеспечивают правила firestore.rules.
export const firebaseConfig = {
    apiKey: "ВСТАВЬ_СЮДА",
    authDomain: "ВСТАВЬ_СЮДА.firebaseapp.com",
    projectId: "ВСТАВЬ_СЮДА",
    storageBucket: "ВСТАВЬ_СЮДА.appspot.com",
    messagingSenderId: "ВСТАВЬ_СЮДА",
    appId: "ВСТАВЬ_СЮДА"
};

// 2) Почта техподдержки — сюда приходят все обращения игроков.
//    После первого обращения FormSubmit пришлёт на эту почту письмо «Activate Form» — нужно нажать кнопку в нём один раз.
export const SUPPORT_EMAIL = "forgefrontalsupport@gmail.com";

// 3) Ссылка на донат-магазин (Tebex / EasyDonate) для косметики за реальные деньги.
//    Оставь пустой "", чтобы скрыть кнопку.
export const DONATE_URL = "";
