const encoder = new TextEncoder();
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const token = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => b64url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 150000 }, key, 256));
}

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function body(request, max = 70000) {
  const raw = await request.text();
  if (raw.length > max) throw Object.assign(new Error("요청 내용이 너무 큽니다."), { status: 413 });
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error("요청 형식이 올바르지 않습니다."), { status: 400 }); }
}

function credentials(name, password) {
  name = typeof name === "string" ? name.trim().normalize("NFC") : "";
  if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(name)) throw Object.assign(new Error("아이디는 한글·영문·숫자·._- 조합으로 3~24자 입력해 주세요."), { status: 400 });
  if (typeof password !== "string" || password.length < 8 || password.length > 128) throw Object.assign(new Error("비밀번호는 8~128자로 입력해 주세요."), { status: 400 });
  return name;
}

async function createSession(env, userId) {
  const rawToken = token(), tokenHash = await hash(rawToken);
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000)).run();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, userId, expiresAt).run();
  return { token: rawToken, expiresAt };
}

async function register(request, env) {
  const input = await body(request, 2000), username = credentials(input.username, input.password);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
  if (existing) return json({ error: "이미 사용 중인 아이디입니다." }, 409);
  const id = crypto.randomUUID(), salt = token(), digest = await passwordHash(input.password, salt);
  await env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)").bind(id, username, digest, salt).run();
  return json({ ...(await createSession(env, id)), username });
}

async function login(request, env) {
  const input = await body(request, 2000);
  const username = typeof input.username === "string" ? input.username.trim().normalize("NFC") : "";
  const password = typeof input.password === "string" ? input.password : "";
  const user = await env.DB.prepare("SELECT id, username, password_hash, password_salt FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
  if (!user || !same(await passwordHash(password, user.password_salt), user.password_hash)) return json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401);
  return json({ ...(await createSession(env, user.id)), username: user.username });
}

async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "", raw = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(raw)) return null;
  const tokenHash = await hash(raw);
  return env.DB.prepare("SELECT users.id, users.username, sessions.token_hash FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?").bind(tokenHash, Math.floor(Date.now() / 1000)).first();
}

function validIds(ids) {
  return Array.isArray(ids) && ids.length <= 2000 && ids.every(id => typeof id === "string" && /^N[1-5]:(vocab|grammar|reading):\d{1,4}$/.test(id));
}

function validState(s) {
  const integer = (v, max=1e9) => Number.isSafeInteger(v) && v >= 0 && v <= max;
  return s && integer(s.solved) && integer(s.correct,s.solved) && integer(s.today,s.solved) && /^\d{4}-\d{2}-\d{2}$/.test(s.day) &&
    validIds(s.wrong) && (s.solvedIds === undefined || validIds(s.solvedIds)) && ["N1","N2","N3","N4","N5"].includes(s.level) &&
    ["vocab","grammar","reading","wrong"].includes(s.tab) && ["all","new","wrong"].includes(s.mode) &&
    (s.idx === -1 || integer(s.idx,2000)) && (s.selected === -1 || integer(s.selected,3)) && typeof s.checked === "boolean" &&
    (!s.checked || s.selected >= 0) && (s.optionOrder === undefined || (Array.isArray(s.optionOrder) && s.optionOrder.length === 4 && new Set(s.optionOrder).size === 4 && s.optionOrder.every(x=>integer(x,3)))) &&
    (s.roundCount === undefined || integer(s.roundCount,10)) && (s.roundCorrect === undefined || integer(s.roundCorrect,10)) &&
    (s.roundTarget === undefined || integer(s.roundTarget,10)) && (s.roundWrongIds === undefined || validIds(s.roundWrongIds)) && (s.roundSeenIds === undefined || validIds(s.roundSeenIds));
}

async function progress(request, env, user) {
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT state_json, revision FROM account_study_progress WHERE user_id = ?").bind(user.id).first();
    return json(row ? { state: JSON.parse(row.state_json), revision: row.revision } : { state: null, revision: 0 });
  }
  if (request.method !== "PUT") return json({ error: "지원하지 않는 요청입니다." }, 405);
  const input = await body(request);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !validState(input.state)) return json({ error: "학습 기록 형식을 확인해 주세요." }, 400);
  const saved = JSON.stringify(input.state);
  const result = input.revision === 0
    ? await env.DB.prepare("INSERT INTO account_study_progress (user_id, state_json) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(user.id, saved).run()
    : await env.DB.prepare("UPDATE account_study_progress SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revision = ?").bind(saved, user.id, input.revision).run();
  return result.meta.changes ? json({ revision: input.revision + 1 }) : json({ error: "다른 화면에서 기록이 갱신됐어요. 다시 불러온 뒤 이어서 풀어 주세요." }, 409);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (!origin || origin !== env.PAGE_ORIGIN) return new Response("Forbidden", { status: 403 });
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Vary": "Origin" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      if (url.pathname === "/api/register" && request.method === "POST") response = await register(request, env);
      else if (url.pathname === "/api/login" && request.method === "POST") response = await login(request, env);
      else if (url.pathname === "/api/logout" && request.method === "POST") {
        const user = await authenticate(request, env);
        if (!user) response = json({ error: "로그인이 만료됐습니다." }, 401);
        else {
          await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.token_hash).run();
          response = json({ ok: true });
        }
      } else if (url.pathname === "/api/progress") {
        const user = await authenticate(request, env);
        response = user ? await progress(request, env, user) : json({ error: "로그인이 만료됐습니다. 다시 로그인해 주세요." }, 401);
      } else response = new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("JLPT API", error);
      response = json({ error: error.status ? error.message : "서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, error.status || 503);
    }
    for (const [key,value] of Object.entries(cors)) response.headers.set(key,value);
    return response;
  }
};
