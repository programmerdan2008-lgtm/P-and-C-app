"""Prosper & Charlène: a private, server-routed love chat for two people.

The UI pages are deliberately rendered by Flask instead of putting the whole
product in one index document. Storage is a single SQLite file (sqlite3, WAL
mode) and Socket.IO runs in plain "threading" mode (no eventlet), so run ONE
worker process with many threads — presence state lives in this process.
"""
import base64
import datetime as dt
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from functools import wraps

import jwt
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory
from flask_socketio import SocketIO, join_room
from werkzeug.security import check_password_hash, generate_password_hash

try:
    # Optional: loads PROSPER_PASSWORD, SECRET_KEY, etc. from a .env file that
    # sits right next to THIS FILE (app.py) — not the current working
    # directory. On Pydroid3, the working directory when you hit Run often
    # isn't the same as the script's folder, so a plain load_dotenv() can
    # silently find nothing. Anchoring to __file__ fixes that: put .env in
    # the same folder as app.py and it will always be found.
    # `pip install python-dotenv` if this import fails — the app still runs
    # fine without it, it just won't auto-load .env (set real env vars then).
    from dotenv import load_dotenv
    ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(ENV_PATH)
except ImportError:
    pass

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "chatly-dev-secret-key-change-me-please")
# IMPORTANT (Railway / any container host): the container filesystem is wiped
# on every redeploy, which would delete every account while old login tokens
# stay valid in people's browsers. Attach a persistent volume and point
# DB_PATH at it, e.g. DB_PATH=/data/chatly.db (Railway: service -> Volumes ->
# mount path /data). Without DB_PATH the file lives next to app.py, which is
# fine for local development / Pydroid3.
DB_PATH = os.environ.get("DB_PATH") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "chatly.db")

# Kept as a tuple so existing `except DB_INTEGRITY_ERRORS:` handlers still work.
DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
online_users, sid_to_user = {}, {}
# A disconnect doesn't necessarily mean the person left: navigating between
# HwFar's server-rendered pages (chat -> settings -> chat), a phone locking
# its screen, or a few seconds of flaky network all close the socket even
# though the person is still on the network and hasn't turned off their
# online status. Rather than flipping them to "offline" (and stamping
# last_seen) the instant every socket drops, give each person a short grace
# window to reconnect before treating the disconnect as real. pending_offline
# holds one scheduled threading.Timer per user_id; a reconnect within the
# window cancels it and nothing is ever broadcast as offline.
pending_offline = {}
PRESENCE_GRACE_SECONDS = 20

print(f"[env] looking for .env at: {ENV_PATH if 'ENV_PATH' in dir() else '(python-dotenv not installed)'}")


