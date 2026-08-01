// Auth thuần qua REST API (GoTrue) của Supabase — không dùng SDK vì service worker MV3
// hay bị kill, SDK dựa vào localStorage/session state không ổn định trong context này.
const SUPABASE_URL = "https://oemuptgkxjddzpljdnrg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ueQChQsHWYCjOb7XC5twuw_Ot0KCo_B";

const REFRESH_BUFFER_MS = 60 * 1000; // làm mới token trước khi hết hạn 60s

function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ vsSession: null }, (res) => resolve(res.vsSession));
  });
}

function setSession(session) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ vsSession: session }, resolve);
  });
}

function persistSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
  };
  return setSession(session).then(() => session);
}

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.error || "Lỗi không xác định");
  }
  return data;
}

async function signUp(email, password) {
  const data = await authRequest("/auth/v1/signup", { email, password });
  if (data.access_token) return persistSession(data);
  // "Confirm email" đang bật phía Supabase -> chưa có access_token ngay
  return null;
}

async function signIn(email, password) {
  const data = await authRequest("/auth/v1/token?grant_type=password", { email, password });
  return persistSession(data);
}

async function refreshSession() {
  const session = await getSession();
  if (!session || !session.refresh_token) return null;
  try {
    const data = await authRequest("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: session.refresh_token,
    });
    return await persistSession(data);
  } catch (e) {
    // refresh token cũng hỏng -> coi như phiên đã hết, đăng xuất cho sạch
    await signOut();
    return null;
  }
}

async function ensureFreshSession() {
  const session = await getSession();
  if (!session) return null;
  if (session.expires_at - REFRESH_BUFFER_MS > Date.now()) return session;
  return refreshSession();
}

async function signOut() {
  await setSession(null);
  await new Promise((resolve) => chrome.storage.local.remove("lastSyncedAt", resolve));
}

// Gọi 1 endpoint bất kỳ của Supabase (REST/PostgREST) kèm token hiện có, tự refresh nếu 401.
async function authFetch(path, options = {}) {
  const session = await ensureFreshSession();
  const headers = { ...(options.headers || {}), apikey: SUPABASE_PUBLISHABLE_KEY };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;

  let res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (res.status === 401 && session) {
    const refreshed = await refreshSession();
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed.access_token}`;
      res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
    }
  }
  return res;
}
