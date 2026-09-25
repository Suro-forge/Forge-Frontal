// Forge-Frontal — аккаунты и техподдержка для GitHub Pages
// Аккаунты: Firebase Authentication (почта + пароль)
// Данные (ники, роли, обращения): Cloud Firestore
// Письма в поддержку: FormSubmit (https://formsubmit.co)

import { firebaseConfig, SUPPORT_EMAIL, DONATE_URL } from "./firebase-config.js";
import { DEFAULT_SHOP_ITEMS, CURRENCY, CURRENCY_ICON } from "./shop-items.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore, doc, getDoc, writeBatch, collection, addDoc, updateDoc,
    query, where, getDocs, orderBy, serverTimestamp, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const configured = !String(firebaseConfig.apiKey).includes("ВСТАВЬ");
if(!configured) $("configBanner").style.display = "block";

const app  = configured ? initializeApp(firebaseConfig) : null;
const auth = configured ? getAuth(app) : null;
const db   = configured ? getFirestore(app) : null;

let state = { user: null, profile: null };
let shop = { items: [], category: "Все" };

// ---------- helpers ----------
function escapeHTML(text){
    return String(text ?? "").replace(/[&<>'"]/g, s => ({
        '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
    }[s]));
}

const isStaff   = p => p && (p.role === "Создатель" || p.role === "Техподдержка");
const isCreator = p => p && p.role === "Создатель";
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function fmtDate(ts){
    if(!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function authError(e){
    const map = {
        "auth/email-already-in-use": "Эта почта уже зарегистрирована.",
        "auth/invalid-email": "Некорректная почта.",
        "auth/weak-password": "Пароль должен быть не короче 6 символов.",
        "auth/invalid-credential": "Неверная почта или пароль.",
        "auth/wrong-password": "Неверная почта или пароль.",
        "auth/user-not-found": "Неверная почта или пароль.",
        "auth/too-many-requests": "Слишком много попыток. Попробуйте позже.",
        "auth/network-request-failed": "Нет соединения с сервером.",
        "permission-denied": "Недостаточно прав."
    };
    console.error(e);
    return map[e.code] || ("Ошибка: " + (e.message || e));
}

function needConfig(){
    if(configured) return false;
    alert("Сайт ещё не подключён к Firebase. Заполните firebase-config.js.");
    return true;
}

async function busy(btnId, fn){
    const btn = $(btnId);
    if(btn){ btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = "Подождите..."; }
    try{ await fn(); }
    finally{ if(btn){ btn.disabled = false; btn.textContent = btn.dataset.t; } }
}

// ---------- регистрация / вход ----------
async function registerPlayer(){
    if(needConfig()) return;
    const nick  = $("regNick").value.trim();
    const email = $("regEmail").value.trim();
    const pass  = $("regPass").value;

    if(!/^[A-Za-z0-9_]{3,16}$/.test(nick)){
        alert("Ник: 3–16 символов, только латиница, цифры и _ (как в Minecraft).");
        return;
    }
    if(!validEmail(email)){ alert("Введите корректную почту."); return; }
    if(pass.length < 6){ alert("Пароль должен быть не короче 6 символов."); return; }

    await busy("regBtn", async () => {
        const nickRef = doc(db, "nicks", nick.toLowerCase());
        if((await getDoc(nickRef)).exists()){
            alert("Такой ник уже занят.");
            return;
        }

        let cred;
        try{
            cred = await createUserWithEmailAndPassword(auth, email, pass);
        }catch(e){ alert(authError(e)); return; }

        try{
            const batch = writeBatch(db);
            batch.set(doc(db, "users", cred.user.uid), {
                nick, role: "Игрок", balance: 0, created: serverTimestamp()
            });
            batch.set(nickRef, { uid: cred.user.uid });
            await batch.commit();
        }catch(e){
            // ник успели занять — откатываем аккаунт
            await deleteUser(cred.user).catch(() => {});
            alert("Не удалось сохранить профиль (возможно, ник уже занят). Попробуйте другой ник.");
            return;
        }

        $("regNick").value = $("regEmail").value = $("regPass").value = "";
        await loadProfile(cred.user);
        renderAll();
        alert("Аккаунт игрока создан! Вы вошли как " + nick);
    });
}

async function loginAccount(){
    if(needConfig()) return;
    const email = $("loginEmail").value.trim();
    const pass  = $("loginPass").value;
    if(!email || !pass){ alert("Введите почту и пароль."); return; }

    await busy("loginBtn", async () => {
        try{
            await signInWithEmailAndPassword(auth, email, pass);
            $("loginEmail").value = $("loginPass").value = "";
        }catch(e){ alert(authError(e)); }
    });
}

async function logoutAccount(){
    if(!auth) return;
    await signOut(auth);
    alert("Вы вышли из аккаунта.");
}

// ---------- техподдержка ----------
async function sendSupportTicket(event){
    event.preventDefault();
    if(needConfig()) return;
    if(!state.user || !state.profile){ alert("Сначала войдите в аккаунт."); return; }

    const email   = $("supportEmail").value.trim();
    const topic   = $("supportTopic").value.trim();
    const message = $("supportMessage").value.trim();

    if(!validEmail(email)){ alert("Введите корректную почту для ответа."); return; }
    if(!topic || !message){ alert("Заполните все поля."); return; }

    await busy("supportBtn", async () => {
        // 1) письмо на почту поддержки
        let mailed = false;
        try{
            const res = await fetch("https://formsubmit.co/ajax/" + SUPPORT_EMAIL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    _subject: "[Forge-Frontal] " + topic,
                    _template: "table",
                    _captcha: "false",
                    "Ник": state.profile.nick,
                    email: email,            // FormSubmit ставит этот адрес в «Ответить»
                    "Тема": topic,
                    "Сообщение": message
                })
            });
            const data = await res.json().catch(() => ({}));
            mailed = res.ok && String(data.success) !== "false";
        }catch(e){ console.error(e); }

        // 2) копия в базу — для панели техподдержки
        let saved = false;
        try{
            await addDoc(collection(db, "tickets"), {
                uid: state.user.uid,
                author: state.profile.nick,
                email, topic, message,
                status: "Ожидает ответа",
                created: serverTimestamp()
            });
            saved = true;
        }catch(e){ console.error(e); }

        if(!mailed && !saved){
            alert("Не удалось отправить обращение. Попробуйте позже.");
            return;
        }
        $("supportTopic").value = $("supportMessage").value = "";
        alert("Обращение отправлено! Мы отвечаем не сразу — обычно в течение 24–48 часов. Ответ придёт на " + email);
    });
}