@app.get("/sw.js")
def service_worker():
    """Serve the root-scoped worker (lives next to app.py) so it can handle
    offline app navigations. Served from root rather than /static so the
    default scope covers the whole app, not just /static/."""
    resp = send_from_directory(app.root_path, "sw.js", mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-cache"          # always re-check for a new worker
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.get("/manifest.json")
def manifest():
    """Serve manifest.json from the project root, alongside app.py."""
    resp = send_from_directory(app.root_path, "manifest.json", mimetype="application/manifest+json")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/offline.html")
def offline_page():
    """Serve the offline fallback page from the project root (not /static)
    so it lives next to sw.js/manifest.json and matches OFFLINE_URL in sw.js."""
    return send_from_directory(app.root_path, "offline.html", mimetype="text/html")


@app.get("/favicon.ico")
def favicon():
    """Browsers ask for /favicon.ico; answer with the app icon from the root /icons folder."""
    return send_from_directory(os.path.join(app.root_path, "icons"), "icon-192.png", mimetype="image/png")


@app.get("/apple-touch-icon.png")
def apple_touch_icon():
    """iPhones ask for this path when you choose Add to Home Screen."""
    return send_from_directory(os.path.join(app.root_path, "icons"), "apple-touch-icon.png", mimetype="image/png")


@app.get("/icons/<path:filename>")
def pwa_icons(filename):
    """Serve PWA icons from a root-level /icons folder (not /static/icons),
    matching the paths used in manifest.json, sw.js, offline.html and base.html."""
    return send_from_directory(os.path.join(app.root_path, "icons"), filename)


def db():
    """Open a short-lived SQLite connection (one per call, closed by the
    caller). Safe with threads because connections are never shared."""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")   # wait for a competing writer instead of failing
    conn.execute("PRAGMA synchronous=NORMAL")   # safe with WAL, much faster commits
    return conn


# --- Private couple mode ------------------------------------------------
# This build is a two-person love chat. Only these two usernames can exist
# (matching ignores case and accents, so "charlene" resolves to "Charlène").
# Set PROSPER_PASSWORD and CHARLENE_PASSWORD as environment variables and
# both accounts are created for you on startup — nobody else can ever
# register, because the only valid names are already taken.
APP_NAME = "Prosper & Charlène"
COUPLE_MODE = True
COUPLE_NAMES = ["Prosper", "Charlène"]


def _fold_name(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn").strip().lower()


_COUPLE_LOOKUP = {_fold_name(n): n for n in COUPLE_NAMES}


def canonical_name(value):
    """'charlene' / 'CHARLÈNE' -> 'Charlène'; anything else -> None."""
    return _COUPLE_LOOKUP.get(_fold_name(value))


def partner_of(username):
    if username not in COUPLE_NAMES:
        return None
    return COUPLE_NAMES[1] if username == COUPLE_NAMES[0] else COUPLE_NAMES[0]


def is_couple_pair(name_a, name_b):
    return bool(name_a in COUPLE_NAMES and name_b in COUPLE_NAMES and name_a != name_b)


def ensure_couple_linked(conn):
    """Make Prosper and Charlène contacts of each other as soon as both
    accounts exist, so the chat is simply there when they log in."""
    rows = conn.execute("SELECT id FROM users WHERE username IN (?,?)", tuple(COUPLE_NAMES)).fetchall()
    ids = [r["id"] for r in rows]
    if len(ids) != 2:
        return
    for owner, contact in ((ids[0], ids[1]), (ids[1], ids[0])):
        conn.execute("INSERT INTO contacts(owner_id,contact_id) VALUES(?,?) "
                     "ON CONFLICT (owner_id,contact_id) DO NOTHING", (owner, contact))


def clear_marker(conn, viewer_id, other_id):
    """Highest message id this viewer has cleared in the chat with other_id."""
    row = conn.execute("SELECT cleared_before FROM chat_clears WHERE user_id=? AND other_id=?",
                       (viewer_id, other_id)).fetchone()
    return int(row["cleared_before"]) if row else 0


def resolve_user(conn, name):
    name = (name or "").strip()
    return conn.execute("SELECT id,username FROM users WHERE username=?",
                        (canonical_name(name) or name,)).fetchone()


def init_db():
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    os.makedirs(db_dir, exist_ok=True)
    conn = db()
    # WAL lets readers and the single writer work at the same time, which is
    # what a threaded Socket.IO server needs. The mode is stored in the file.
    conn.execute("PRAGMA journal_mode=WAL")
    schema_sql = """
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, language TEXT DEFAULT 'en',
        last_seen TEXT, avatar TEXT, age INTEGER, gender TEXT, country TEXT,
        show_online INTEGER DEFAULT 1, show_age INTEGER DEFAULT 0,
        show_gender INTEGER DEFAULT 0, discoverable INTEGER DEFAULT 1,
        welcome_animation INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS contacts (
        owner_id INTEGER NOT NULL, contact_id INTEGER NOT NULL,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP, archived INTEGER DEFAULT 0,
        UNIQUE(owner_id, contact_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL, type TEXT DEFAULT 'text',
        content TEXT NOT NULL, duration INTEGER, sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        delivered INTEGER DEFAULT 0, read INTEGER DEFAULT 0, expires_at TEXT,
        edited INTEGER DEFAULT 0, deleted_for_sender INTEGER DEFAULT 0,
        deleted_for_receiver INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chat_settings (
        user_min INTEGER NOT NULL, user_max INTEGER NOT NULL,
        disappearing_seconds INTEGER NOT NULL DEFAULT 0, updated_by INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_min, user_max)
      );
      CREATE TABLE IF NOT EXISTS chat_clears (
        user_id INTEGER NOT NULL, other_id INTEGER NOT NULL,
        cleared_before INTEGER NOT NULL DEFAULT 0,
        cleared_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, other_id)
      );
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(blocker_id, blocked_id)
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
        device_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(endpoint)
      );
    """
    conn.executescript(schema_sql)
    # Keep databases created by the uploaded version compatible.
    for table, column, ddl in [
        ("users", "language", "language TEXT DEFAULT 'en'"),
        ("users", "show_online", "show_online INTEGER DEFAULT 1"),
        ("users", "age", "age INTEGER"),
        ("users", "gender", "gender TEXT"),
        ("users", "country", "country TEXT"),
        ("users", "show_age", "show_age INTEGER DEFAULT 0"),
        ("users", "show_gender", "show_gender INTEGER DEFAULT 0"),
        ("users", "discoverable", "discoverable INTEGER DEFAULT 1"),
        ("messages", "expires_at", "expires_at TEXT"),
        ("messages", "edited", "edited INTEGER DEFAULT 0"),
        ("messages", "deleted_for_sender", "deleted_for_sender INTEGER DEFAULT 0"),
        ("messages", "deleted_for_receiver", "deleted_for_receiver INTEGER DEFAULT 0"),
        ("users", "show_last_seen", "show_last_seen INTEGER DEFAULT 1"),
        ("contacts", "archived", "archived INTEGER DEFAULT 0"),
        ("contacts", "muted", "muted INTEGER DEFAULT 0"),
        ("contacts", "chat_hidden", "chat_hidden INTEGER DEFAULT 0"),
        ("users", "welcome_animation", "welcome_animation INTEGER DEFAULT 1"),
        ("users", "notification_prefs", "notification_prefs TEXT"),
        ("push_subscriptions", "fcm_token", "fcm_token TEXT"),
        ("users", "banned", "banned INTEGER DEFAULT 0"),
        ("users", "ban_reason", "ban_reason TEXT"),
        ("users", "banned_at", "banned_at TEXT"),
        ("users", "is_official", "is_official INTEGER DEFAULT 0"),
        ("messages", "transcript", "transcript TEXT"),
    ]:
        names = {r["name"] for r in conn.execute("PRAGMA table_info(" + table + ")")}
        if column not in names:
            conn.execute("ALTER TABLE " + table + " ADD COLUMN " + ddl)
    for seed_name, seed_env in ((COUPLE_NAMES[0], "PROSPER_PASSWORD"), (COUPLE_NAMES[1], "CHARLENE_PASSWORD")):
        seed_password = os.environ.get(seed_env, "")
        if len(seed_password) >= 6 and not conn.execute(
                "SELECT 1 FROM users WHERE username=?", (seed_name,)).fetchone():
            conn.execute("""INSERT INTO users(username,password_hash,language,discoverable)
                            VALUES(?,?,?,0)""", (seed_name, generate_password_hash(seed_password), "en"))
    ensure_couple_linked(conn)
    conn.commit()
    conn.close()


init_db()


def purge(conn):
    now = dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?", (now,))


def pair(a, b):
    return (a, b) if a < b else (b, a)


def expiry_policy(conn, a, b):
    lo, hi = pair(a, b)
    row = conn.execute(
        "SELECT disappearing_seconds FROM chat_settings WHERE user_min=? AND user_max=?",
        (lo, hi)).fetchone()
    return int(row["disappearing_seconds"]) if row else 0


def message_payload(row, viewer_id, other_username):
    is_sender = row["sender_id"] == viewer_id
    hidden = bool(row["deleted_for_sender"] if is_sender else row["deleted_for_receiver"])
    return {
        "id": row["id"],
        "from": "me" if is_sender else other_username,
        "type": row["type"],
        "content": "" if hidden else row["content"],
        "duration": row["duration"],
        "transcript": (row["transcript"] if "transcript" in row.keys() else None),
        "sent_at": row["sent_at"],
        "delivered": bool(row["delivered"]),
        "read": bool(row["read"]),
        "expires_at": row["expires_at"],
        "edited": bool(row["edited"]),
        "deleted": hidden,
    }


def make_token(user_id):
    return jwt.encode({"user_id": user_id, "exp": dt.datetime.utcnow() + dt.timedelta(hours=24)},
                      app.config["SECRET_KEY"], algorithm="HS256")


def user_from_token(value):
    try:
        return jwt.decode(value, app.config["SECRET_KEY"], algorithms=["HS256"]).get("user_id")
    except jwt.InvalidTokenError:
        return None


def auth(handler):
    """Require a genuine, valid Bearer token. No fallback: a request with a
    missing, malformed, or expired token is rejected outright — it never
    falls through to "just use the first registered account" like an
    earlier version of this file did. That behavior meant anyone hitting a
    protected endpoint with no token at all got silently logged in as your
    first user, which is a real authentication bypass, not a convenience."""
    @wraps(handler)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        user_id = user_from_token(header.split(" ", 1)[1]) if header.startswith("Bearer ") else None
        if not user_id:
            return jsonify(error="please log in to continue"), 401
        return handler(user_id, *args, **kwargs)
    return wrapped


def auth_strict(handler):
    """Historically identical to @auth after the bypass above was removed;
    kept as a separate name so call sites that intentionally demanded the
    stricter behavior (password/avatar changes) still read
    clearly, without implying the relaxed behavior is available elsewhere.
    """
    @wraps(handler)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        user_id = user_from_token(header.split(" ", 1)[1]) if header.startswith("Bearer ") else None
        if not user_id:
            return jsonify(error="please log in again to continue"), 401
        return handler(user_id, *args, **kwargs)
    return wrapped





# --- Chat lock -------------------------------------------------------------
# Being logged in is not enough to read the chat: every time the app is
# opened (and again after it has been away for a minute) the account
# password must be entered. A correct password returns a short-lived
# "unlock" token that the browser keeps in sessionStorage and sends as
# X-Chat-Unlock; the chat endpoints below refuse (HTTP 423) without it.
# Set CHAT_LOCK=off to disable.
CHAT_LOCK = os.environ.get("CHAT_LOCK", "on").lower() != "off"
UNLOCK_HOURS = 8
UNLOCK_MAX_TRIES = 5
UNLOCK_PAUSE_SECONDS = 60
_unlock_state = {}  # user_id -> (wrong_tries, paused_until)


def make_unlock_token(user_id):
    return jwt.encode({"kind": "chat-unlock", "uid": user_id,
                       "exp": dt.datetime.utcnow() + dt.timedelta(hours=UNLOCK_HOURS)},
                      app.config["SECRET_KEY"], algorithm="HS256")


def has_unlock(user_id):
    value = request.headers.get("X-Chat-Unlock", "")
    try:
        claims = jwt.decode(value, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return False
    return claims.get("kind") == "chat-unlock" and claims.get("uid") == user_id


def chat_unlocked(handler):
    """Use under @auth on any endpoint that reads or writes the conversation."""
    @wraps(handler)
    def wrapped(user_id, *args, **kwargs):
        if CHAT_LOCK and not has_unlock(user_id):
            return jsonify(error="enter your password to open the chat", locked=True), 423
        return handler(user_id, *args, **kwargs)
    return wrapped


try:
    # firebase-admin talks to Firebase Cloud Messaging's HTTP v1 API using a
    # service account, instead of hand-rolled Web Push VAPID signing. Add
    # "firebase-admin" to requirements.txt and set FIREBASE_SERVICE_ACCOUNT_JSON
    # (the full service account JSON from Firebase console → Project
    # Settings → Service Accounts → Generate new private key) to enable
    # real push notifications. Without it, push calls are quietly skipped
    # so the rest of the app keeps working.
    import firebase_admin
    from firebase_admin import credentials as fb_credentials, messaging as fb_messaging
    _fb_key_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not _fb_key_json:
        fb_messaging = None
        print("[push] FIREBASE_SERVICE_ACCOUNT_JSON not set — push "
              "notifications are disabled until it's added.")
    elif not firebase_admin._apps:
        try:
            _fb_creds_dict = json.loads(_fb_key_json)
        except json.JSONDecodeError as exc:
            # BUGFIX: this used to fall through to the generic except below
            # with a vague message. In practice this is the #1 way Railway
            # deployments end up here: pasting the pretty-printed, multi-line
            # service account JSON straight into a Railway variable can leave
            # raw (unescaped) newlines inside the "private_key" string value,
            # which is invalid JSON — json.loads chokes on it. Say so
            # explicitly so it's fixable from the Railway logs alone.
            fb_messaging = None
            raise RuntimeError(
                "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON "
                f"({exc}). This usually means the private_key field has "
                "real line breaks in it instead of the escaped \\n from the "
                "downloaded file — re-paste the *entire* service account "
                "JSON on one line, exactly as downloaded from Firebase "
                "console → Project Settings → Service Accounts."
            ) from exc
        firebase_admin.initialize_app(fb_credentials.Certificate(_fb_creds_dict))
        print("[push] firebase-admin initialized OK — push notifications are enabled.")
    else:
        print("[push] firebase-admin already initialized.")
except ImportError:
    fb_messaging = None
    print("[push] firebase-admin not installed — push notifications are "
          "disabled. Add 'firebase-admin' to requirements.txt and set "
          "FIREBASE_SERVICE_ACCOUNT_JSON to enable them.")
except Exception as exc:  # noqa: BLE001 - a bad/malformed key shouldn't crash the app
    fb_messaging = None
    print(f"[push] could not initialize firebase-admin: {type(exc).__name__}: {exc}")

# Sanity-check the web config too, at startup rather than only when a browser
# happens to hit /firebase-config — missing pieces here mean getToken() will
# fail client-side even though the service-account half above is fine.
_fb_web_keys = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID",
                "FIREBASE_STORAGE_BUCKET", "FIREBASE_MESSAGING_SENDER_ID",
                "FIREBASE_APP_ID", "FIREBASE_VAPID_KEY"]
_fb_web_missing = [k for k in _fb_web_keys if not os.environ.get(k)]
if _fb_web_missing:
    print(f"[push] missing web config env vars: {', '.join(_fb_web_missing)} — "
          "the browser can't call getToken() until these are set on Railway "
          "(Firebase console → Project Settings → General for most of these, "
          "→ Cloud Messaging → Web Push certificates for FIREBASE_VAPID_KEY).")

DEFAULT_NOTIFICATION_PREFS = {"messages": True, "voice_notes": True}


def notification_prefs(row):
    """Parse a user row's notification_prefs JSON, filling in defaults for
    any category that's missing (e.g. added after the user last saved)."""
    prefs = dict(DEFAULT_NOTIFICATION_PREFS)
    raw = row["notification_prefs"] if row and "notification_prefs" in row.keys() else None
    if raw:
        try:
            prefs.update({k: bool(v) for k, v in json.loads(raw).items() if k in prefs})
        except (ValueError, TypeError):
            pass
    return prefs


def send_push(user_id, category, title, body, url="/chat", tag=None):
    """Push a notification to every device a user has subscribed on,
    honoring their per-category preference. Silently no-ops if
    firebase-admin isn't installed or configured — the in-app/socket
    notification still works either way, this is only the "app is closed"
    channel."""
    if fb_messaging is None:
        return
    conn = db()
    user = conn.execute("SELECT notification_prefs FROM users WHERE id=?", (user_id,)).fetchone()
    if not notification_prefs(user).get(category, True):
        conn.close()
        return
    subs = conn.execute("SELECT id,fcm_token FROM push_subscriptions WHERE user_id=?",
                        (user_id,)).fetchall()
    conn.close()
    if not subs:
        return
    stale_ids = []
    for sub in subs:
        if not sub["fcm_token"]:
            continue
        try:
            fb_messaging.send(fb_messaging.Message(
                # Data-only (no top-level `notification` field) so this
                # always reaches our own onBackgroundMessage handler in
                # sw.js for display, instead of FCM's automatic notification
                # rendering — which would skip our custom tag/vibrate/click
                # routing.
                data={"title": title, "body": body, "url": url, "tag": tag or category},
                token=sub["fcm_token"],
            ))
        except firebase_admin.messaging.UnregisteredError:
            stale_ids.append(sub["id"])  # token expired/unsubscribed on the browser's end
        except Exception as exc:  # noqa: BLE001 - keep the request path alive
            print(f"[push] send failed for user {user_id}: {type(exc).__name__}: {exc}")
    if stale_ids:
        conn = db()
        for sid_ in stale_ids:
            conn.execute("DELETE FROM push_subscriptions WHERE id=?", (sid_,))
        conn.commit()
        conn.close()


def online(user_id):
    # A live socket obviously counts. So does being inside the short grace
    # window right after the last one dropped (see pending_offline) — that
    # covers someone navigating between HwFar pages, their screen locking
    # for a moment, or a brief network blip, so a /contacts or /presence
    # request during that gap still reports them online instead of flashing
    # "offline" ahead of the socket-side presence broadcast.
    return bool(online_users.get(user_id)) or user_id in pending_offline


def visible_online(conn, user_id):
    row = conn.execute("SELECT show_online FROM users WHERE id=?", (user_id,)).fetchone()
    return online(user_id) and bool(row and row["show_online"])


def reciprocal_setting(conn, viewer_id, target_id, column):
    """WhatsApp-style reciprocity: a viewer who has turned a privacy setting
    off cannot see that same field on anyone else, regardless of whether the
    other person has it turned on."""
    if viewer_id == target_id:
        return True
    viewer = conn.execute(f"SELECT {column} FROM users WHERE id=?", (viewer_id,)).fetchone()
    target = conn.execute(f"SELECT {column} FROM users WHERE id=?", (target_id,)).fetchone()
    return bool(viewer and viewer[column]) and bool(target and target[column])


def visible_online_to(conn, viewer_id, target_id):
    return visible_online(conn, target_id) and reciprocal_setting(conn, viewer_id, target_id, "show_online")


def visible_last_seen_to(conn, viewer_id, target_id):
    return reciprocal_setting(conn, viewer_id, target_id, "show_last_seen")


def blocked_between(conn, first_id, second_id):
    return bool(conn.execute("""
        SELECT 1 FROM blocks
        WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
    """, (first_id, second_id, second_id, first_id)).fetchone())


def public_profile(conn, row, viewer_id=None):
    """Return the fields another user is allowed to see on a profile."""
    if viewer_id is None:
        viewer_id = row["id"]
    result = {
        "id": row["id"],
        "username": row["username"],
        "avatar": row["avatar"],
        "online": visible_online_to(conn, viewer_id, row["id"]),
        "last_seen": row["last_seen"] if visible_last_seen_to(conn, viewer_id, row["id"]) else None,
        "banned": bool(row["banned"]) if "banned" in row.keys() else False,
        "is_official": bool(row["is_official"]) if "is_official" in row.keys() else False,
    }
    return result














@app.post("/register")
def register():
    """Sign-up is just a name and a password. Only the two couple names are
    accepted, and there is no email, location or robot check."""
    data = request.get_json(silent=True) or {}
    username, password = (data.get("username") or "").strip(), data.get("password") or ""
    if not username or len(password) < 6:
        return jsonify(error="username required, password min 6 chars"), 400
    username = canonical_name(username)
    if not username:
        return jsonify(error="this space is only for Prosper and Charlène"), 403
    conn = db()
    try:
        conn.execute("INSERT INTO users(username,password_hash,language,discoverable) VALUES(?,?,?,0)",
                     (username, generate_password_hash(password), "en"))
        ensure_couple_linked(conn)
        conn.commit()
    except DB_INTEGRITY_ERRORS:
        conn.close()
        return jsonify(error="username already taken"), 409
    conn.close()
    return jsonify(message="registered"), 201


@app.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    conn = db()
    typed_name = (data.get("username") or "").strip()
    row = conn.execute("SELECT * FROM users WHERE username=?", (canonical_name(typed_name) or typed_name,)).fetchone()
    if row:
        ensure_couple_linked(conn)
        conn.commit()
    conn.close()
    if not row or not check_password_hash(row["password_hash"], data.get("password") or ""):
        return jsonify(error="invalid username or password"), 401
    return jsonify(access_token=make_token(row["id"]), user_id=row["id"], username=row["username"],
                   language=row["language"] or "en", avatar=row["avatar"])




@app.get("/firebase-config")
def firebase_config():
    """Public — Firebase's web config is
    meant to be embedded in the browser; it identifies the project, it
    isn't a secret credential. The actual secret (the service account key)
    stays server-side in FIREBASE_SERVICE_ACCOUNT_JSON and is never sent
    here. Returns empty values if Firebase isn't set up yet, so the
    frontend can just skip push setup."""
    return jsonify(
        apiKey=os.environ.get("FIREBASE_API_KEY", ""),
        authDomain=os.environ.get("FIREBASE_AUTH_DOMAIN", ""),
        projectId=os.environ.get("FIREBASE_PROJECT_ID", ""),
        storageBucket=os.environ.get("FIREBASE_STORAGE_BUCKET", ""),
        messagingSenderId=os.environ.get("FIREBASE_MESSAGING_SENDER_ID", ""),
        appId=os.environ.get("FIREBASE_APP_ID", ""),
        vapidKey=os.environ.get("FIREBASE_VAPID_KEY", ""),
    )


@app.post("/push/subscribe")
@auth
def push_subscribe(user_id):
    data = request.get_json(silent=True) or {}
    fcm_token = (data.get("token") or "").strip()
    if not fcm_token:
        return jsonify(error="a valid push token is required"), 400
    conn = db()
    conn.execute("""INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,device_id,fcm_token)
                    VALUES(?,?,?,?,?,?)
                    ON CONFLICT(endpoint) DO UPDATE SET
                      user_id=excluded.user_id, device_id=excluded.device_id,
                      fcm_token=excluded.fcm_token""",
                (user_id, fcm_token, "", "", data.get("device_id"), fcm_token))
    conn.commit()
    conn.close()
    return jsonify(ok=True), 201


@app.post("/push/unsubscribe")
@auth
def push_unsubscribe(user_id):
    fcm_token = (request.get_json(silent=True) or {}).get("token", "").strip()
    conn = db()
    conn.execute("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?", (user_id, fcm_token))
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.post("/account/notification-prefs")
@auth
def update_notification_prefs(user_id):
    data = request.get_json(silent=True) or {}
    conn = db()
    row = conn.execute("SELECT notification_prefs FROM users WHERE id=?", (user_id,)).fetchone()
    prefs = notification_prefs(row)
    for key in DEFAULT_NOTIFICATION_PREFS:
        if key in data:
            prefs[key] = bool(data[key])
    conn.execute("UPDATE users SET notification_prefs=? WHERE id=?", (json.dumps(prefs), user_id))
    conn.commit()
    conn.close()
    return jsonify(prefs)


@app.post("/account/unlock")
@auth
def account_unlock(user_id):
    """Check the account password and hand back an unlock token."""
    now = time.time()
    tries, paused_until = _unlock_state.get(user_id, (0, 0))
    if paused_until > now:
        wait = int(paused_until - now) + 1
        return jsonify(error=f"too many wrong attempts, try again in {wait}s"), 429
    password = (request.get_json(silent=True) or {}).get("password") or ""
    conn = db()
    row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    if not row or not check_password_hash(row["password_hash"], password):
        tries += 1
        _unlock_state[user_id] = (0, now + UNLOCK_PAUSE_SECONDS) if tries >= UNLOCK_MAX_TRIES else (tries, 0)
        return jsonify(error="incorrect password"), 403
    _unlock_state.pop(user_id, None)
    return jsonify(unlock_token=make_unlock_token(user_id), hours=UNLOCK_HOURS)


@app.get("/account/unlock/check")
@auth
@chat_unlocked
def account_unlock_check(user_id):
    return jsonify(unlocked=True)


@app.get("/account/me")
@auth
def account_me(user_id):
    conn = db()
    row = conn.execute("""SELECT id,username,language,avatar,
      show_online,discoverable,show_last_seen,
      welcome_animation,notification_prefs
      FROM users WHERE id=?""",
                       (user_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify(error="not found"), 404
    result = dict(row)
    result["notification_prefs"] = notification_prefs(row)
    return jsonify(result)












@app.post("/account/privacy")
@auth
def privacy(user_id):
    data = request.get_json(silent=True) or {}
    allowed = {
        "show_online", "show_last_seen",
    }
    if not any(key in data for key in allowed):
        return jsonify(error="a privacy setting is required"), 400
    conn = db()
    updates, values = [], []
    for key in allowed:
        if key in data:
            updates.append(f"{key}=?")
            values.append(1 if data[key] else 0)
    values.append(user_id)
    conn.execute(f"UPDATE users SET {','.join(updates)} WHERE id=?", values)
    conn.commit()
    conn.close()
    broadcast_presence(user_id, online(user_id))
    return jsonify({key: bool(data[key]) for key in allowed if key in data})


@app.post("/account/username")
@auth
def username(user_id):
    name = (request.get_json(silent=True) or {}).get("username", "").strip()
    if not 2 <= len(name) <= 24:
        return jsonify(error="username must be 2-24 characters"), 400
    conn = db()
    try:
        conn.execute("UPDATE users SET username=? WHERE id=?", (name, user_id))
        conn.commit()
    except DB_INTEGRITY_ERRORS:
        conn.close()
        return jsonify(error="username already taken"), 409
    conn.close()
    return jsonify(username=name)


@app.post("/account/language")
@auth
def language(user_id):
    language = (request.get_json(silent=True) or {}).get("language")
    if language not in ("en", "fr"):
        return jsonify(error="language must be 'en' or 'fr'"), 400
    conn = db()
    conn.execute("UPDATE users SET language=? WHERE id=?", (language, user_id))
    conn.commit()
    conn.close()
    return jsonify(language=language)


@app.post("/account/avatar")
@auth_strict
def account_avatar(user_id):
    avatar = (request.get_json(silent=True) or {}).get("avatar") or ""
    if not avatar.startswith("data:image/") or len(avatar) > 2_500_000:
        return jsonify(error="profile photo must be an image smaller than 2 MB"), 400
    conn = db()
    conn.execute("UPDATE users SET avatar=? WHERE id=?", (avatar, user_id))
    conn.commit()
    conn.close()
    broadcast_presence(user_id, online(user_id))
    return jsonify(avatar=avatar)


@app.post("/account/password")
@auth_strict
def account_password(user_id):
    data = request.get_json(silent=True) or {}
    current, new_password = data.get("current_password") or "", data.get("new_password") or ""
    if len(new_password) < 6:
        return jsonify(error="new password must be at least 6 characters"), 400
    conn = db()
    row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], current):
        conn.close()
        return jsonify(error="current password is incorrect"), 401
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new_password), user_id))
    conn.commit()
    conn.close()
    return jsonify(message="password updated")


@app.get("/contacts")
@auth
@chat_unlocked
def contacts(user_id):
    conn = db()
    purge(conn)
    ensure_couple_linked(conn)
    conn.commit()
    rows = conn.execute("""
      SELECT u.id,u.username,u.avatar,u.last_seen,u.banned,u.is_official,
             c.archived AS archived, c.muted AS muted
      FROM contacts c JOIN users u ON u.id=c.contact_id
      WHERE c.owner_id=? AND COALESCE(c.chat_hidden,0)=0
    """, (user_id,)).fetchall()
    result = []
    for row in rows:
        if blocked_between(conn, user_id, row["id"]):
            continue
        cleared = clear_marker(conn, user_id, row["id"])
        last = conn.execute("""SELECT content,type,sent_at,sender_id FROM messages
          WHERE id>? AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
          ORDER BY id DESC LIMIT 1""", (cleared, user_id, row["id"], row["id"], user_id)).fetchone()
        unread = conn.execute("""SELECT COUNT(*) AS c FROM messages
          WHERE id>? AND sender_id=? AND receiver_id=? AND read=0""",
                              (cleared, row["id"], user_id)).fetchone()["c"]
        item = {
            "id": row["id"], "username": row["username"], "avatar": row["avatar"],
            "last_seen": row["last_seen"], "banned": bool(row["banned"]),
            "is_official": bool(row["is_official"]),
            "last_content": last["content"] if last else None,
            "last_type": last["type"] if last else None,
            "last_sent_at": last["sent_at"] if last else None,
            "unread_count": unread,
            "archived": bool(row["archived"]), "muted": bool(row["muted"]),
            "online": visible_online_to(conn, user_id, row["id"]),
            "last_mine": bool(last and last["sender_id"] == user_id),
        }
        if item["last_type"] == "voice":
            item["last_content"] = "Voice message"
        elif item["last_type"] == "image":
            item["last_content"] = "Photo"
        elif item["last_type"] == "video":
            item["last_content"] = "Video"
        result.append(item)
    conn.close()
    result.sort(key=lambda i: i["username"])
    result.sort(key=lambda i: i["last_sent_at"] or "", reverse=True)
    return jsonify(result)