// ================= МАГАЗИН =================
const coins = n => `${CURRENCY_ICON} ${Number(n || 0).toLocaleString("ru-RU")}`;
const statusClass = s => s === "Выдано" ? "st-done" : s === "Отменено" ? "st-cancel" : "st-wait";

async function loadShop(){
    if(!configured){
        shop.items = DEFAULT_SHOP_ITEMS.map((it, i) => ({ ...it, order: i }));
        return;
    }
    try{
        const snap = await getDocs(collection(db, "shop"));
        shop.items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    }catch(e){ console.error(e); shop.items = []; }
}

function renderShop(){
    const p = state.profile;
    $("balanceBar").innerHTML = p
        ? `Игрок <b style="color:#7dff63">${escapeHTML(p.nick)}</b> · Баланс: <b>${coins(p.balance)}</b>`
        : "Войдите в аккаунт, чтобы видеть баланс и покупать.";

    const cats = ["Все", ...new Set(shop.items.map(i => i.category || "Прочее"))];
    if(!cats.includes(shop.category)) shop.category = "Все";
    $("shopTabs").innerHTML = cats.map(c =>
        `<button class="${c === shop.category ? "active" : ""}" data-c="${escapeHTML(c)}" onclick="setShopCategory(this.dataset.c)">${escapeHTML(c)}</button>`
    ).join("");

    const list = shop.items.filter(i => shop.category === "Все" || (i.category || "Прочее") === shop.category);
    if(!list.length){
        $("shopGrid").innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#cfcfcf">
            Товаров пока нет.${isCreator(p) ? " Добавь их в админ-приложении." : ""}</p>`;
    }else{
        $("shopGrid").innerHTML = list.map(i => {
            const id = escapeHTML(i.id);
            return `<div class="shop-item">
                <div class="icon">${escapeHTML(i.icon || "📦")}</div>
                <div class="cat">${escapeHTML(i.category || "Прочее")}</div>
                <h3>${escapeHTML(i.name)}</h3>
                <p>${escapeHTML(i.desc || "")}</p>
                <div class="price">${coins(i.price)}</div>
                <div class="buy-row">
                    <input type="number" id="qty_${id}" value="1" min="1" max="64" aria-label="Количество">
                    <button onclick="buyItem('${id}')" ${p ? "" : "disabled title='Войдите в аккаунт'"}>Купить</button>
                </div>
            </div>`;
        }).join("");
    }

    const link = $("donateLink");
    if(DONATE_URL){ link.href = DONATE_URL; link.style.display = ""; }
    else{ link.style.display = "none"; if(!$("donateSoon")) link.insertAdjacentHTML("afterend", '<p id="donateSoon"><b>Скоро откроется!</b></p>'); }
}

function setShopCategory(c){ shop.category = c; renderShop(); }

async function buyItem(itemId){
    if(needConfig()) return;
    if(!state.user || !state.profile){ alert("Сначала войдите в аккаунт."); return; }

    const item = shop.items.find(i => i.id === itemId);
    if(!item) return;
    const qty = Math.floor(Number($("qty_" + itemId)?.value || 1));
    if(!(qty >= 1 && qty <= 64)){ alert("Количество: от 1 до 64."); return; }
    const total = item.price * qty;

    if(!confirm(`Купить «${item.name}» × ${qty} за ${total} ${CURRENCY}?\nТовар выдадут на ник ${state.profile.nick}.`)) return;

    try{
        const userRef = doc(db, "users", state.user.uid);
        const fresh = (await getDoc(userRef)).data();
        const balance = Number(fresh.balance || 0);
        if(balance < total){
            alert(`Недостаточно монет: нужно ${total}, у вас ${balance}.`);
            return;
        }

        const orderRef = doc(collection(db, "orders"));
        const batch = writeBatch(db);
        batch.set(orderRef, {
            uid: state.user.uid,
            nick: fresh.nick,
            itemId: item.id,
            itemName: item.name,
            qty, price: item.price, total,
            status: "Ожидает выдачи",
            created: serverTimestamp()
        });
        batch.update(userRef, { balance: balance - total, lastOrder: orderRef.id });
        await batch.commit();

        await loadProfile(state.user);
        renderAll();
        alert(`Покупка оформлена! «${item.name}» × ${qty}.\nПерсонал выдаст товар на сервере. Статус — в «Мои заказы».`);
    }catch(e){
        alert("Покупка не прошла: " + authError(e) + "\nВозможно, цена изменилась — обновите страницу.");
    }
}

async function renderMyOrders(){
    const box = $("myOrdersBox");
    if(!state.user || !configured){ box.style.display = "none"; return; }
    box.style.display = "block";
    try{
        const snap = await getDocs(query(collection(db, "orders"), where("uid", "==", state.user.uid)));
        const list = snap.docs.map(d => d.data())
            .sort((a, b) => (b.created?.toMillis?.() || 0) - (a.created?.toMillis?.() || 0));
        $("myOrders").innerHTML = list.length ? list.map(o => `
            <div class="order">
                <span><b>${escapeHTML(o.itemName)}</b> × ${o.qty} — ${coins(o.total)}</span>
                <span>${escapeHTML(fmtDate(o.created))} · <span class="${statusClass(o.status)}">${escapeHTML(o.status)}</span></span>
            </div>`).join("") : "<p style='color:#cfcfcf'>Заказов пока нет.</p>";
    }catch(e){ console.error(e); $("myOrders").innerHTML = "<p>Не удалось загрузить заказы.</p>"; }
}










// ---------- отрисовка ----------
async function loadProfile(user){
    state.user = user;
    state.profile = null;
    if(!user) return;
    try{
        const snap = await getDoc(doc(db, "users", user.uid));
        if(snap.exists()) state.profile = snap.data();
    }catch(e){ console.error(e); }
}

function updateProfile(){
    const el = $("profileInfo");
    const p = state.profile;
    if(!state.user){ el.innerHTML = "Вы не вошли в аккаунт."; return; }
    if(!p){ el.innerHTML = "Профиль загружается..."; return; }
    el.innerHTML = `
        Ник: <b>${escapeHTML(p.nick)}</b><br>
        Почта: <b>${escapeHTML(state.user.email)}</b><br>
        Роль: <b>${escapeHTML(p.role)}</b><br>
        Баланс: <b>${CURRENCY_ICON} ${Number(p.balance || 0)} ${CURRENCY}</b><br>
        Зарегистрирован: ${escapeHTML(fmtDate(p.created))}`;

    const se = $("supportEmail");
    if(!se.value) se.value = state.user.email || "";
}





function renderAll(){
    updateProfile();
    renderShop();
    renderMyOrders();
}

// кнопки в HTML вызывают функции через onclick
Object.assign(window, {
    registerPlayer, loginAccount, logoutAccount,
    sendSupportTicket, setShopCategory, buyItem
});

await loadShop();

if(configured){
    onAuthStateChanged(auth, async user => {
        await loadProfile(user);
        if(!user) $("supportEmail").value = "";
        renderAll();
    });
}else{
    renderAll();
}