@app.get("/profile/<name>")
@auth
def profile(user_id, name):
    conn = db()
    row = conn.execute("""SELECT id,username,avatar,country,age,gender,show_age,show_gender,last_seen,banned,is_official
                          FROM users WHERE username=?""", (name,)).fetchone()
    if not row:
        conn.close()
        return jsonify(error="no such user"), 404
    result = public_profile(conn, row, user_id)
    conn.close()
    return jsonify(result)


@app.post("/users/<name>/block")
@auth
def block_user(user_id, name):
    conn = db()
    target = conn.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    if target["id"] == user_id:
        conn.close()
        return jsonify(error="you cannot block yourself"), 400
    conn.execute("INSERT INTO blocks(blocker_id,blocked_id) VALUES(?,?) "
                "ON CONFLICT (blocker_id,blocked_id) DO NOTHING",
                 (user_id, target["id"]))
    conn.commit()
    conn.close()
    return jsonify(blocked=True, username=name)


@app.post("/users/<name>/unblock")
@auth
def unblock_user(user_id, name):
    conn = db()
    target = conn.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    conn.execute("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?", (user_id, target["id"]))
    conn.commit()
    conn.close()
    return jsonify(blocked=False, username=name)


@app.get("/blocked")
@auth
def blocked_list(user_id):
    conn = db()
    rows = conn.execute("""
      SELECT u.username, u.avatar, b.created_at
      FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=? ORDER BY b.created_at DESC
    """, (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])


@app.post("/contacts/<name>/archive")
@auth
def archive_contact(user_id, name):
    data = request.get_json(silent=True) or {}
    archived = 1 if data.get("archived", True) else 0
    conn = db()
    target = conn.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    cur = conn.execute("UPDATE contacts SET archived=? WHERE owner_id=? AND contact_id=?",
                       (archived, user_id, target["id"]))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return jsonify(error="that user is not in your contacts"), 404
    return jsonify(archived=bool(archived), username=name)


@app.post("/contacts/<name>/mute")
@auth
def mute_contact(user_id, name):
    data = request.get_json(silent=True) or {}
    muted = 1 if data.get("muted", True) else 0
    conn = db()
    target = conn.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    cur = conn.execute("UPDATE contacts SET muted=? WHERE owner_id=? AND contact_id=?",
                       (muted, user_id, target["id"]))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return jsonify(error="that user is not in your contacts"), 404
    return jsonify(muted=bool(muted), username=name)



























































@app.post("/send")
@auth
@chat_unlocked
def send(user_id):
    data = request.get_json(silent=True) or {}
    to = (data.get("to") or "").strip()
    to = canonical_name(to) or to
    kind, content = data.get("type", "text"), data.get("content", "")
    raw_transcript = data.get("transcript")
    transcript = raw_transcript.strip()[:4000] if kind == "voice" and isinstance(raw_transcript, str) else None
    if kind not in ("text", "voice", "image", "video") or not to:
        return jsonify(error="recipient and valid type are required"), 400
    if kind == "text":
        content = content.strip()
        if not content:
            return jsonify(error="content is required"), 400
    else:
        prefixes = {"voice": "data:audio", "image": "data:image", "video": "data:video"}
        if not isinstance(content, str) or not content.startswith(prefixes[kind]):
            return jsonify(error=f"{kind} content must be a data URL"), 400
        if len(content) > 18_000_000:
            return jsonify(error="media must be smaller than 12 MB"), 413
    conn = db()
    purge(conn)
    receiver = conn.execute("SELECT id,username,language FROM users WHERE username=?", (to,)).fetchone()
    sender = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
    if not receiver:
        conn.close()
        return jsonify(error="no such user"), 404
    if receiver["id"] == user_id:
        conn.close()
        return jsonify(error="you cannot message yourself"), 400
    if COUPLE_MODE and not is_couple_pair(sender["username"], receiver["username"]):
        conn.close()
        return jsonify(error="this is a private chat for Prosper and Charlène"), 403
    if blocked_between(conn, user_id, receiver["id"]):
        conn.close()
        return jsonify(error="this conversation is blocked"), 403
    conn.execute("INSERT INTO contacts(owner_id,contact_id) VALUES(?,?) "
                "ON CONFLICT (owner_id,contact_id) DO NOTHING", (user_id, receiver["id"]))
    conn.execute("INSERT INTO contacts(owner_id,contact_id) VALUES(?,?) "
                "ON CONFLICT (owner_id,contact_id) DO NOTHING", (receiver["id"], user_id))
    # A chat one of them deleted comes back as soon as a new message is sent.
    conn.execute("UPDATE contacts SET chat_hidden=0 WHERE (owner_id=? AND contact_id=?) OR (owner_id=? AND contact_id=?)",
                 (user_id, receiver["id"], receiver["id"], user_id))
    seconds = expiry_policy(conn, user_id, receiver["id"])
    expires = (dt.datetime.utcnow() + dt.timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S") if seconds else None
    cur = conn.execute("""INSERT INTO messages(sender_id,receiver_id,type,content,duration,transcript,delivered,expires_at)
                         VALUES(?,?,?,?,?,?,?,?)""",
                       (user_id, receiver["id"], kind, content, data.get("duration"), transcript or None,
                        1 if online(receiver["id"]) else 0, expires))
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id=?", (new_id,)).fetchone()
    conn.close()
    payload = {"id":row["id"],"from":"me","to":to,"type":row["type"],"content":row["content"],
               "duration":row["duration"],"transcript":transcript or None,"sent_at":row["sent_at"],"delivered":bool(row["delivered"]),
               "read":bool(row["read"]),"expires_at":row["expires_at"],"edited":False,"deleted":False}
    incoming = dict(payload)
    incoming["from"] = sender["username"]
    socketio.emit("new_message", incoming, room=f"user_{receiver['id']}")
    if payload["delivered"]:
        socketio.emit("message_status", {"ids":[row["id"]],"status":"delivered"}, room=f"user_{user_id}")
    conn2 = db()
    mute_row = conn2.execute("SELECT muted FROM contacts WHERE owner_id=? AND contact_id=?",
                             (receiver["id"], user_id)).fetchone()
    conn2.close()
    if not (mute_row and mute_row["muted"]):
        # Muting a contact (like WhatsApp) only silences push alerts — the
        # message still sends, delivers, and ticks normally either way.
        # Push text follows the receiver's chosen language (English / Français).
        receiver_lang = (receiver["language"] if "language" in receiver.keys() else "en") or "en"
        if receiver_lang == "fr":
            push_bodies = {"voice": "🎤 Message vocal", "image": "📷 Photo", "video": "🎥 Vidéo"}
        else:
            push_bodies = {"voice": "🎤 Voice message", "image": "📷 Photo", "video": "🎥 Video"}
        send_push(
            receiver["id"],
            "voice_notes" if row["type"] == "voice" else "messages",
            sender["username"],
            push_bodies.get(row["type"], row["content"][:120]),
            url=f"/chat/{urllib.parse.quote(sender['username'])}",
            tag="msg-" + sender["username"],
        )
    return jsonify(payload), 201


_translation_cache = {}


def _split_for_translation(text, limit=450):
    """The free translation service accepts ~500 characters per request, so
    long messages are cut at sentence/space boundaries and joined again."""
    chunks, current = [], ""
    for part in re.split(r"(?<=[.!?\n])\s+", text):
        while len(part) > limit:
            cut = part.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                chunks.append(current); current = ""
            chunks.append(part[:cut]); part = part[cut:].lstrip()
        if len(current) + len(part) + 1 > limit and current:
            chunks.append(current); current = part
        else:
            current = (current + " " + part).strip()
    if current:
        chunks.append(current)
    return chunks


@app.post("/translate")
@auth
def translate_message(user_id):
    """Translate one message's text into the person's chosen language (en/fr).
    The source language is auto-detected."""
    import html as _html
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    target = data.get("target")
    if target not in ("en", "fr"):
        return jsonify(error="language must be 'en' or 'fr'"), 400
    if not text:
        return jsonify(error="content is required"), 400
    text = text[:4000]
    key = (target, text)
    if key in _translation_cache:
        return jsonify(translation=_translation_cache[key])
    out = []
    try:
        for chunk in _split_for_translation(text):
            url = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode(
                {"q": chunk, "langpair": f"Autodetect|{target}"})
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "chat-translate"}), timeout=8) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            translated = (payload.get("responseData") or {}).get("translatedText")
            if not translated or str(payload.get("responseStatus")) != "200":
                raise ValueError("no translation returned")
            out.append(_html.unescape(translated))
    except Exception as exc:  # noqa: BLE001 - network/service problems must not crash the chat
        print(f"[translate] failed: {type(exc).__name__}: {exc}")
        return jsonify(error="translation is unavailable right now"), 502
    result = " ".join(out)
    if len(_translation_cache) > 500:
        _translation_cache.clear()
    _translation_cache[key] = result
    return jsonify(translation=result)


@app.post("/transcribe/<int:message_id>")
@auth
@chat_unlocked
def transcribe_voice(user_id, message_id):
    """Voice note -> text with a Whisper API. Set GROQ_API_KEY (free tier) or
    OPENAI_API_KEY in the environment / .env. The result is saved on the message."""
    conn = db()
    row = conn.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
    conn.close()
    if not row or user_id not in (row["sender_id"], row["receiver_id"]) or row["type"] != "voice":
        return jsonify(error="voice note not found"), 404
    existing = row["transcript"] if "transcript" in row.keys() else None
    if existing:
        return jsonify(transcript=existing)
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if groq_key:
        url, model, key = "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo", groq_key
    elif openai_key:
        url, model, key = "https://api.openai.com/v1/audio/transcriptions", "whisper-1", openai_key
    else:
        return jsonify(error="speech-to-text is not set up on the server"), 501
    found = re.match(r"data:(audio/[a-z0-9.+-]+)[^,]*,(.*)$", row["content"] or "", re.S | re.I)
    if not found:
        return jsonify(error="this voice note cannot be read"), 400
    mime = found.group(1).lower()
    try:
        audio = base64.b64decode(found.group(2))
    except Exception:  # noqa: BLE001
        return jsonify(error="this voice note cannot be read"), 400
    ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
           "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac"}.get(mime, "webm")
    boundary = secrets.token_hex(16)
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.{ext}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode() + audio + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {key}", "User-Agent": "chat-transcribe",
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = (json.loads(resp.read().decode("utf-8")).get("text") or "").strip()
    except Exception as exc:  # noqa: BLE001 - a failing service must not crash the chat
        print(f"[transcribe] failed: {type(exc).__name__}: {exc}")
        return jsonify(error="transcription is unavailable right now"), 502
    if not text:
        return jsonify(error="no speech was found in this voice note"), 422
    conn = db()
    conn.execute("UPDATE messages SET transcript=? WHERE id=?", (text[:4000], message_id))
    conn.commit()
    conn.close()
    return jsonify(transcript=text[:4000])


@app.get("/messages/<other>")
@auth
@chat_unlocked
def messages(user_id, other):
    conn = db()
    purge(conn)
    target = resolve_user(conn, other)
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    cleared = clear_marker(conn, user_id, target["id"])
    rows = conn.execute("""SELECT * FROM messages WHERE id>? AND
      ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
      ORDER BY id ASC""", (cleared, user_id,target["id"],target["id"],user_id)).fetchall()
    conn.commit()
    conn.close()
    return jsonify([message_payload(r, user_id, target["username"]) for r in rows])


@app.get("/messages/<other>/media")
@auth
@chat_unlocked
def shared_media(user_id, other):
    conn = db()
    purge(conn)
    target = conn.execute("SELECT id FROM users WHERE username=?", (other,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    cleared = clear_marker(conn, user_id, target["id"])
    rows = conn.execute("""SELECT id,type,content,sent_at FROM messages WHERE
      id>? AND type IN ('image','video') AND (
        (sender_id=? AND receiver_id=? AND deleted_for_sender=0) OR
        (sender_id=? AND receiver_id=? AND deleted_for_receiver=0)
      ) ORDER BY id DESC""", (cleared, user_id, target["id"], target["id"], user_id)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/messages/<other>/read")
@auth
@chat_unlocked
def mark_read(user_id, other):
    conn = db()
    purge(conn)
    target = conn.execute("SELECT id FROM users WHERE username=?", (other,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    rows = conn.execute("SELECT id FROM messages WHERE sender_id=? AND receiver_id=? AND read=0",
                        (target["id"], user_id)).fetchall()
    ids = [r["id"] for r in rows]
    if ids:
        marks = ",".join("?" for _ in ids)
        conn.execute(f"UPDATE messages SET read=1,delivered=1 WHERE id IN ({marks})", ids)
        conn.commit()
    conn.close()
    if ids:
        socketio.emit("message_status", {"ids":ids,"status":"read"}, room=f"user_{target['id']}")
    return jsonify(read_ids=ids)


@app.route("/messages/<int:message_id>", methods=["PATCH", "DELETE"])
@auth
@chat_unlocked
def message_action(user_id, message_id):
    conn = db()
    row = conn.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
    if not row or row["sender_id"] != user_id:
        conn.close()
        return jsonify(error="only your own messages can be changed"), 403
    sender = conn.execute("SELECT username FROM users WHERE id=?", (row["sender_id"],)).fetchone()
    receiver = conn.execute("SELECT username FROM users WHERE id=?", (row["receiver_id"],)).fetchone()
    if request.method == "PATCH":
        content = (request.get_json(silent=True) or {}).get("content", "").strip()
        if row["type"] != "text" or row["deleted_for_sender"] or row["deleted_for_receiver"]:
            conn.close()
            return jsonify(error="only active text messages can be edited"), 400
        if not content or len(content) > 4000:
            conn.close()
            return jsonify(error="message must contain 1-4000 characters"), 400
        conn.execute("UPDATE messages SET content=?, edited=1 WHERE id=?", (content, message_id))
        conn.commit()
        row = conn.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
        mine = message_payload(row, user_id, receiver["username"])
        theirs = message_payload(row, row["receiver_id"], sender["username"])
        conn.close()
        socketio.emit("message_updated", theirs, room=f"user_{row['receiver_id']}")
        return jsonify(mine)
    # WhatsApp-style rule: once read, delete only from the sender's view.
    if row["read"]:
        conn.execute("UPDATE messages SET deleted_for_sender=1 WHERE id=?", (message_id,))
    else:
        conn.execute("UPDATE messages SET deleted_for_sender=1,deleted_for_receiver=1 WHERE id=?", (message_id,))
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
    mine = message_payload(row, user_id, receiver["username"])
    theirs = message_payload(row, row["receiver_id"], sender["username"])
    affects_receiver = not bool(row["read"])
    conn.close()
    if affects_receiver:
        socketio.emit("message_updated", theirs, room=f"user_{row['receiver_id']}")
    return jsonify(mine)


@app.get("/couple/partner")
@auth
@chat_unlocked
def couple_partner(user_id):
    """Who is 'the other one'? Used by the New message screen."""
    conn = db()
    me = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
    name = partner_of(me["username"]) if me else None
    if not name:
        conn.close()
        return jsonify(error="this app is only for Prosper and Charlène"), 404
    partner = conn.execute("SELECT id,username,avatar,last_seen FROM users WHERE username=?", (name,)).fetchone()
    if not partner:
        conn.close()
        return jsonify(error=f"{name} hasn't joined yet"), 404
    result = {
        "username": partner["username"], "avatar": partner["avatar"],
        "online": visible_online_to(conn, user_id, partner["id"]),
        "last_seen": partner["last_seen"] if visible_last_seen_to(conn, user_id, partner["id"]) else None,
        "blocked": bool(conn.execute("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?",
                                     (user_id, partner["id"])).fetchone()),
        "blocked_me": bool(conn.execute("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?",
                                        (partner["id"], user_id)).fetchone()),
    }
    conn.close()
    return jsonify(result)


def _clear_chat_for(conn, user_id, other_id):
    row = conn.execute("""SELECT MAX(id) AS m FROM messages WHERE
      (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)""",
                       (user_id, other_id, other_id, user_id)).fetchone()
    cleared = max(int(row["m"] or 0), clear_marker(conn, user_id, other_id))
    conn.execute("""INSERT INTO chat_clears(user_id,other_id,cleared_before) VALUES(?,?,?)
      ON CONFLICT(user_id,other_id) DO UPDATE SET
      cleared_before=excluded.cleared_before, cleared_at=CURRENT_TIMESTAMP""",
                 (user_id, other_id, cleared))
    return cleared


@app.post("/chat/<name>/clear")
@auth
@chat_unlocked
def clear_chat(user_id, name):
    """Empty the conversation on MY side only. The chat stays in my list and
    the other person keeps their copy."""
    conn = db()
    target = resolve_user(conn, name)
    if not target or target["id"] == user_id:
        conn.close()
        return jsonify(error="no such chat"), 404
    _clear_chat_for(conn, user_id, target["id"])
    conn.commit()
    conn.close()
    return jsonify(cleared=True, username=target["username"])


@app.post("/chat/<name>/delete")
@auth
@chat_unlocked
def delete_chat(user_id, name):
    """Delete the chat on MY side: wipes my history and removes it from my
    list. It comes back (empty) when either of us sends a new message."""
    conn = db()
    target = resolve_user(conn, name)
    if not target or target["id"] == user_id:
        conn.close()
        return jsonify(error="no such chat"), 404
    _clear_chat_for(conn, user_id, target["id"])
    conn.execute("UPDATE contacts SET chat_hidden=1 WHERE owner_id=? AND contact_id=?",
                 (user_id, target["id"]))
    conn.commit()
    conn.close()
    return jsonify(deleted=True, username=target["username"])


@app.get("/presence/<name>")
@auth
def presence(user_id, name):
    conn = db()
    row = conn.execute("SELECT id,last_seen FROM users WHERE username=?", (name,)).fetchone()
    if not row:
        conn.close()
        return jsonify(error="no such user"), 404
    result = {
        "online": visible_online_to(conn, user_id, row["id"]),
        "last_seen": row["last_seen"] if visible_last_seen_to(conn, user_id, row["id"]) else None,
    }
    conn.close()
    return jsonify(result)


@app.route("/chat/<name>/disappearing", methods=["GET", "POST"])
@auth
@chat_unlocked
def disappearing(user_id, name):
    valid = {0, 86400, 604800, 7776000}
    conn = db()
    target = conn.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()
    if not target:
        conn.close()
        return jsonify(error="no such user"), 404
    lo, hi = pair(user_id, target["id"])
    if request.method == "POST":
        try: seconds = int((request.get_json(silent=True) or {}).get("seconds", 0))
        except (TypeError, ValueError): seconds = -1
        if seconds not in valid:
            conn.close()
            return jsonify(error="unsupported timer"), 400
        conn.execute("""INSERT INTO chat_settings(user_min,user_max,disappearing_seconds,updated_by)
          VALUES(?,?,?,?) ON CONFLICT(user_min,user_max) DO UPDATE SET
          disappearing_seconds=excluded.disappearing_seconds,updated_by=excluded.updated_by,
          updated_at=CURRENT_TIMESTAMP""", (lo,hi,seconds,user_id))
        conn.commit()
    row = conn.execute("SELECT disappearing_seconds FROM chat_settings WHERE user_min=? AND user_max=?",
                       (lo,hi)).fetchone()
    conn.close()
    return jsonify(seconds=int(row["disappearing_seconds"]) if row else 0)


def broadcast_presence(user_id, is_online):
    conn = db()
    me = conn.execute("SELECT username,last_seen FROM users WHERE id=?", (user_id,)).fetchone()
    owners = conn.execute("SELECT owner_id FROM contacts WHERE contact_id=?", (user_id,)).fetchall()
    if not me:
        conn.close()
        return
    for row in owners:
        viewer_id = row["owner_id"]
        payload = {
            "username": me["username"],
            "online": bool(is_online) and visible_online_to(conn, viewer_id, user_id),
            "last_seen": me["last_seen"] if visible_last_seen_to(conn, viewer_id, user_id) else None,
        }
        socketio.emit("presence", payload, room=f"user_{viewer_id}")
    conn.close()


def _finalize_offline(user_id):
    """Runs once PRESENCE_GRACE_SECONDS after a user's last socket dropped.
    If they reconnected in the meantime (any HwFar page — chat, settings,
    stories all keep a socket alive) this is a no-op; online_users will
    already have their new sid."""
    pending_offline.pop(user_id, None)
    if online_users.get(user_id):
        return
    try:
        conn = db()
        try:
            conn.execute("UPDATE users SET last_seen=? WHERE id=?",
                         (dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), user_id))
            conn.commit()
        finally:
            conn.close()
        broadcast_presence(user_id, False)
    except Exception as exc:  # a timer thread must never die silently
        print(f"[presence] could not finalize offline for user {user_id}: {type(exc).__name__}: {exc}")


@app.get("/")
def home(): return render_template("index.html")




@app.get("/chat")
def chat_page(): return render_template("chat.html", active_username=None)


@app.get("/chat/<name>")
def chat_thread_page(name): return render_template("chat.html", active_username=name)


@app.get("/settings")
def settings_page(): return render_template("settings.html", settings_section="root")


@app.get("/settings/<section>")
def settings_section_page(section):
    valid = {"account","privacy","appearance","notifications","language","blocked"}
    if section not in valid: return render_template("settings.html", settings_section="root"), 404
    return render_template("settings.html", settings_section=section)






@app.get("/new-chat")
def new_chat_page(): return render_template("new_chat.html", prefill_to=request.args.get("to", ""))






@socketio.on("connect")
def socket_connect(auth_data):
    user_id = user_from_token((auth_data or {}).get("token", ""))
    if not user_id: return False
    join_room(f"user_{user_id}")
    online_users.setdefault(user_id, set()).add(request.sid)
    sid_to_user[request.sid] = user_id
    timer = pending_offline.pop(user_id, None)
    if timer:
        # They reconnected inside the grace window (page navigation, a
        # locked screen waking up, a brief drop) — cancel the scheduled
        # "offline" broadcast so contacts never saw them leave.
        timer.cancel()
    conn = db()
    pending = conn.execute("SELECT id,sender_id FROM messages WHERE receiver_id=? AND delivered=0", (user_id,)).fetchall()
    if pending:
        ids = [r["id"] for r in pending]
        conn.execute(f"UPDATE messages SET delivered=1 WHERE id IN ({','.join('?' for _ in ids)})", ids)
        conn.commit()
    conn.close()
    for sender in {r["sender_id"] for r in pending}:
        socketio.emit("message_status", {"ids":[r["id"] for r in pending if r["sender_id"]==sender],
                                         "status":"delivered"}, room=f"user_{sender}")
    broadcast_presence(user_id, True)


@socketio.on("disconnect")
def socket_disconnect():
    user_id = sid_to_user.pop(request.sid, None)
    if user_id is None: return
    online_users.get(user_id, set()).discard(request.sid)
    if not online_users.get(user_id):
        online_users.pop(user_id, None)
        old_timer = pending_offline.pop(user_id, None)
        if old_timer:
            old_timer.cancel()
        # Don't mark them offline yet — schedule it for after the grace
        # window and only go through with it if they still haven't
        # reconnected by then (see _finalize_offline).
        timer = threading.Timer(PRESENCE_GRACE_SECONDS, _finalize_offline, args=(user_id,))
        timer.daemon = True
        pending_offline[user_id] = timer
        timer.start()


@socketio.on("typing")
def typing(data):
    user_id = sid_to_user.get(request.sid)
    if not user_id: return
    conn = db()
    me = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
    target = conn.execute("SELECT id FROM users WHERE username=?", ((data or {}).get("to"),)).fetchone()
    conn.close()
    if me and target:
        socketio.emit("typing", {"from":me["username"],"active":bool((data or {}).get("active"))},
                      room=f"user_{target['id']}")












if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"{APP_NAME} running on port {port}")
    # (Firebase and TURN env var checks now happen once at import time,
    # right after firebase-admin initializes — see near the top of the file.)
    # threading mode: Werkzeug is fine for local use; in production run
    # gunicorn (see Procfile) instead.
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)
