/* HwFar's browser client. Pages are server-rendered; this file only owns
   interactions and the live transport for the page currently on screen. */
const $ = (s) => document.querySelector(s);
const esc = (value) => { const d = document.createElement('div'); d.textContent = value == null ? '' : value; return d.innerHTML; };
const token = () => localStorage.getItem('chatly_token');
const api = async (path, options = {}) => {
  // A FormData body (real file upload, WhatsApp-style) must NOT get a manual
  // Content-Type: fetch/the browser sets 'multipart/form-data; boundary=...'
  // itself, and overriding it here breaks the upload silently (server sees
  // valid-looking JSON headers on a binary body and rejects/mis-parses it).
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {...(isForm ? {} : {'Content-Type':'application/json'}), ...(options.headers || {})};
  if (token()) headers.Authorization = 'Bearer ' + token();
  const loveUnlock = sessionStorage.getItem('love_unlock'); if (loveUnlock) headers['X-Chat-Unlock'] = loveUnlock;
  try {
    const res = await fetch(path, {...options, headers});
    const raw = await res.text().catch(()=>'');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = null; }
    if (!res.ok && !body?.error) {
      // BUGFIX: whatever came back wasn't the {error: "..."} JSON shape the
      // rest of the app expects — something in front of Flask (Railway's
      // edge, a body-size limit, a gateway timeout) can reject a request
      // with a plain-text or empty response instead of a real JSON error.
      // That used to leave `body` as null, so EVERY caller fell back to
      // its own generic "could not be posted/saved/updated" message with
      // zero information — which is exactly why a real failure (e.g. a
      // video status rejected upstream of the app) looked like an
      // unexplained dead end. Now the actual HTTP status and a snippet of
      // whatever was actually returned are shown directly, so the very
      // next failure is diagnosable from a screenshot — no server logs or
      // browser console access needed.
      const snippet = raw.replace(/\s+/g,' ').trim().slice(0,140);
      body = {error: `Server error ${res.status}${snippet ? ': ' + snippet : ' (server returned no details — likely rejected by a proxy in front of the app, e.g. a file-size limit)'}`};
    }
    if (res.status === 423) { sessionStorage.removeItem('love_unlock'); if (window.loveLock) window.loveLock.show(); }
    if (res.status === 401 && location.pathname !== '/') { localStorage.removeItem('chatly_token'); location.href = '/'; }
    if(body&&typeof body.error==='string')body.error=tr(body.error);
    return {ok:res.ok, status:res.status, body};
  } catch (exc) {
    return {ok:false,status:0,body:{error:tr('Could not reach the server: '+(exc?.message||'network error')+'. Check your connection and try again.')}};
  }
};
const avatarColor = (name) => {
  let n = 0; for (const c of name || '?') n = c.charCodeAt(0) + ((n << 5) - n);
  return ['#00a884','#6b7fd7','#d77e9c','#d7a94a','#4aa9d7','#9b6bd7','#d76b6b'][Math.abs(n) % 7];
};
const avatar = (user, image, size=44, online=false) => `<div class="avatar" style="width:${size}px;height:${size}px;background:${image?'transparent':avatarColor(user)}">${image ? `<img src="${esc(image)}" alt="">` : esc((user||'?').slice(0,2).toUpperCase())}${online ? '<span class="dot"></span>' : '<span class="dot off"></span>'}</div>`;
// Chrome/Android default to audio/webm, which Safari (macOS/iOS) cannot record
// or play. Picking the first type the current browser actually supports keeps
// voice notes working the same way on PC, iPhone, and Android.
const pickAudioMimeType = () => {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  // Chrome/Firefox/Android support (and prefer) webm/opus; Safari on macOS
  // and iOS support neither and need audio/mp4 instead — isTypeSupported
  // lets each browser pick its own best-working format automatically.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
  return candidates.find(type => { try { return MediaRecorder.isTypeSupported(type); } catch (_) { return false; } }) || '';
};
/* ---- Language (English / Français) ----
   Every visible string goes through trText(): exact matches come from
   I18N.fr, strings that contain a name or number from I18N_PATTERNS.
   The popup on first launch (see showLanguagePopup) picks the language. */
const I18N={fr:{
  /* sign in / sign up */
  "Prosper & Charlène — sign in":"Prosper & Charlène — connexion",
  "Just the two of us.":"Rien que nous deux.",
  "Your private little world for messages, calls and moments, only for Prosper and Charlène.":"Votre petit monde privé pour les messages, les appels et les moments, rien que pour Prosper et Charlène.",
  "♥ Private · Just for two":"♥ Privé · Rien que pour deux",
  "Skip welcome motion":"Passer l’animation d’accueil",
  "Install the app":"Installer l’application","⭳ Install app":"⭳ Installer l’app","✓ Installed":"✓ Installée",
  "Welcome back, love":"Bon retour, mon amour","Sign in to get back to your person.":"Connecte-toi pour retrouver ta moitié.",
  "Your name (Prosper or Charlène)":"Ton prénom (Prosper ou Charlène)","Password":"Mot de passe","Log in ♥":"Se connecter ♥",
  "Just a name and a password. This space only opens for Prosper and Charlène.":"Juste un prénom et un mot de passe. Cet espace ne s’ouvre que pour Prosper et Charlène.",
  "Password (6+ characters)":"Mot de passe (6 caractères minimum)","Create account ♥":"Créer le compte ♥",
  "First time here?":"Première visite ?","Set up my account":"Créer mon compte",
  "Private by design.":"Privé par conception.","Only Prosper and Charlène can have an account here.":"Seuls Prosper et Charlène peuvent avoir un compte ici.",
  "Toggle theme":"Changer de thème","Create your account":"Crée ton compte","Just a name and a password.":"Juste un prénom et un mot de passe.",
  "Already have an account?":"Déjà un compte ?","Log in":"Se connecter","Welcome back":"Bon retour",
  "Enter your name.":"Entre ton prénom.","Your password needs at least 6 characters.":"Ton mot de passe doit contenir au moins 6 caractères.",
  "Could not create account.":"Impossible de créer le compte.","Account created. Please log in.":"Compte créé. Connecte-toi.",
  "Invalid username or password.":"Nom d’utilisateur ou mot de passe invalide.",
  /* offline */
  "Prosper & Charlène — Offline":"Prosper & Charlène — Hors ligne","You’re offline":"Tu es hors ligne",
  "We’ll reconnect automatically as soon as your internet is back.":"Nous nous reconnecterons automatiquement dès que ta connexion reviendra.",
  /* chats page */
  "Prosper & Charlène — chats":"Prosper & Charlène — discussions","Prosper & Charlène — new message":"Prosper & Charlène — nouveau message","Prosper & Charlène — settings":"Prosper & Charlène — paramètres",
  "New message":"Nouveau message","Settings":"Paramètres","Log out":"Se déconnecter","Chats":"Discussions","New":"Nouveau",
  "Search your messages":"Rechercher dans tes messages","Archived (":"Archivées (","Back":"Retour","View profile":"Voir le profil",
  "Disappearing messages":"Messages éphémères","Off":"Désactivé","24h":"24 h","7d":"7 j","90d":"90 j","More options":"Plus d’options","More":"Plus",
  "Archive chat":"Archiver la discussion","Unarchive chat":"Désarchiver la discussion","Clear chat":"Vider la discussion","Delete chat":"Supprimer la discussion","Block user":"Bloquer l’utilisateur",
  "Add an attachment":"Ajouter une pièce jointe","Write something sweet…":"Écris quelque chose de doux…",
  "Tap to record, tap again to send":"Appuie pour enregistrer, appuie encore pour envoyer","Send message":"Envoyer le message",
  "Your private little world. Just the two of you.":"Votre petit monde privé. Rien que vous deux.",
  "Mute notifications":"Couper les notifications","Silence alerts for this chat.":"Coupe les alertes de cette discussion.",
  "Shared media":"Médias partagés","Block":"Bloquer","Close":"Fermer","Cancel":"Annuler","Save to device":"Enregistrer sur l’appareil",
  "Mobile navigation":"Navigation mobile","Clear chat?":"Vider la discussion ?","Delete chat?":"Supprimer la discussion ?",
  "Chat cleared":"Discussion vidée","Chat deleted":"Discussion supprimée","Chat archived.":"Discussion archivée.","Chat unarchived.":"Discussion désarchivée.",
  "No archived chats.":"Aucune discussion archivée.","No matches.":"Aucun résultat.","No chats yet — start a new one.":"Aucune discussion — commence-en une.",
  "Start a conversation":"Commencer une conversation","You: ":"Toi : ","You":"Toi","Username":"Nom d’utilisateur","Offline":"Hors ligne",
  "online":"en ligne","last seen ":"vu(e) ","today at ":"aujourd’hui à ","yesterday at ":"hier à ","Today":"Aujourd’hui","Yesterday":"Hier",
  "typing…":"écrit…","(edited)":"(modifié)","Edit message":"Modifier le message","Delete message":"Supprimer le message",
  "This message was deleted":"Ce message a été supprimé","Disappearing message":"Message éphémère","Photo":"Photo","Video":"Vidéo","Voice message":"Message vocal",
  "24 hours":"24 heures","7 days":"7 jours","90 days":"90 jours",
  "Play voice note":"Lire le message vocal","Voice note progress":"Progression du message vocal","Playback speed":"Vitesse de lecture","Save voice note":"Enregistrer le message vocal",
  "This voice note could not be played.":"Impossible de lire ce message vocal.","Image sent in chat":"Image envoyée dans la discussion","Image unavailable":"Image indisponible","Shared photo":"Photo partagée","Profile photo":"Photo de profil",
  "Could not update this chat.":"Impossible de modifier cette discussion.","Could not update mute setting.":"Impossible de modifier la sourdine.",
  "Could not block this user.":"Impossible de bloquer cet utilisateur.","Message could not be sent.":"Le message n’a pas pu être envoyé.",
  "Choose an image, video, or audio file smaller than 12 MB.":"Choisis une image, une vidéo ou un fichier audio de moins de 12 Mo.","That file could not be read.":"Ce fichier n’a pas pu être lu.",
  "Voice recording is not supported in this browser.":"L’enregistrement vocal n’est pas pris en charge par ce navigateur.",
  "Tap again to send voice message":"Appuie à nouveau pour envoyer le message vocal","Discard recording":"Annuler l’enregistrement",
  "Microphone access was blocked. Allow it to record voice notes.":"L’accès au micro est bloqué. Autorise-le pour enregistrer des messages vocaux.","Voice note discarded.":"Message vocal supprimé.",
  "Message could not be edited.":"Le message n’a pas pu être modifié.","Delete this message? If it has been seen, it will only disappear for you.":"Supprimer ce message ? S’il a été vu, il ne disparaîtra que pour toi.",
  "Message could not be deleted.":"Le message n’a pas pu être supprimé.",
  "Translate":"Traduire","No text is available for this voice note.":"Aucun texte n’est disponible pour ce message vocal.","Transcribe voice notes":"Transcrire les messages vocaux","Lets your voice notes be translated. Uses your browser's speech recognition while you record.":"Permet de traduire tes messages vocaux. Utilise la reconnaissance vocale de ton navigateur pendant l’enregistrement.","Translating…":"Traduction…","Transcribe":"Transcrire","Falling hearts & photos":"Pluie de cœurs et de photos","Every minute, hearts and your photos drift down the chat screen. They never block taps.":"Chaque minute, des cœurs et vos photos tombent doucement sur l’écran du chat. Ils ne bloquent jamais les clics.","On iPhone: tap Share, then \"Add to Home Screen\" to install the app.":"Sur iPhone : touche Partager, puis « Sur l’écran d’accueil » pour installer l’application.","Transcribing…":"Transcription…","Hide transcript":"Masquer la transcription","Could not transcribe this voice note.":"Impossible de transcrire ce message vocal.","Listening… keep the volume up":"J’écoute… garde le volume monté","Hide translation":"Masquer la traduction","Could not translate this message.":"Impossible de traduire ce message.","translation is unavailable right now":"la traduction est indisponible pour le moment",
  "Turn on notifications":"Activer les notifications","Get alerted about new messages, even when the app is closed.":"Sois alerté(e) des nouveaux messages, même quand l’application est fermée.","Not now":"Plus tard","Enable":"Activer",
  /* new message page */
  "Write something for your favourite person. It goes straight into your chat.":"Écris quelque chose pour ta personne préférée. Ça arrive directement dans votre discussion.",
  "Loading…":"Chargement…","Send ♥":"Envoyer ♥","Open chat":"Ouvrir la discussion","No one here yet":"Personne ici pour l’instant","online now":"en ligne",
  "Write a message first.":"Écris d’abord un message.",
  "Good morning ☀️":"Bonjour ☀️","Thinking of you 💭":"Je pense à toi 💭","I love you 💕":"Je t’aime 💕","I miss you 🥺":"Tu me manques 🥺","Goodnight 🌙":"Bonne nuit 🌙",
  "Good morning my love ☀️❤️":"Bonjour mon amour ☀️❤️","Goodnight, sweet dreams 🌙":"Bonne nuit, fais de beaux rêves 🌙",
  /* settings */
  "Make this space feel like yours. You can change your privacy choices whenever you want.":"Fais de cet espace le tien. Tu peux modifier tes choix de confidentialité quand tu veux.",
  "Account":"Compte","Change your username or log out.":"Modifie ton nom d’utilisateur ou déconnecte-toi.",
  "Privacy":"Confidentialité","Choose who can see your online status and last seen.":"Choisis qui peut voir ta présence et ta dernière connexion.",
  "Blocked users":"Utilisateurs bloqués","Manage the people you've blocked.":"Gère les personnes que tu as bloquées.",
  "Appearance":"Apparence","Theme and interface preferences.":"Thème et préférences d’interface.",
  "Notifications":"Notifications","Message alerts on this browser.":"Alertes de messages sur ce navigateur.",
  "Language":"Langue","Choose the interface language.":"Choisis la langue de l’interface.",
  "Back to chats":"Retour aux discussions","Change photo":"Changer la photo","New username":"Nouveau nom d’utilisateur","Save":"Enregistrer",
  "Change password":"Changer le mot de passe","Current password":"Mot de passe actuel","New password (min 6 characters)":"Nouveau mot de passe (6 caractères minimum)","Update":"Mettre à jour",
  "Show online and last-seen status":"Afficher la présence et la dernière connexion","People will only see this while you allow it.":"Les autres ne le verront que si tu l’autorises.",
  "Show last seen":"Afficher la dernière connexion","Turning this off also hides everyone else's last seen from you.":"En le désactivant, tu ne verras plus non plus la dernière connexion des autres.",
  "Dark theme":"Thème sombre","Stored on this device.":"Enregistré sur cet appareil.","Welcome motion":"Animation d’accueil","The animation on the sign-in screen.":"L’animation de l’écran de connexion.",
  "Push notifications":"Notifications push","Get alerts on this device even when the app is closed.":"Reçois des alertes sur cet appareil même quand l’application est fermée.",
  "Messages":"Messages","New chat messages.":"Nouveaux messages de la discussion.","Voice notes":"Messages vocaux","When someone sends you a voice message.":"Quand on t’envoie un message vocal.",
  "Notification sound":"Son de notification","Play a Samsung-style notification tone for new messages.":"Joue une sonnerie de notification pour les nouveaux messages.",
  "Unblock":"Débloquer","You haven't blocked anyone.":"Tu n’as bloqué personne.","Could not load your blocked list.":"Impossible de charger ta liste de blocage.",
  "Could not unblock this user.":"Impossible de débloquer cet utilisateur.","Could not save privacy setting.":"Impossible d’enregistrer ce réglage.",
  "Username updated.":"Nom d’utilisateur mis à jour.","Could not update username.":"Impossible de mettre à jour le nom d’utilisateur.",
  "Choose an image smaller than 2 MB.":"Choisis une image de moins de 2 Mo.","Profile photo updated.":"Photo de profil mise à jour.","Could not update photo.":"Impossible de mettre à jour la photo.",
  "New password needs at least 6 characters.":"Le nouveau mot de passe doit contenir au moins 6 caractères.","Password updated.":"Mot de passe mis à jour.","Could not update password.":"Impossible de mettre à jour le mot de passe.",
  "Notifications are not supported in this browser.":"Les notifications ne sont pas prises en charge par ce navigateur.","Notifications are blocked in browser settings.":"Les notifications sont bloquées dans les réglages du navigateur.",
  "Push isn’t set up on the server yet — you’ll still get alerts while the app is open.":"Les notifications push ne sont pas encore configurées sur le serveur — tu recevras quand même des alertes tant que l’application est ouverte.",
  "Could not save language.":"Impossible d’enregistrer la langue.","Language saved.":"Langue enregistrée.",
  /* install */
  "The app is already installed on this device":"L’application est déjà installée sur cet appareil","Install the app to your device":"Installe l’application sur ton appareil",
  "The app is already installed on this device.":"L’application est déjà installée sur cet appareil.",
  "App installed — you can now open it from your home screen.":"Application installée — tu peux maintenant l’ouvrir depuis ton écran d’accueil.",
  "Open your browser menu and choose \"Add to Home screen\" to install the app.":"Ouvre le menu de ton navigateur et choisis « Ajouter à l’écran d’accueil » pour installer l’application.",
  "Installing…":"Installation…","Installation cancelled.":"Installation annulée.","Could not start installation.":"Impossible de lancer l’installation.",
  /* lock screen + generic */
  "Enter your password to open the chat.":"Entre ton mot de passe pour ouvrir le chat.","Unlock":"Déverrouiller","Incorrect password.":"Mot de passe incorrect.","Something went wrong":"Une erreur s’est produite",
  /* messages from the server (app.py) */
  "a privacy setting is required":"un réglage de confidentialité est requis","a valid push token is required":"un jeton de notification valide est requis",
  "content is required":"le contenu est requis","current password is incorrect":"le mot de passe actuel est incorrect","enter your password to open the chat":"entre ton mot de passe pour ouvrir le chat",
  "incorrect password":"mot de passe incorrect","invalid username or password":"nom d’utilisateur ou mot de passe invalide","language must be 'en' or 'fr'":"la langue doit être « en » ou « fr »",
  "media must be smaller than 12 MB":"le média doit faire moins de 12 Mo","message must contain 1-4000 characters":"le message doit contenir de 1 à 4000 caractères",
  "new password must be at least 6 characters":"le nouveau mot de passe doit contenir au moins 6 caractères","no such chat":"discussion introuvable","no such user":"utilisateur introuvable","not found":"introuvable",
  "only active text messages can be edited":"seuls les messages texte actifs peuvent être modifiés","only your own messages can be changed":"tu ne peux modifier que tes propres messages",
  "please log in again to continue":"reconnecte-toi pour continuer","please log in to continue":"connecte-toi pour continuer",
  "profile photo must be an image smaller than 2 MB":"la photo de profil doit être une image de moins de 2 Mo","recipient and valid type are required":"un destinataire et un type valide sont requis",
  "that user is not in your contacts":"cet utilisateur n’est pas dans tes contacts","this app is only for Prosper and Charlène":"cette application est réservée à Prosper et Charlène",
  "this conversation is blocked":"cette conversation est bloquée","this is a private chat for Prosper and Charlène":"ceci est une discussion privée pour Prosper et Charlène",
  "this space is only for Prosper and Charlène":"cet espace est réservé à Prosper et Charlène","unsupported timer":"minuteur non pris en charge","username already taken":"nom d’utilisateur déjà pris",
  "username must be 2-24 characters":"le nom d’utilisateur doit contenir de 2 à 24 caractères","username required, password min 6 chars":"nom d’utilisateur requis, mot de passe de 6 caractères minimum",
  "you cannot block yourself":"tu ne peux pas te bloquer toi-même","you cannot message yourself":"tu ne peux pas t’écrire à toi-même"
}};
const AP="(?:’|')";
const I18N_PATTERNS=[
  [/^Welcome back, (.+)$/,n=>`Bon retour, ${n}`],
  [/^All messages with (.+) will be removed from your phone\. (.+) keeps their own copy\.$/,(a,b)=>`Tous les messages avec ${a} seront supprimés de ton téléphone. ${b} garde sa propre copie.`],
  [/^The chat with (.+) and all its messages will be removed from your side\. It comes back, empty, when either of you sends a new message\.$/,n=>`La discussion avec ${n} et tous ses messages seront supprimés de ton côté. Elle revient, vide, dès que l’un de vous envoie un nouveau message.`],
  [/^Block (.+)\? They will not be able to message you\.$/,n=>`Bloquer ${n} ? Cette personne ne pourra plus t’écrire.`],
  [/^(.+) is blocked\.$/,n=>`${n} est bloqué(e).`],[/^(.+) is unblocked\.$/,n=>`${n} est débloqué(e).`],
  [/^(.+) unmuted\.$/,n=>`Sourdine désactivée pour ${n}.`],[/^(.+) muted\.$/,n=>`${n} est en sourdine.`],
  [new RegExp("^You blocked (.+)\\. Unblock in Settings › Blocked users to write again\\.$"),n=>`Tu as bloqué ${n}. Débloque-le dans Paramètres › Utilisateurs bloqués pour pouvoir écrire à nouveau.`],
  [new RegExp("^(.+) isn"+AP+"t receiving messages right now\\.$"),n=>`${n} ne reçoit pas de messages pour le moment.`],
  [/^too many wrong attempts, try again in (\d+)s$/,s=>`trop de tentatives, réessaie dans ${s} s`],
  [new RegExp("^(.+) hasn"+AP+"t joined yet$"),n=>`${n} n’a pas encore rejoint l’application`],
  [/^(.+) content must be a data URL$/,k=>`le contenu « ${k} » doit être une URL de données`],
  [/^Could not reach the server: (.*)\. Check your connection and try again\.$/,e=>`Impossible de joindre le serveur : ${e}. Vérifie ta connexion et réessaie.`],
  [/^Server error (\d+)(.*)$/s,(c,r)=>`Erreur du serveur ${c}${r}`]
];
let currentLanguage=localStorage.getItem('hwfar_language')==='fr'?'fr':'en', translationObserver=null;
const LOCALE=()=>currentLanguage==='fr'?'fr-FR':undefined;
function trText(value){
  if(currentLanguage!=='fr'||typeof value!=='string'||!value)return value;
  if(Object.prototype.hasOwnProperty.call(I18N.fr,value))return I18N.fr[value];
  for(const [re,fn] of I18N_PATTERNS){const m=value.match(re);if(m)return fn(...m.slice(1));}
  return value;
}
const tr=trText;
// Text the person typed (messages, names, the composer) must never be translated.
const NO_TRANSLATE='.bubble-text,.preview,.contact-name,textarea,input,[data-notr]';
function translateTextNode(textNode){
  if(!textNode||textNode.nodeType!==3)return;
  const parent=textNode.parentElement; if(!parent||parent.closest(NO_TRANSLATE)||/^(SCRIPT|STYLE)$/.test(parent.tagName))return;
  const original=textNode.nodeValue, trimmed=original.trim(); if(!trimmed)return;
  const out=trText(trimmed); if(out!==trimmed)textNode.nodeValue=original.replace(trimmed,()=>out);
}
const TR_ATTRS=['placeholder','title','aria-label','alt','data-t'];
function translateAttrs(el){
  if(!el||el.nodeType!==1||el.closest?.('[data-notr]'))return;
  TR_ATTRS.forEach(a=>{if(el.hasAttribute(a)){const v=el.getAttribute(a),out=trText(v);if(out!==v)el.setAttribute(a,out);}});
}
function applyTranslations(root=document){
  document.documentElement.lang=currentLanguage;
  if(currentLanguage!=='fr')return;
  document.title=trText(document.title);
  const scope=root.nodeType===1?root:document.body, walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT), nodes=[]; let node;
  while(node=walker.nextNode())nodes.push(node);
  nodes.forEach(translateTextNode);
  translateAttrs(scope); scope.querySelectorAll?.(TR_ATTRS.map(a=>`[${a}]`).join(',')).forEach(translateAttrs);
}
function watchTranslations(){
  if(translationObserver||currentLanguage!=='fr')return;
  translationObserver=new MutationObserver(records=>{
    records.forEach(r=>{
      if(r.type==='attributes')translateAttrs(r.target);
      else if(r.type==='characterData')translateTextNode(r.target);
      else r.addedNodes.forEach(n=>{if(n.nodeType===1)applyTranslations(n);else translateTextNode(n);});
    });
  });
  translationObserver.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:TR_ATTRS});
}
async function syncLanguageToServer(){
  if(token()&&localStorage.getItem('lang_chosen')==='1')await api('/account/language',{method:'POST',body:JSON.stringify({language:currentLanguage})});
}
async function initPageLanguage(){
  if(token()){
    const result=await api('/account/me');
    if(result.ok&&['en','fr'].includes(result.body?.language)){
      if(localStorage.getItem('lang_chosen')==='1'){ if(result.body.language!==currentLanguage)syncLanguageToServer(); }
      else{currentLanguage=result.body.language;localStorage.setItem('hwfar_language',currentLanguage);}
    }
  }
  applyTranslations();watchTranslations();
}
// First launch: ask which language to use. The choice is remembered, saved on the
// account when signed in, and the page reloads so EVERYTHING appears in that language.
function chooseLanguage(language){
  localStorage.setItem('hwfar_language',language);localStorage.setItem('lang_chosen','1');
  currentLanguage=language;
  Promise.resolve(syncLanguageToServer()).finally(()=>location.reload());
}
function showLanguagePopup(){
  if(localStorage.getItem('lang_chosen')==='1'||document.getElementById('lang-popup'))return;
  const el=document.createElement('div');
  el.id='lang-popup';el.setAttribute('data-notr','');el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
  el.innerHTML='<div class="lang-card"><div class="lang-heart">♥</div><h1>Choose your language</h1><h2>Choisis ta langue</h2>'
    +'<p>Everything in the app will switch to your language.<br>Toute l’application s’affichera dans ta langue.</p>'
    +'<button type="button" class="lang-btn" data-lang="en"><span>🇬🇧</span>English</button>'
    +'<button type="button" class="lang-btn" data-lang="fr"><span>🇫🇷</span>Français</button></div>';
  el.querySelectorAll('.lang-btn').forEach(b=>b.onclick=()=>chooseLanguage(b.dataset.lang));
  document.body.appendChild(el);
}
const sqlDate = (value) => value ? new Date(value.replace(' ','T') + 'Z') : null;
const isSameDay = (a,b) => a && b && a.toDateString() === b.toDateString();
const timeLabel = (value) => {
  const d = sqlDate(value); if (!d) return '';
  const now = new Date(), yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  if (isSameDay(d, now)) return d.toLocaleTimeString(LOCALE(), {hour:'numeric', minute:'2-digit'});
  if (isSameDay(d, yesterday)) return tr('Yesterday');
  return d.toLocaleDateString(LOCALE(), {month:'short', day:'numeric'});
};
const messageTime = (value) => {
  const d = sqlDate(value); return d ? d.toLocaleTimeString(LOCALE(), {hour:'numeric', minute:'2-digit'}) : '';
};
const dayLabel = (value) => {
  const d = sqlDate(value), now = new Date(), yesterday = new Date(now);
  if (!d) return ''; yesterday.setDate(now.getDate()-1);
  if (isSameDay(d, now)) return tr('Today');
  if (isSameDay(d, yesterday)) return tr('Yesterday');
  return d.toLocaleDateString(LOCALE(), {month:'short',day:'numeric',year:'numeric'});
};
const formatLastSeen = (value) => {
  const d = sqlDate(value); if (!d) return '';
  const now = new Date(), yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  const when = isSameDay(d,now) ? tr('today at ') : isSameDay(d,yesterday) ? tr('yesterday at ') : '';
  return tr('last seen ') + when + d.toLocaleString(LOCALE(), {dateStyle: when ? undefined : 'medium', timeStyle:'short'});
};
const tick = (message) => {
  if (message.from !== 'me') return '';
  const color = message.read ? 'read' : '';
  const double = message.delivered || message.read;
  return `<svg class="tick ${color}" viewBox="0 0 16 11"><path d="${double?'M1 6l4 4L11 1M5.5 6l4 4L15.5 1':'M1 6l4 4L11 1'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};
function toggleTheme(){
  const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = next; localStorage.setItem('chatly_theme', next);
  const sw = $('#theme-switch'); if (sw) sw.classList.toggle('on', next === 'dark');
}
function toggleLocalPreference(key,id){
  const next=localStorage.getItem(key)==='off'?'on':'off';
  localStorage.setItem(key,next);
  const switchEl=id&&$('#'+id); if(switchEl)switchEl.classList.toggle('on',next!=='off');
  if(key==='hwfar_welcome_animation'){
    const welcome=$('#auth-welcome');
    if(welcome)welcome.classList.toggle('is-off',next==='off');
  }
  if(key==='hwfar_love_rain')applyLoveRainPreference();
}
function toggleWelcomeAnimation(){toggleLocalPreference('hwfar_welcome_animation','welcome-animation-switch');}
function applyWelcomeAnimationPreference(){
  const enabled=localStorage.getItem('hwfar_welcome_animation')!=='off';
  $('#auth-welcome')?.classList.toggle('is-off',!enabled);
  $('#welcome-animation-switch')?.classList.toggle('on',enabled);
}
document.body.dataset.theme = localStorage.getItem('chatly_theme') || 'dark';
async function loveUnlockWith(password){
  const r=await api('/account/unlock',{method:'POST',body:JSON.stringify({password})});
  if(r.ok&&r.body?.unlock_token)sessionStorage.setItem('love_unlock',r.body.unlock_token);
  return r.ok;
}
function logout(){
  sessionStorage.removeItem('love_unlock');
  localStorage.removeItem('chatly_token'); localStorage.removeItem('chatly_username'); localStorage.removeItem('chatly_user_id'); location.href='/';
}

function initAuthPage(){
  currentLanguage=localStorage.getItem('hwfar_language')==='fr'?'fr':'en';
  applyTranslations();watchTranslations();
  applyWelcomeAnimationPreference();
  if (token()) { location.href='/chat'; return; }
  let register = false;
  const form = $('#auth-form'), toggle = $('#auth-toggle');
  const saveSession = async (body) => {
    localStorage.setItem('chatly_token',body.access_token);
    localStorage.setItem('chatly_username',body.username);
    localStorage.setItem('chatly_user_id',body.user_id);
    if(localStorage.getItem('lang_chosen')!=='1')localStorage.setItem('hwfar_language',body.language||'en');
    await syncLanguageToServer();
  };
  toggle.onclick = () => {
    register = !register;
    $('#auth-title').textContent = register ? 'Create your account' : 'Welcome back, love';
    $('#auth-sub').textContent = register ? 'Just a name and a password.' : 'Sign in to get back to your person.';
    $('#login-fields').hidden = register; $('#signup-fields').hidden = !register;
    $('#auth-toggle-copy').textContent = register ? 'Already have an account?' : 'First time here?';
    toggle.textContent = register ? 'Log in' : 'Set up my account';
    $('#auth-error').textContent = ''; $('#auth-error-signup').textContent = '';
  };
  if(new URLSearchParams(location.search).get('signup')==='1')toggle.click();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (register) {
      const err = $('#auth-error-signup'); err.textContent = '';
      const username = $('#signup-username').value.trim(), password = $('#signup-password').value;
      if (!username) { err.textContent = 'Enter your name.'; return; }
      if (password.length < 6) { err.textContent = 'Your password needs at least 6 characters.'; return; }
      const result = await api('/register',{method:'POST',body:JSON.stringify({username,password})});
      if (!result.ok){ err.textContent = result.body?.error || 'Could not create account.'; return; }
      const login = await api('/login',{method:'POST',body:JSON.stringify({username,password})});
      if (!login.ok){ err.textContent = 'Account created. Please log in.'; return; }
      await saveSession(login.body);
      await loveUnlockWith(password);
      location.href='/chat'; return;
    }
    const username=$('#username').value.trim(), password=$('#password').value;
    $('#auth-error').textContent='';
    const login = await api('/login',{method:'POST',body:JSON.stringify({username,password})});
    if (!login.ok){ $('#auth-error').textContent=login.body?.error || 'Invalid username or password.'; return; }
    await saveSession(login.body);
    await loveUnlockWith(password);
    location.href='/chat';
  };
}

let contacts = [], active = null, socket = null, typingTimer = null, remoteTyping = false;
let mediaRecorder = null, recordingChunks = [], recordingStartedAt = 0, recordingTimer = null, recordingCancelled = false;
let voiceRecognition = null, voiceTranscript = '', voiceFinal = '', recordingPausedMs = 0, recordingPauseAt = 0;
const icon = (name) => name === 'edit'
  ? '<svg viewBox="0 0 24 24"><path d="m4 16-.7 4.7L8 20l11.5-11.5a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.8 6.2 4 4"/></svg>'
  : name === 'timer'
  ? '<svg class="disappear-badge" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M10 2h4"/></svg>'
  : '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>';
// Disappearing-messages system notes are stored server-side as a compact
// "disappearing:<seconds>:<actor>" code (not free text) so each viewer's
// client can localize it and phrase it as "You" vs the other person's name.
const DISAPPEARING_LABELS = {0:'Off',86400:'24 hours',604800:'7 days',7776000:'90 days'};
function systemMessageText(m){
  const parts = (m.content||'').split(':');
  if (parts[0] !== 'disappearing') return esc(m.content||'');
  const seconds = Number(parts[1]), actor = parts.slice(2).join(':');
  const me = localStorage.getItem('chatly_username'), mine = actor === me, fr = currentLanguage === 'fr';
  if (fr) {
    const who = mine ? 'Tu as' : `${esc(actor)} a`;
    if (!seconds) return `${who} désactivé les messages éphémères`;
    return `${who} réglé les messages éphémères sur ${tr(DISAPPEARING_LABELS[seconds] || `${seconds}s`)}`;
  }
  const who = mine ? 'You' : esc(actor);
  if (!seconds) return `${who} turned off disappearing messages`;
  return `${who} set disappearing messages to ${DISAPPEARING_LABELS[seconds] || `${seconds}s`}`;
}
function toast(message){
  let el=$('#chat-toast'); if(!el){el=document.createElement('div');el.id='chat-toast';el.className='toast';document.body.appendChild(el);}
  el.textContent=message; clearTimeout(el._timer); el._timer=setTimeout(()=>el.remove(),3200);
}
let hwfarAudioContext=null;
function soundOn(key){return localStorage.getItem(key)!=='off';}
function unlockHwFarAudio(){
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)return null;
  try{
    if(!hwfarAudioContext)hwfarAudioContext=new AudioContext();
    if(hwfarAudioContext.state==='suspended')hwfarAudioContext.resume().catch(()=>{});
    return hwfarAudioContext;
  }catch(_){return null;}
}
function playHwFarMelody(notes,volume=.045){
  const context=unlockHwFarAudio(); if(!context)return;
  let offset=0;
  notes.forEach(note=>{
    const start=context.currentTime+offset, end=start+note.duration;
    const oscillator=context.createOscillator(), gain=context.createGain();
    oscillator.type=note.type||'sine'; oscillator.frequency.setValueAtTime(note.frequency,start);
    gain.gain.setValueAtTime(0.0001,start);
    gain.gain.exponentialRampToValueAtTime(volume,start+0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001,Math.max(start+0.04,end-0.03));
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start); oscillator.stop(end);
    offset+=note.duration+(note.pause||0);
  });
}
function playNotificationSound(){
  if(!soundOn('hwfar_notification_sound'))return;
  playHwFarMelody([
    {frequency:784,duration:.14},{frequency:988,duration:.18,pause:.04},
    {frequency:1175,duration:.3,type:'triangle'}
  ],.035);
}
function playTypingSound(){
  // A single soft, short blip — deliberately quieter and shorter than the
  // message-received tone so it reads as ambient ("they're typing") rather
  // than as an alert. Fired once per typing session (see the false→true
  // edge check at the 'typing' socket handler), not on every keystroke.
  if(!soundOn('hwfar_typing_sound'))return;
  playHwFarMelody([{frequency:520,duration:.09,type:'sine'}],.02);
}
document.addEventListener('pointerdown',unlockHwFarAudio,{passive:true});
let showArchivedView=false;
async function loadContacts(){
  const result=await api('/contacts'); contacts=result.ok ? result.body : [];
  const query=($('#search')?.value || '').toLowerCase();
  const archivedCount=contacts.filter(c=>c.archived).length;
  const toggle=$('#archived-toggle-btn');
  if(toggle){toggle.hidden=!archivedCount && !showArchivedView; toggle.querySelector('span').textContent=archivedCount;}
  const scoped=contacts.filter(c=>!!c.archived===showArchivedView);
  const visible=scoped.filter(c=>c.username.toLowerCase().includes(query));
  $('#contacts').innerHTML=visible.length ? visible.map(c=>`
    <a class="contact ${active===c.username?'active':''}" href="/chat/${encodeURIComponent(c.username)}">
      ${avatar(c.username,c.avatar,44,!!c.online)}<div class="contact-main"><div class="contact-top"><span class="contact-name">${esc(c.username)}</span><span class="contact-time ${c.unread_count?'unread':''}">${timeLabel(c.last_sent_at)}</span></div>
       <div class="contact-bottom"><span class="preview">${c.last_mine?tr('You: '):''}${esc(c.last_content || tr('Start a conversation'))}</span>${c.unread_count?`<span class="badge">${c.unread_count>99?'99+':c.unread_count}</span>`:''}</div></div>
       <button class="icon-btn contact-archive" type="button" title="${c.archived?tr('Unarchive chat'):tr('Archive chat')}" aria-label="${c.archived?tr('Unarchive chat'):tr('Archive chat')}" onclick="event.preventDefault();event.stopPropagation();toggleArchiveContact('${esc(c.username)}',${!!c.archived})">${c.archived?'⤴':'⤵'}</button>
      </a>`).join('') : `<div class="empty">${showArchivedView?tr('No archived chats.'):(contacts.length||archivedCount?tr('No matches.'):tr('No chats yet — start a new one.'))}</div>`;
}
function toggleArchivedView(){
  showArchivedView=!showArchivedView;
  $('#archived-toggle-btn')?.classList.toggle('active',showArchivedView);
  loadContacts();
}
async function toggleArchiveContact(username,currentlyArchived){
  const result=await api('/contacts/'+encodeURIComponent(username)+'/archive',{method:'POST',body:JSON.stringify({archived:!currentlyArchived})});
  if(!result.ok){toast(result.body?.error||'Could not update this chat.');return;}
  if(active===username && !currentlyArchived) closeThread();
  loadContacts();
}
async function toggleActiveArchive(){
  if(!active)return;
  $('#thread-menu')?.classList.remove('open');
  const contact=contacts.find(c=>c.username===active);
  const nowArchived=!(contact&&contact.archived);
  const result=await api('/contacts/'+encodeURIComponent(active)+'/archive',{method:'POST',body:JSON.stringify({archived:nowArchived})});
  if(!result.ok){toast(result.body?.error||'Could not update this chat.');return;}
  toast(nowArchived?'Chat archived.':'Chat unarchived.');
  if(nowArchived) closeThread(); else loadContacts();
}
function presenceText(p){ return p?.online ? tr('online') : (p?.last_seen ? formatLastSeen(p.last_seen) : ''); }
async function updatePresence(){
  if (!active) return; const result=await api('/presence/'+encodeURIComponent(active));
  if (!remoteTyping && $('#thread-status')) $('#thread-status').textContent=result.ok ? presenceText(result.body) : '';
}
function voiceExtension(dataUrl){
  const match=/^data:audio\/([a-z0-9.+-]+)/i.exec(dataUrl||''); if(!match)return 'webm';
  const type=match[1].split(';')[0].toLowerCase();
  if(type==='mp4')return 'm4a'; if(type==='mpeg')return 'mp3'; if(type==='ogg')return 'ogg'; if(type==='aac')return 'aac'; return 'webm';
}
function voiceClock(seconds){
  const value=Math.max(0,Math.round(Number(seconds)||0));
  return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
}
const VOICE_SPEEDS=[1,1.5,2,0.5];
function voicePlayer(src,id,duration){
  const safeId=id||Date.now();
  return `<span class="voice-player" data-voice-player="${safeId}">
    <audio src="${esc(src)}" preload="metadata"></audio>
    <button class="voice-play" type="button" aria-label="Play voice note">▶</button>
    <span class="voice-track"><input class="voice-progress" type="range" min="0" max="100" value="0" aria-label="Voice note progress"><span class="voice-time">${voiceClock(duration)}</span></span>
    <button class="voice-speed" type="button" data-rate-index="0" title="${tr('Playback speed')}" aria-label="${tr('Playback speed')}">1x</button>
    <a class="voice-download" href="${esc(src)}" download="hwfar-voice-note-${safeId}.${voiceExtension(src)}" title="${tr('Save voice note')}" aria-label="${tr('Save voice note')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v13m0 0-4.5-4.5M12 16l4.5-4.5"/><path d="M4 20h16"/></svg></a>
  </span>`;
}
function wireVoicePlayers(root=document){
  root.querySelectorAll?.('.voice-player:not([data-ready])').forEach(player=>{
    const audio=player.querySelector('audio'), play=player.querySelector('.voice-play');
    const progress=player.querySelector('.voice-progress'), time=player.querySelector('.voice-time');
    const speedBtn=player.querySelector('.voice-speed');
    if(!audio||!play||!progress)return;
    player.dataset.ready='1';
    const update=()=>{
      const total=audio.duration||0, current=audio.currentTime||0;
      progress.value=total?String((current/total)*100):'0';
      if(time)time.textContent=voiceClock(current);
    };
    play.onclick=()=>{
      if(audio.paused){
        document.querySelectorAll('.voice-player audio').forEach(other=>{if(other!==audio){other.pause();other.closest('.voice-player')?.querySelector('.voice-play')?.replaceChildren(document.createTextNode('▶'));}});
        audio.play().catch(()=>toast('This voice note could not be played.'));
      }else audio.pause();
    };
    if(speedBtn){
      speedBtn.onclick=()=>{
        const nextIndex=(Number(speedBtn.dataset.rateIndex||'0')+1)%VOICE_SPEEDS.length;
        const rate=VOICE_SPEEDS[nextIndex];
        audio.playbackRate=rate;
        speedBtn.dataset.rateIndex=String(nextIndex);
        speedBtn.textContent=(rate===1?'1':String(rate))+'x';
      };
    }
    audio.addEventListener('play',()=>{play.textContent='❚❚';});
    audio.addEventListener('pause',()=>{play.textContent='▶';});
    audio.addEventListener('ended',()=>{play.textContent='▶';progress.value='0';if(time)time.textContent=voiceClock(audio.duration);});
    audio.addEventListener('loadedmetadata',update);audio.addEventListener('timeupdate',update);
    progress.oninput=()=>{if(audio.duration)audio.currentTime=(Number(progress.value)/100)*audio.duration;};
  });
}
function renderMessage(m){
  if((m.type||'text')==='system') return `<div class="day system-note" data-id="${m.id||''}">${systemMessageText(m)}</div>`;
  const mine=m.from==='me', deleted=!!m.deleted, type=m.type||'text';
  let body='';
  if(deleted) body=`<span class="bubble-text">${tr('This message was deleted')}</span>`;
  else if(type==='image') body=`<img class="message-media" src="${esc(m.content)}" alt="Image sent in chat" loading="lazy" onerror="mediaLoadError(this)">`;
  else if(type==='video') body=`<video class="message-media message-video" src="${esc(m.content)}" controls playsinline></video>`;
   else if(type==='voice') body=`<span class="voice-message"><span aria-hidden="true">🎙</span>${voicePlayer(m.content,m.id,m.duration)}</span><span class="voice-transcript" data-notr hidden>${esc(m.transcript||'')}</span>`;
  else body=`<span class="bubble-text">${esc(m.content)}</span>`;
  const trBtnHtml=(act,fn,label)=>`<button class="tr-btn" type="button" data-act="${act}" onclick="${fn}(${Number(m.id)})">${label}</button>`;
  const translateBtn=deleted?'' : type==='voice' ? `<span class="tr-row">${trBtnHtml('transcribe','transcribeVoice','📝 '+tr('Transcribe'))}${trBtnHtml('translate','translateMessage','🌐 '+tr('Translate'))}</span>` : (type==='text'&&(m.content||'').trim()) ? trBtnHtml('translate','translateMessage','🌐 '+tr('Translate')) : '';
  const edited=!deleted&&m.edited ? `<span class="edited-label">${tr('(edited)')}</span>` : '';
  const actions=mine&&!deleted&&type==='text' ? `<div class="message-actions"><button class="message-action" type="button" title="${tr('Edit message')}" aria-label="${tr('Edit message')}" onclick="editMessage(${Number(m.id)})">${icon('edit')}</button><button class="message-action" type="button" title="${tr('Delete message')}" aria-label="${tr('Delete message')}" onclick="deleteMessage(${Number(m.id)})">${icon('delete')}</button></div>` : '';
  const expiring=m.expires_at ? `<span class="meta-icon" title="${tr('Disappearing message')}">${icon('timer')}</span>` : '';
  return `<div class="row ${mine?'mine':'theirs'}" data-id="${m.id||''}"><div><div class="bubble ${deleted?'deleted':''} ${m.edited?'edited':''}">${body}${translateBtn}${edited}<span class="meta">${expiring}${messageTime(m.sent_at)}${tick(m)}</span></div>${actions}</div></div>`;
}
// Tap "Translate" under a message to see it in the chosen language; tap again to hide it.
// Voice note -> text. 1) the transcript saved by the sender, 2) the server's Whisper
// (GROQ_API_KEY / OPENAI_API_KEY), 3) last resort: play the note aloud while the
// browser's speech recognition listens through the microphone.
function listenToVoiceNote(bubble){
  return new Promise(resolve=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition, audio=bubble.querySelector('.voice-player audio');
    if(!SR||!audio){resolve('');return;}
    document.querySelectorAll('.voice-player audio').forEach(a=>{if(a!==audio)a.pause();});
    let finalText='', interim='', finished=false, settled=false, rec;
    const settle=()=>{if(settled)return;settled=true;resolve((finalText+interim).trim());};
    const finish=()=>{
      if(finished)return; finished=true; try{audio.pause();}catch(_){}
      if(!rec){settle();return;} rec.onend=settle; try{rec.stop();}catch(_){settle();} setTimeout(settle,900);
    };
    try{
      rec=new SR(); rec.continuous=true; rec.interimResults=true; rec.lang=currentLanguage==='fr'?'en-US':'fr-FR';
      rec.onresult=e=>{interim='';for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];if(r.isFinal)finalText+=r[0].transcript+' ';else interim+=r[0].transcript;}};
      rec.onerror=()=>{};
      rec.onend=()=>{if(!finished&&!audio.ended){try{rec.start();}catch(_){}}};
      rec.start();
    }catch(_){resolve('');return;}
    toast(tr('Listening… keep the volume up'));
    try{audio.currentTime=0;audio.volume=1;audio.muted=false;}catch(_){}
    audio.onended=()=>setTimeout(finish,1200);
    audio.play().catch(finish);
    setTimeout(finish,((audio.duration||60)+6)*1000);
  });
}
async function getVoiceText(id,bubble){
  const holder=bubble.querySelector('.voice-transcript');
  let text=(holder?.textContent||'').trim(); if(text)return text;
  const r=await api('/transcribe/'+Number(id),{method:'POST',body:'{}'});
  if(r.ok&&r.body?.transcript)text=String(r.body.transcript).trim();
  if(!text)text=await listenToVoiceNote(bubble);
  if(text&&holder)holder.textContent=text;
  return text;
}
async function transcribeVoice(id){
  const bubble=document.querySelector(`[data-id="${id}"]`)?.querySelector('.bubble'); if(!bubble)return;
  const btn=bubble.querySelector('.tr-btn[data-act="transcribe"]'), shown=bubble.querySelector('.vt-out');
  if(shown){shown.remove();if(btn)btn.textContent='📝 '+tr('Transcribe');return;}
  if(btn){btn.disabled=true;btn.textContent='📝 '+tr('Transcribing…');}
  const text=await getVoiceText(id,bubble);
  if(btn)btn.disabled=false;
  if(!text){if(btn)btn.textContent='📝 '+tr('Transcribe');toast(tr('Could not transcribe this voice note.'));return;}
  const out=document.createElement('div');out.className='vt-out';out.setAttribute('data-notr','');out.textContent=text;
  bubble.querySelector('.voice-message')?.after(out);
  if(btn)btn.textContent='📝 '+tr('Hide transcript');
}
async function translateMessage(id){
  const row=document.querySelector(`[data-id="${id}"]`), bubble=row?.querySelector('.bubble'); if(!bubble)return;
  const btn=bubble.querySelector('.tr-btn[data-act="translate"]'), shown=bubble.querySelector('.tr-out');
  if(shown){shown.remove();if(btn)btn.textContent='🌐 '+tr('Translate');return;}
  const isVoice=!bubble.querySelector('.bubble-text');
  if(btn){btn.disabled=true;btn.textContent='🌐 '+tr(isVoice?'Transcribing…':'Translating…');}
  const text=isVoice?await getVoiceText(id,bubble):(bubble.querySelector('.bubble-text')?.textContent||'');
  if(!text.trim()){if(btn){btn.disabled=false;btn.textContent='🌐 '+tr('Translate');}toast(tr(isVoice?'Could not transcribe this voice note.':'Could not translate this message.'));return;}
  if(btn)btn.textContent='🌐 '+tr('Translating…');
  const result=await api('/translate',{method:'POST',body:JSON.stringify({text,target:currentLanguage})});
  if(btn)btn.disabled=false;
  if(!result.ok){toast(result.body?.error||tr('Could not translate this message.'));if(btn)btn.textContent='🌐 '+tr('Translate');return;}
  const out=document.createElement('div');out.className='tr-out';out.setAttribute('data-notr','');
  if(isVoice){const orig=document.createElement('div');orig.className='vt-text';orig.textContent=text;out.append(orig);}
  const line=document.createElement('div');line.textContent=result.body.translation;out.append(line);
  (bubble.querySelector('.bubble-text')||bubble.querySelector('.voice-message')).after(out);
  if(btn)btn.textContent='🌐 '+tr('Hide translation');
}
function mediaLoadError(img){
  img.onerror=null;
  const placeholder=document.createElement('div');
  placeholder.className='message-media media-broken';
  placeholder.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 15 4-4 3 3 5-5 4 4M9 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg><span>Image unavailable</span>';
  img.replaceWith(placeholder);
}
function openMediaViewer(url){
  const viewer=$('#media-viewer'); if(!viewer||!url)return;
  $('#media-viewer-img').src=url;
  const dl=$('#media-viewer-download');
  if(dl){const ext=/^data:image\/(\w+)/.exec(url); dl.href=url; dl.setAttribute('download','hwfar-image-'+Date.now()+'.'+(ext?ext[1].replace('jpeg','jpg'):'jpg'));}
  viewer.classList.add('open'); viewer.hidden=false; viewer.setAttribute('aria-hidden','false');
}
function closeMediaViewer(){
  const viewer=$('#media-viewer'); if(!viewer)return;
  viewer.classList.remove('open'); viewer.hidden=true; viewer.setAttribute('aria-hidden','true'); $('#media-viewer-img').src='';
}
// Disappearing messages are purged server-side lazily (on the next send/fetch/
// read), so a chat left open across the expiry moment wouldn't otherwise drop
// the bubble until you left and came back. These timers mirror that expiry
// live, purely client-side — the server remains the source of truth and will
// already have deleted the row by the time this fires.
const expiryTimers = new Map(); // message id -> array of timeout handles
const MAX_TIMEOUT = 2147483000; // just under the 32-bit setTimeout ceiling (~24.8 days)

function clearMessageExpiry(id){
  const handles=expiryTimers.get(id);
  if(handles) handles.forEach(clearTimeout);
  expiryTimers.delete(id);
}
function clearAllMessageExpiries(){
  expiryTimers.forEach(handles=>handles.forEach(clearTimeout));
  expiryTimers.clear();
}
function pruneEmptyDayLabels(){
  const box=$('#messages'); if(!box) return;
  Array.from(box.querySelectorAll('.day:not(.system-note)')).forEach(day=>{
    let sib=day.nextElementSibling, hasRow=false;
    while(sib && !sib.classList.contains('day')){ if(sib.classList.contains('row')){hasRow=true;break;} sib=sib.nextElementSibling; }
    if(!hasRow) day.remove();
  });
}
function removeExpiredMessage(id){
  expiryTimers.delete(id);
  const row=document.querySelector(`[data-id="${id}"]`); if(!row) return;
  row.classList.add('expiring');
  setTimeout(()=>{ row.remove(); pruneEmptyDayLabels(); }, 220);
  loadContacts();
}
function scheduleMessageExpiry(m){
  if(!m || !m.expires_at || !m.id) return;
  clearMessageExpiry(m.id);
  const end=sqlDate(m.expires_at); if(!end) return;
  const remaining=end.getTime()-Date.now();
  if(remaining<=0){ removeExpiredMessage(m.id); return; }
  const handles=[];
  const arm=(delay)=>{
    if(delay>MAX_TIMEOUT) handles.push(setTimeout(()=>arm(delay-MAX_TIMEOUT), MAX_TIMEOUT));
    else handles.push(setTimeout(()=>removeExpiredMessage(m.id), delay));
  };
  arm(remaining);
  expiryTimers.set(m.id, handles);
}
function renderMessages(messages){
  const box=$('#messages'); box.innerHTML=''; let last='';
  clearAllMessageExpiries();
  messages.forEach(m=>{ const label=dayLabel(m.sent_at); if(label!==last){box.insertAdjacentHTML('beforeend',`<div class="day">${label}</div>`);last=label;} box.insertAdjacentHTML('beforeend',renderMessage(m)); scheduleMessageExpiry(m); });
  wireVoicePlayers(box);
  box.scrollTop=box.scrollHeight;
}
async function markRead(){
  if (!active || document.visibilityState !== 'visible') return;
  const result=await api('/messages/'+encodeURIComponent(active)+'/read',{method:'POST'});
  (result.body?.read_ids||[]).forEach(id=>{const row=document.querySelector(`[data-id="${id}"]`); if(row){const old=row.querySelector('.tick'); if(old){old.classList.add('read'); old.innerHTML='<path d="M1 6l4 4L11 1M5.5 6l4 4L15.5 1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';}}});
  if(result.body?.read_ids?.length) loadContacts();
}
async function openThread(){
  if(!active) return;
  $('#empty-main').hidden=true; $('#thread').hidden=false; $('#thread-name').textContent=active;
  const contact=contacts.find(c=>c.username===active);
  const profile=contact||((await api('/profile/'+encodeURIComponent(active))).body||{});
  $('#thread-avatar').outerHTML=avatar(active,profile.avatar,44,!!profile.online); // restore stable id
  const avatarEl=document.querySelector('#thread .avatar'); if(avatarEl) avatarEl.id='thread-avatar';
  const history=await api('/messages/'+encodeURIComponent(active));
  if(history.ok) renderMessages(history.body);
  const setting=await api('/chat/'+encodeURIComponent(active)+'/disappearing'); if(setting.ok) $('#disappearing').value=setting.body.seconds;
  if($('#thread-archive-btn'))$('#thread-archive-btn').textContent=(contact&&contact.archived)?tr('Unarchive chat'):tr('Archive chat');
  await updatePresence(); await markRead();
}
function closeThread(){ location.href='/chat'; }
function viewActiveProfile(){ if(active) openProfileModal(active); }
async function toggleActiveMute(){
  if(!active)return;
  const contact=contacts.find(c=>c.username===active);
  const nextMuted=!(contact&&contact.muted);
  const result=await api('/contacts/'+encodeURIComponent(active)+'/mute',{method:'POST',body:JSON.stringify({muted:nextMuted})});
  if(!result.ok){toast(result.body?.error||'Could not update mute setting.');return;}
  if(contact)contact.muted=nextMuted;
  $('#profile-modal-mute-switch')?.classList.toggle('on',nextMuted);
  toast(nextMuted?`${active} muted.`:`${active} unmuted.`);
}
function sharedMediaThumb(item){
  if(item.type==='video')return `<video class="shared-media-thumb" src="${esc(item.content)}" muted playsinline preload="metadata"></video>`;
  return `<img class="shared-media-thumb" src="${esc(item.content)}" alt="Shared photo" loading="lazy">`;
}
async function loadSharedMedia(username){
  const grid=$('#profile-modal-media'), section=$('#profile-modal-media-section'); if(!grid||!section)return;
  const result=await api('/messages/'+encodeURIComponent(username)+'/media');
  const items=result.ok?result.body:[];
  section.hidden=!items.length;
  grid.innerHTML=items.map(sharedMediaThumb).join('');
}
async function openProfileModal(username){
  const modal=$('#profile-modal'); if(!modal||!username) return;
  const contact=contacts.find(c=>c.username===username);
  const result=await api('/profile/'+encodeURIComponent(username));
  const u=result.ok?result.body:(contact||{username});
  $('#profile-modal-avatar').innerHTML=avatar(username,u.avatar,88,!!u.online);
  $('#profile-modal-name').textContent=username;
  $('#profile-modal-status').textContent=presenceText(u)||tr('Offline');
  $('#profile-modal-details').innerHTML=`
    <div class="profile-detail"><small>${tr('Username')}</small><span>${esc(username)}</span></div>`;
  $('#profile-modal-mute-switch')?.classList.toggle('on',!!contact?.muted);
  loadSharedMedia(username);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
}
function closeProfileModal(){
  const modal=$('#profile-modal'); if(!modal) return;
  modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
}
function syncDisappearingControl(m){
  if(m.type!=='system'||!active)return;
  if(m.from!=='me' && m.from!==active)return;
  const parts=(m.content||'').split(':');
  if(parts[0]!=='disappearing')return;
  const select=$('#disappearing'); if(select)select.value=parts[1];
}
async function saveDisappearing(seconds){
  if(!active) return;
  await api('/chat/'+encodeURIComponent(active)+'/disappearing',{method:'POST',body:JSON.stringify({seconds:Number(seconds)})});
}
function toggleThreadMenu(){
  const menu=$('#thread-menu'); if(menu)menu.classList.toggle('open');
}
async function blockActiveUser(){
  if(!active)return;
  $('#thread-menu')?.classList.remove('open');
  if(!window.confirm(tr(`Block ${active}? They will not be able to message you.`)))return;
  const result=await api('/users/'+encodeURIComponent(active)+'/block',{method:'POST',body:'{}'});
  if(!result.ok){toast(result.body?.error||'Could not block this user.');return;}
  toast(`${active} is blocked.`);location.href='/chat';
}
function appendLiveMessage(m){
  if(m.from!=='me' && m.from!==active) return;
  const box=$('#messages'), near=box.scrollHeight-box.scrollTop-box.clientHeight<140;
  if(m.id && box.querySelector(`[data-id="${m.id}"]`)) return;
  const last=box.querySelector('.day:last-of-type'), label=dayLabel(m.sent_at);
  if(!last || last.textContent!==label) box.insertAdjacentHTML('beforeend',`<div class="day">${label}</div>`);
   box.insertAdjacentHTML('beforeend',renderMessage(m)); wireVoicePlayers(box.lastElementChild); if(near || m.from==='me') box.scrollTop=box.scrollHeight;
  scheduleMessageExpiry(m);
  if(m.from!== 'me') markRead();
}
function connectSocket(){
  socket=io({auth:{token:token()}});
  socket.on('new_message',async m=>{appendLiveMessage(m); syncDisappearingControl(m); await loadContacts(); notify(m);});
  socket.on('message_updated',m=>{if(m.from===active||m.from==='me'){const row=document.querySelector(`[data-id="${m.id}"]`);if(row)row.outerHTML=renderMessage(m);}});
  socket.on('message_status',data=>(data.ids||[]).forEach(id=>{
    const row=document.querySelector(`[data-id="${id}"]`); if(!row)return;
    const oldTick=row.querySelector('.tick'); if(!oldTick)return;
    oldTick.classList.toggle('read',data.status==='read');
    // BUGFIX: this used to only redraw the tick as a double-check when the
    // status was 'read' — a 'delivered' update left the tick showing
    // whatever it was at render time (usually a single check) even though
    // the message really had been delivered, so ticks never advanced live.
    // Both 'delivered' and 'read' are double-checks; only the color differs.
    oldTick.innerHTML='<path d="M1 6l4 4L11 1M5.5 6l4 4L15.5 1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
  }));
   socket.on('typing',data=>{if(data.from===active){const wasTyping=remoteTyping;remoteTyping=!!data.active;$('#thread-status').textContent=remoteTyping?tr('typing…'):''; if(remoteTyping&&!wasTyping)playTypingSound(); if(!remoteTyping)updatePresence();}});
  socket.on('presence',data=>{if(data.username===active && !remoteTyping)$('#thread-status').textContent=presenceText(data);loadContacts();});
}
function connectNotificationSocket(){
  // Settings / new-message screens don't open the full chat socket; this
  // lightweight one shows the in-app banner for messages that arrive there.
  if(!token())return;
  const notifySocket=io({auth:{token:token()}});
  notifySocket.on('new_message',notify);
  window.addEventListener('beforeunload',()=>notifySocket.close());
}
async function sendPayload(payload){
  if(!active)return false;
  const result=await api('/send',{method:'POST',body:JSON.stringify({to:active,...payload})});
  if(result.ok){appendLiveMessage(result.body);loadContacts();return true;}
  toast(result.body?.error||'Message could not be sent.'); return false;
}
function syncComposerActions(){
  const input=$('#message-input'), send=$('#composer .send'), voice=$('#voice-button');
  if(!input||!send||!voice)return;
  const hasText=!!input.value.trim();
  send.hidden=!hasText;
  voice.hidden=hasText;
}
async function sendMessage(){
  const input=$('#message-input'), button=document.querySelector('#composer .send'), content=input.value.trim();
  if(!content||!active)return;
  input.value=''; input.style.height='auto';
  syncComposerActions();
  if(button){button.disabled=true;button.classList.add('sending');}
  if(!(await sendPayload({type:'text',content}))){input.value=content;input.dispatchEvent(new Event('input'));}
  if(button){button.disabled=false;button.classList.remove('sending');}
  syncComposerActions();
}
function readFileAsDataUrl(file){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
}
async function sendAttachment(event){
  const file=event.target.files?.[0]; event.target.value=''; if(!file||!active)return;
  if(file.size>12*1024*1024){toast('Choose an image, video, or audio file smaller than 12 MB.');return;}
  const type=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'voice':'image';
  try{await sendPayload({type,content:await readFileAsDataUrl(file)});}catch(_){toast('That file could not be read.');}
}
// Live speech-to-text while recording, so the other person can translate the voice note.
function startVoiceTranscription(keep){
  if(!keep){voiceFinal='';voiceTranscript='';}
  voiceRecognition=null;
  if(localStorage.getItem('hwfar_voice_transcribe')==='off')return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR)return;
  try{
    const rec=new SR();
    rec.continuous=true; rec.interimResults=true; rec.lang=currentLanguage==='fr'?'fr-FR':'en-US';
    rec.onresult=e=>{
      let interim='';
      for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];if(r.isFinal)voiceFinal+=r[0].transcript+' ';else interim+=r[0].transcript;}
      voiceTranscript=(voiceFinal+interim).trim();
    };
    rec.onerror=()=>{};
    rec.onend=()=>{if(voiceRecognition===rec&&mediaRecorder&&mediaRecorder.state==='recording'){try{rec.start();}catch(_){}}};
    voiceRecognition=rec; rec.start();
  }catch(_){voiceRecognition=null;}
}
function stopVoiceTranscription(){
  const rec=voiceRecognition; voiceRecognition=null;
  if(!rec)return Promise.resolve(voiceTranscript.trim());
  return new Promise(resolve=>{
    let done=false; const finish=()=>{if(done)return;done=true;resolve(voiceTranscript.trim());};
    rec.onend=finish; try{rec.stop();}catch(_){finish();} setTimeout(finish,900);
  });
}
function stopRecorderAfterFlush(recorder){
  if(!recorder||recorder.state==='inactive')return;
  // Give mobile encoders time to dispatch their final dataavailable chunk.
  // Stopping immediately is what clips the last syllable of a voice note.
  try{recorder.requestData();}catch(_){}
  setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},320);
}
const recElapsed=()=>Math.max(0,(recordingPauseAt||Date.now())-recordingStartedAt-recordingPausedMs);
async function startVoiceRecording(event){
  event?.preventDefault(); if(mediaRecorder||!active)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Voice recording is not supported in this browser.');return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const pickedMime=pickAudioMimeType();
    mediaRecorder=pickedMime?new MediaRecorder(stream,{mimeType:pickedMime}):new MediaRecorder(stream);
    recordingChunks=[]; recordingStartedAt=Date.now(); recordingPausedMs=0; recordingPauseAt=0; recordingCancelled=false;
    const composer=$('#composer'), bar=document.createElement('div');
    bar.id='rec-bar'; bar.className='rec-bar';
    bar.innerHTML=`<button type="button" class="rec-del" title="${tr('Discard recording')}" aria-label="${tr('Discard recording')}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>`
      +`<span class="rec-dot"></span><span class="rec-time" id="recording-time">0:00</span>`
      +`<span class="rec-wave" aria-hidden="true">${Array.from({length:28},(_,i)=>`<i style="animation-delay:-${(i*0.11).toFixed(2)}s"></i>`).join('')}</span>`
      +`<button type="button" class="rec-pause" title="Pause" aria-label="Pause">❚❚</button>`
      +`<button type="button" class="rec-send" title="Send voice message" aria-label="Send voice message"><svg viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13"/></svg></button>`;
    composer.classList.add('recording-mode'); composer.appendChild(bar);
    const timeEl=bar.querySelector('.rec-time');
    bar.querySelector('.rec-del').onclick=e=>{e.preventDefault();cancelVoiceRecording();};
    bar.querySelector('.rec-send').onclick=e=>{e.preventDefault();stopVoiceRecording();};
    bar.querySelector('.rec-pause').onclick=e=>{e.preventDefault();togglePauseVoiceRecording();};
    recordingTimer=setInterval(()=>{timeEl.textContent=voiceClock(recElapsed()/1000);},250);
    mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)recordingChunks.push(e.data);};
    mediaRecorder.onstop=async()=>{
      const transcriptPromise=stopVoiceTranscription();
      clearInterval(recordingTimer); bar.remove(); composer.classList.remove('recording-mode');
      stream.getTracks().forEach(track=>track.stop());
      const duration=Math.max(1,Math.round(recElapsed()/1000)); const mime=mediaRecorder.mimeType||pickedMime;
      mediaRecorder=null; recordingPauseAt=0;
      if(recordingCancelled||!recordingChunks.length){recordingCancelled=false;return;}
      const blob=new Blob(recordingChunks,{type:mime||'audio/webm'}); const data=await readFileAsDataUrl(blob);
      const transcript=await transcriptPromise;
      await sendPayload({type:'voice',content:data,duration,transcript});
    };
    // Flushing chunks every 250ms keeps the last stretch of a recording from being cut off.
    mediaRecorder.start(250);
    startVoiceTranscription();
  }catch(_){toast('Microphone access was blocked. Allow it to record voice notes.');mediaRecorder=null;$('#composer')?.classList.remove('recording-mode');$('#rec-bar')?.remove();}
}
function togglePauseVoiceRecording(){
  if(!mediaRecorder)return;
  const bar=$('#rec-bar'), btn=bar?.querySelector('.rec-pause');
  if(mediaRecorder.state==='recording'){
    mediaRecorder.pause(); recordingPauseAt=Date.now(); stopVoiceTranscription();
    bar?.classList.add('paused'); if(btn){btn.textContent='🎙';btn.title='Resume';btn.setAttribute('aria-label','Resume');}
  }else if(mediaRecorder.state==='paused'){
    mediaRecorder.resume(); recordingPausedMs+=Date.now()-recordingPauseAt; recordingPauseAt=0; startVoiceTranscription(true);
    bar?.classList.remove('paused'); if(btn){btn.textContent='❚❚';btn.title='Pause';btn.setAttribute('aria-label','Pause');}
  }
}
function stopVoiceRecording(event){
  event?.preventDefault(); if(!mediaRecorder||mediaRecorder.state==='inactive')return;
  stopRecorderAfterFlush(mediaRecorder);
}
function cancelVoiceRecording(){
  if(!mediaRecorder)return;
  recordingCancelled=true;
  if(mediaRecorder.state!=='inactive')mediaRecorder.stop();
  toast('Voice note discarded.');
}
async function toggleVoiceRecording(){
  if(mediaRecorder){stopVoiceRecording();return;}
  await startVoiceRecording();
}
async function editMessage(id){
  const row=document.querySelector(`[data-id="${id}"]`), current=row?.querySelector('.bubble-text')?.textContent||''; if(!current)return;
  const content=window.prompt(tr('Edit message'),current); if(content===null||!content.trim()||content.trim()===current)return;
  const result=await api('/messages/'+id,{method:'PATCH',body:JSON.stringify({content:content.trim()})});
  if(!result.ok)toast(result.body?.error||'Message could not be edited.'); else if(row)row.outerHTML=renderMessage(result.body);
}
async function deleteMessage(id){
  const row=document.querySelector(`[data-id="${id}"]`); if(!row)return;
  if(!window.confirm(tr('Delete this message? If it has been seen, it will only disappear for you.')))return;
  const result=await api('/messages/'+id,{method:'DELETE'});
  if(!result.ok){toast(result.body?.error||'Message could not be deleted.');return;}
  if(row)row.outerHTML=renderMessage(result.body); loadContacts();
}
function messagePreviewText(m){
  if(m.deleted)return tr('This message was deleted');
  if(m.type==='image')return tr('Photo');
  if(m.type==='video')return tr('Video');
  if(m.type==='voice'||m.type==='audio')return tr('Voice message');
  const text=m.content||'';
  return text.length>72?text.slice(0,72)+'…':text;
}
let inAppNotifTimer=null;
function showInAppMessageBanner(m){
  // The WhatsApp-style "heads-up" banner: while the app itself is open —
  // on any page, not just the chat you happen to be in — the OS can't show
  // a real system notification, so this recreates that in-app: it fades in
  // over 2s with the sender's avatar, name and a message preview, stays
  // fully visible long enough to actually read, then fades back out.
  // Tapping it anywhere jumps straight into that chat.
  let el=$('#in-app-notif');
  if(!el){
    el=document.createElement('div');
    el.id='in-app-notif';
    el.className='in-app-notif';
    document.body.appendChild(el);
  }
  const senderAvatar=contacts.find(c=>c.username===m.from)?.avatar||null;
  el.innerHTML=`${avatar(m.from,senderAvatar,40)}<div class="in-app-notif-body"><div class="in-app-notif-name">${esc(m.from)}</div><div class="in-app-notif-text">${esc(messagePreviewText(m))}</div></div>`;
  el.onclick=()=>{location.href='/chat/'+encodeURIComponent(m.from);};
  clearTimeout(inAppNotifTimer);
  el.classList.remove('show'); void el.offsetWidth; // restart the fade-in if a banner is already showing
  el.classList.add('show');
  // 2s to fade in, ~4s to actually read it, then it fades back out (2s) on its own.
  inAppNotifTimer=setTimeout(()=>el.classList.remove('show'),6000);
}
function notify(m){
  if(m.from==='me'||m.type==='system')return;
  if(contacts.find(c=>c.username===m.from)?.muted)return; // WhatsApp-style per-chat mute
  playNotificationSound();
  if(document.visibilityState==='visible'){
    // Tab is focused — there's no OS heads-up to fall back on, so show the
    // in-app banner instead, unless the message is in the thread you're
    // already looking at (it just appears inline there — no banner needed).
    if(localStorage.getItem('chatly_notifications')==='on'&&m.from!==active)showInAppMessageBanner(m);
    return;
  }
  if(localStorage.getItem('chatly_notifications')!=='on'||!('Notification'in window)||Notification.permission!=='granted')return;
  new Notification(m.from,{body:messagePreviewText(m),tag:'hwfar-'+m.from});
}
function initMoreMenu(){
  const bar=document.querySelector('.topbar'); if(!bar||bar.querySelector('.more-toggle'))return;
  const button=document.createElement('button'); button.className='icon-btn more-toggle'; button.type='button'; button.title='More'; button.setAttribute('aria-label','More'); button.textContent='⋮';
  const menu=document.createElement('div'); menu.className='more-menu'; menu.innerHTML='<a href="/new-chat">New message</a><a href="/settings">Settings</a>';
  button.onclick=event=>{event.stopPropagation();menu.classList.toggle('open');};
  document.addEventListener('click',()=>menu.classList.remove('open'));
  bar.append(button,menu);
}
async function ensurePushSubscription(){
  // Runs quietly on every load (no UI, no permission prompt). If the user
  // already granted notification permission, this makes sure the server
  // actually has a live subscription for this device — covering the case
  // where the original subscription expired, the push service rotated the
  // endpoint, or it never reached the server in the first place (e.g. a
  // fresh install or a redeployed backend).
  //
  // BUGFIX: this used to bail out unless localStorage's 'chatly_notifications'
  // flag was already 'on'. That flag is only ever set by the in-app banner's
  // "Enable" button or the Settings toggle — so anyone whose browser already
  // had permission granted through some other path (an earlier build/test,
  // or granting it via the browser's own site-settings UI) could be stuck
  // forever: permission is 'granted' so the banner never shows again
  // (it only offers to ask when permission is still 'default'), and this
  // function refused to subscribe because the flag was never flipped. Now
  // browser permission is treated as the source of truth and the flag is
  // self-healed to match it.
  try{
    if(!('Notification'in window)||Notification.permission!=='granted')return;
    if(localStorage.getItem('chatly_notifications')!=='on'){
      localStorage.setItem('chatly_notifications','on');
      $('#notification-switch')?.classList.add('on');
    }
    await subscribeToPush();
  }catch(_){/* best effort — in-app alerts still work regardless */}
}
if('serviceWorker'in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='hwfar-resubscribe-push')ensurePushSubscription();
  });
}
async function initChatPage(){
  if(!token()){location.href='/';return;}
  active=window.ACTIVE_USERNAME||null;
  ensurePushSubscription();
  await initPageLanguage();
  initMoreMenu();
  $('#search').oninput=loadContacts;
  $('#composer').onsubmit=e=>{e.preventDefault();sendMessage();};
  $('#attach-button').onclick=()=>$('#attachment-input').click();
  $('#attachment-input').onchange=sendAttachment;
  $('#thread-more')?.addEventListener('click',event=>{event.stopPropagation();toggleThreadMenu();});
  document.addEventListener('click',()=>$('#thread-menu')?.classList.remove('open'));
  $('#thread-profile-trigger')?.addEventListener('click',viewActiveProfile);
  $('#profile-modal-close')?.addEventListener('click',closeProfileModal);
  $('#profile-modal')?.addEventListener('click',e=>{if(e.target.id==='profile-modal')closeProfileModal();});
  $('#messages')?.addEventListener('click',e=>{const img=e.target.closest('img.message-media'); if(img)openMediaViewer(img.src);});
  $('#profile-modal-media')?.addEventListener('click',e=>{const img=e.target.closest('img.shared-media-thumb'); if(img)openMediaViewer(img.src);});
  $('#media-viewer-close')?.addEventListener('click',closeMediaViewer);
  $('#media-viewer')?.addEventListener('click',e=>{if(e.target.id==='media-viewer')closeMediaViewer();});
  const voice=$('#voice-button'); voice.onclick=toggleVoiceRecording;
  $('#message-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}};
  $('#message-input').oninput=e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';syncComposerActions(); if(socket&&active){socket.emit('typing',{to:active,active:true});clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit('typing',{to:active,active:false}),1800);}};
  syncComposerActions();
  if(window.visualViewport){
    const vv=window.visualViewport;
    const pinComposer=()=>{
      const composer=$('#composer'); if(!composer)return;
      const overlap=window.innerHeight-vv.height-vv.offsetTop;
      composer.style.transform=overlap>0?`translateY(-${overlap}px)`:'';
      const box=$('#messages'); if(box)box.scrollTop=box.scrollHeight;
    };
    vv.addEventListener('resize',pinComposer); vv.addEventListener('scroll',pinComposer);
  }
  loadContacts().then(openThread); connectSocket(); document.addEventListener('visibilitychange',markRead);
}
async function initSettingsPage(){
  if(!token()){location.href='/';return;}
  await initPageLanguage();
  initMoreMenu();
  connectNotificationSocket();
  ensurePushSubscription();
  const me=await api('/account/me'); if(!me.ok)return;
  if($('#new-username'))$('#new-username').value=me.body.username;
  if($('#avatar-preview')){
    $('#avatar-preview').innerHTML=me.body.avatar?`<img src="${esc(me.body.avatar)}" alt="Profile photo">`:'👤';
    initAvatarUpload();
  }
  if($('#online-switch'))$('#online-switch').classList.toggle('on',me.body.show_online!==false);
  if($('#lastseen-switch'))$('#lastseen-switch').classList.toggle('on',me.body.show_last_seen!==false);
  if($('#theme-switch'))$('#theme-switch').classList.toggle('on',document.body.dataset.theme==='dark');
   if($('#welcome-animation-switch'))$('#welcome-animation-switch').classList.toggle('on',localStorage.getItem('hwfar_welcome_animation')!=='off');
  if($('#love-rain-switch'))$('#love-rain-switch').classList.toggle('on',loveRainOn());
  if($('#voice-transcribe-switch'))$('#voice-transcribe-switch').classList.toggle('on',localStorage.getItem('hwfar_voice_transcribe')!=='off');
  const notifMasterOn=localStorage.getItem('chatly_notifications')==='on';
  if($('#notification-switch'))$('#notification-switch').classList.toggle('on',notifMasterOn);
  const prefs=me.body.notification_prefs||{};
  NOTIFICATION_CATEGORIES.forEach(key=>{
    const el=$('#notif-cat-'+key); if(!el)return;
    el.classList.toggle('on',prefs[key]!==false);
    el.closest('.setting')?.classList.toggle('disabled-setting',!notifMasterOn);
  });
  if($('#notification-sound-switch'))$('#notification-sound-switch').classList.toggle('on',soundOn('hwfar_notification_sound'));
  if($('#typing-sound-switch'))$('#typing-sound-switch').classList.toggle('on',soundOn('hwfar_typing_sound'));
  document.querySelectorAll('.language-choice').forEach(button=>button.classList.toggle('active',button.dataset.language===currentLanguage));
  if($('#blocked-list'))loadBlockedList();
}

// ---- Install button (PWA "Add to Home Screen") ----
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  updateInstallButtons();
});
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  updateInstallButtons();
  toast('App installed — you can now open it from your home screen.');
});
function isAppInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone===true
    || localStorage.getItem('hwfar_install_tracked')==='1';
}
function updateInstallButtons(){
  document.querySelectorAll('.install-btn').forEach(btn=>{
    if(isAppInstalled()){
      btn.textContent='✓ Installed';
      btn.classList.add('installed');
      btn.title='The app is already installed on this device';
    }else{
      btn.textContent='⭳ Install app';
      btn.classList.remove('installed');
      btn.title='Install the app to your device';
    }
  });
}
function handleInstallClick(){
  if(isAppInstalled()){toast('The app is already installed on this device.');return;}
  if(!deferredInstallPrompt){
    const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    toast(ios?'On iPhone: tap Share, then "Add to Home Screen" to install the app.':'Open your browser menu and choose "Add to Home screen" to install the app.');return;
  }
  runInstallProgress();
}
function runInstallProgress(){
  const prompt=deferredInstallPrompt; deferredInstallPrompt=null;
  const overlay=document.createElement('div');
  overlay.className='install-progress-overlay';
  overlay.innerHTML='<div class="install-progress-card"><div class="install-progress-label">Installing…</div>'
    +'<div class="install-progress-track"><div class="install-progress-bar" id="install-progress-bar"></div></div>'
    +'<div class="install-progress-pct" id="install-progress-pct">0%</div></div>';
  document.body.appendChild(overlay);
  const bar=overlay.querySelector('#install-progress-bar'), pct=overlay.querySelector('#install-progress-pct');
  let progress=0, done=false;
  const tick=setInterval(()=>{
    if(done)return;
    progress=Math.min(progress+(progress<70?(Math.random()*9+3):(Math.random()*2+.5)),92);
    bar.style.width=progress+'%'; pct.textContent=Math.round(progress)+'%';
  },140);
  prompt.prompt();
  prompt.userChoice.then(choice=>{
    done=true; clearInterval(tick);
    if(choice.outcome==='accepted'){
      bar.style.width='100%'; pct.textContent='100%';
      setTimeout(()=>overlay.remove(),500);
    }else{
      overlay.remove();
      toast('Installation cancelled.');
      updateInstallButtons();
    }
  }).catch(()=>{
    done=true; clearInterval(tick);
    overlay.remove();
    toast('Could not start installation.');
  });
}
document.addEventListener('DOMContentLoaded',updateInstallButtons);

// ---- Falling hearts & photos: a gentle burst from the top of the chat every minute ----
const LOVE_RAIN_EVERY_MS=60000;
let loveRainFirst=null, loveRainTimer=null;
const loveRainOn=()=>localStorage.getItem('hwfar_love_rain')!=='off';
function pourLove(){
  if(!loveRainOn()||document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  let layer=document.getElementById('love-rain');
  if(!layer){layer=document.createElement('div');layer.id='love-rain';layer.setAttribute('aria-hidden','true');layer.setAttribute('data-notr','');document.body.appendChild(layer);}
  const colors=['#f0008a','#ff4db8','#ff8ad2','#ff2f68','#ffd0ec','#e24aa8'], rnd=(a,b)=>a+Math.random()*(b-a), width=window.innerWidth;
  for(let i=0;i<24;i++){
    const photo=i%4===1, size=photo?rnd(36,54):rnd(15,30), dur=rnd(7,11), delay=rnd(0,3.2);
    const el=document.createElement('div'), inner=document.createElement('span');
    el.className='rain-item'; inner.className='sway';
    el.style.left=rnd(0,Math.max(0,width-size))+'px';
    el.style.setProperty('--dur',dur.toFixed(2)+'s'); el.style.setProperty('--delay',delay.toFixed(2)+'s');
    el.style.setProperty('--drift',Math.round(rnd(-70,70))+'px'); el.style.setProperty('--rot',Math.round(rnd(-300,300))+'deg');
    inner.style.setProperty('--sway',rnd(2.2,4).toFixed(2)+'s');
    if(photo){
      const img=new Image(); img.className='rain-photo'; img.alt=''; img.draggable=false;
      img.src='/static/love-petal-'+(1+Math.floor(i/4)%3)+'.jpg'; img.style.setProperty('--s',Math.round(size)+'px'); inner.appendChild(img);
    }else{
      inner.className+=' rain-heart'; inner.textContent='\u2665'; inner.style.fontSize=Math.round(size)+'px';
      el.style.setProperty('--c',colors[Math.floor(Math.random()*colors.length)]);
    }
    el.appendChild(inner); layer.appendChild(el);
    setTimeout(()=>el.remove(),(dur+delay)*1000+500);
  }
}
function stopLoveRain(){
  clearTimeout(loveRainFirst); clearInterval(loveRainTimer); loveRainFirst=loveRainTimer=null;
  document.getElementById('love-rain')?.remove();
}
function startLoveRain(){
  stopLoveRain();
  if(!document.getElementById('chat-shell')||!loveRainOn())return;
  loveRainFirst=setTimeout(pourLove,4000);
  loveRainTimer=setInterval(pourLove,LOVE_RAIN_EVERY_MS);
}
function applyLoveRainPreference(){loveRainOn()?startLoveRain():stopLoveRain();}
document.addEventListener('DOMContentLoaded',startLoveRain);

async function togglePrivacySetting(setting='show_online'){
  const ids={show_online:'online-switch',show_last_seen:'lastseen-switch'};
  const sw=$('#'+ids[setting]); if(!sw)return;
  const next=!sw.classList.contains('on'); sw.classList.toggle('on',next);
  const result=await api('/account/privacy',{method:'POST',body:JSON.stringify({[setting]:next})});
  if(!result.ok) { sw.classList.toggle('on',!next); if($('#settings-flash'))$('#settings-flash').textContent=result.body?.error||'Could not save privacy setting.'; }
}
async function loadBlockedList(){
  const list=$('#blocked-list'); if(!list)return;
  const result=await api('/blocked');
  if(!result.ok){list.innerHTML='<div class="empty">Could not load your blocked list.</div>';return;}
  const blocked=result.body||[];
  list.innerHTML=blocked.length?blocked.map(u=>`
    <div class="setting"><div>${avatar(u.username,u.avatar,36)}</div><div><b>${esc(u.username)}</b></div><div class="spacer"></div>
    <button class="btn secondary" type="button" onclick="unblockUser('${esc(u.username)}')">Unblock</button></div>`).join('')
    :'<div class="empty">You haven\'t blocked anyone.</div>';
}
async function unblockUser(username){
  const result=await api('/users/'+encodeURIComponent(username)+'/unblock',{method:'POST',body:'{}'});
  if(!result.ok){toast(result.body?.error||'Could not unblock this user.');return;}
  toast(`${username} is unblocked.`);
  loadBlockedList();
}
async function saveUsername(){
  const result=await api('/account/username',{method:'POST',body:JSON.stringify({username:$('#new-username').value.trim()})});
  $('#settings-flash').textContent=result.ok?'Username updated.':(result.body?.error||'Could not update username.');
}
function initAvatarUpload(){
  const input=$('#avatar-upload'); if(!input||input._wired)return; input._wired=true;
  input.addEventListener('change',event=>{
    const file=event.target.files?.[0]; if(!file)return;
    if(file.size>2*1024*1024){$('#settings-flash').textContent='Choose an image smaller than 2 MB.';event.target.value='';return;}
    const reader=new FileReader();
    reader.onload=async()=>{
      const dataUrl=reader.result;
      $('#avatar-preview').innerHTML=`<img src="${esc(dataUrl)}" alt="Profile photo">`;
      const result=await api('/account/avatar',{method:'POST',body:JSON.stringify({avatar:dataUrl})});
      $('#settings-flash').textContent=result.ok?'Profile photo updated.':(result.body?.error||'Could not update photo.');
    };
    reader.readAsDataURL(file);
  });
}
async function changePassword(){
  const current=$('#current-password').value, next=$('#new-password').value, flash=$('#settings-flash');
  if(next.length<6){flash.textContent='New password needs at least 6 characters.';return;}
  const result=await api('/account/password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})});
  flash.textContent=result.ok?'Password updated.':(result.body?.error||'Could not update password.');
  if(result.ok){$('#current-password').value='';$('#new-password').value='';}
}
let firebaseConfigCache=null, firebaseMessagingApp=null, currentFcmToken=null;
async function getFirebaseMessaging(){
  if(firebaseMessagingApp)return firebaseMessagingApp;
  if(typeof firebase==='undefined'){console.debug('[hwfar-push] firebase-*-compat.js scripts did not load (network/CDN block?)');return null;}
  if(!firebaseConfigCache){
    const result=await api('/firebase-config');
    firebaseConfigCache=result.ok?result.body:null;
  }
  if(!firebaseConfigCache?.apiKey){console.debug('[hwfar-push] /firebase-config returned no apiKey — check FIREBASE_API_KEY etc. are set on Railway');return null;}
  if(!firebaseConfigCache?.vapidKey)console.debug('[hwfar-push] /firebase-config has no vapidKey — set FIREBASE_VAPID_KEY on Railway (Firebase console → Project Settings → Cloud Messaging → Web Push certificates)');
  try{
    if(!firebase.apps.length)firebase.initializeApp(firebaseConfigCache);
    firebaseMessagingApp=firebase.messaging();
    return firebaseMessagingApp;
  }catch(exc){console.debug('[hwfar-push] firebase.messaging() unavailable in this browser/context:',exc);return null;} // e.g. messaging unsupported in this browser/context
}
async function subscribeToPush(){
  if(!('serviceWorker'in navigator))return null;
  const messaging=await getFirebaseMessaging();
  if(!messaging)return null;
  const reg=await navigator.serviceWorker.ready;
  try{
    const tokenValue=await messaging.getToken({
      vapidKey:firebaseConfigCache.vapidKey,
      serviceWorkerRegistration:reg,
    });
    if(!tokenValue){console.debug('[hwfar-push] messaging.getToken() returned no token');return null;}
    currentFcmToken=tokenValue;
    const result=await api('/push/subscribe',{method:'POST',body:JSON.stringify({token:tokenValue,device_id:deviceId()})});
    if(!result.ok)console.debug('[hwfar-push] server rejected /push/subscribe:',result.status,result.body);
    return tokenValue;
  }catch(exc){console.debug('[hwfar-push] getToken()/subscribe failed:',exc);return null;}
}
async function unsubscribeFromPush(){
  const messaging=await getFirebaseMessaging();
  if(!messaging)return;
  try{
    const tokenValue=currentFcmToken||await messaging.getToken({vapidKey:firebaseConfigCache?.vapidKey}).catch(()=>null);
    if(tokenValue)await api('/push/unsubscribe',{method:'POST',body:JSON.stringify({token:tokenValue})});
    await messaging.deleteToken();
    currentFcmToken=null;
  }catch(_){/* best effort */}
}
function maybeShowNotificationPrompt(){
  // Auto-shown once per device to every logged-in user (instead of the old
  // behavior of only turning on push if someone found the Settings toggle
  // themselves). Anyone can still flip it off — or back on — in Settings
  // any time; this just makes the first ask happen for everyone.
  try{
    if(!token()){console.debug('[hwfar-push] skipped: not logged in');return;}
    if(!('Notification'in window)||!('serviceWorker'in navigator)){console.debug('[hwfar-push] skipped: Notification/serviceWorker unsupported in this browser');return;}
    if(Notification.permission==='granted'){
      // Already granted (e.g. from an earlier build/test, or granted via the
      // browser's own site-settings UI) — nothing to ask, just make sure
      // we're actually subscribed. See BUGFIX note in ensurePushSubscription.
      ensurePushSubscription();
      return;
    }
    if(Notification.permission==='denied'){console.debug('[hwfar-push] skipped: notifications blocked in browser settings for this site');return;}
    if(localStorage.getItem('chatly_notif_prompt_seen')){console.debug('[hwfar-push] skipped: prompt already dismissed on this device (chatly_notif_prompt_seen)');return;}
    if(document.querySelector('.notif-permission-banner'))return;
    const banner=document.createElement('div');
    banner.className='notif-permission-banner';
    banner.innerHTML=`<div class="notif-permission-text"><strong>${tr('Turn on notifications')}</strong><span>${tr('Get alerted about new messages, even when the app is closed.')}</span></div><div class="notif-permission-actions"><button type="button" class="btn secondary" data-action="dismiss">${tr('Not now')}</button><button type="button" class="btn" data-action="enable">${tr('Enable')}</button></div>`;
    const dismiss=()=>{localStorage.setItem('chatly_notif_prompt_seen','1');banner.remove();};
    banner.querySelector('[data-action="dismiss"]').onclick=dismiss;
    banner.querySelector('[data-action="enable"]').onclick=async()=>{
      localStorage.setItem('chatly_notif_prompt_seen','1');
      banner.remove();
      const permission=await Notification.requestPermission();
      if(permission==='granted'){
        localStorage.setItem('chatly_notifications','on');
        await subscribeToPush();
        $('#notification-switch')?.classList.add('on');
        document.querySelectorAll('.notif-category-switch').forEach(el=>el.closest('.setting')?.classList.remove('disabled-setting'));
      }
    };
    document.body.appendChild(banner);
  }catch(_){/* best effort — never block the page over this */}
}
async function toggleNotifications(){
  const sw=$('#notification-switch'), flash=$('#settings-flash');
  const next=!sw.classList.contains('on');
  if(next){
    if(!('Notification'in window)){flash.textContent='Notifications are not supported in this browser.';return;}
    if(Notification.permission!=='granted'){const permission=await Notification.requestPermission();if(permission!=='granted'){flash.textContent='Notifications are blocked in browser settings.';return;}}
    const sub=await subscribeToPush();
    if(!sub)flash.textContent='Push isn\u2019t set up on the server yet — you\u2019ll still get alerts while the app is open.';
  }else{
    await unsubscribeFromPush();
  }
  sw.classList.toggle('on',next);localStorage.setItem('chatly_notifications',next?'on':'off');
  document.querySelectorAll('.notif-category-switch').forEach(el=>el.closest('.setting')?.classList.toggle('disabled-setting',!next));
}
const NOTIFICATION_CATEGORIES=['messages','voice_notes'];
async function toggleNotificationCategory(key){
  const el=$('#notif-cat-'+key); if(!el)return;
  if(localStorage.getItem('chatly_notifications')!=='on')return; // master switch is off, category toggles are inert
  const next=!el.classList.contains('on'); el.classList.toggle('on',next);
  await api('/account/notification-prefs',{method:'POST',body:JSON.stringify({[key]:next})});
}
function toggleSoundPreference(key,id){
  const sw=$('#'+id); if(!sw)return;
  const next=!sw.classList.contains('on');
  sw.classList.toggle('on',next);
  localStorage.setItem(key,next?'on':'off');
  if(next&&key==='hwfar_notification_sound')playNotificationSound();
}
async function setLanguage(language){
  if(!['en','fr'].includes(language))return;
  const result=await api('/account/language',{method:'POST',body:JSON.stringify({language})});
  if(!result.ok){$('#settings-flash').textContent=result.body?.error||'Could not save language.';return;}
  localStorage.setItem('hwfar_language',language);localStorage.setItem('lang_chosen','1');location.reload();
}
window.loveLock = (() => {
  const KEY = 'love_unlock', HIDDEN = 'love_hidden_at', AWAY_MS = 60 * 1000;
  let el = null, busy = false;
  const exempt = () => location.pathname === '/' || location.pathname === '/offline.html';
  const needed = () => !exempt() && !!token();
  function build() {
    el = document.createElement('div');
    el.id = 'love-lock'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<form class="love-lock-card" autocomplete="off"><div class="love-lock-heart">♥</div><h1></h1>' +
      '<p>Enter your password to open the chat.</p>' +
      '<input type="password" id="love-lock-input" placeholder="Password" autocomplete="current-password" required>' +
      '<button class="btn" type="submit">Unlock</button><div class="error" id="love-lock-error"></div>' +
      '<button class="love-lock-out" type="button">Log out</button></form>';
    const me = localStorage.getItem('chatly_username');
    el.querySelector('h1').textContent = me ? 'Welcome back, ' + me : 'Welcome back';
    const input = el.querySelector('input'), err = el.querySelector('#love-lock-error');
    el.querySelector('.love-lock-out').onclick = () => logout();
    el.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true; err.textContent = '';
      const r = await api('/account/unlock', { method: 'POST', body: JSON.stringify({ password: input.value }) });
      busy = false;
      if (r.ok && r.body && r.body.unlock_token) {
        sessionStorage.setItem(KEY, r.body.unlock_token);
        location.reload();
      } else {
        err.textContent = (r.body && r.body.error) || 'Incorrect password.';
        input.value = ''; input.focus();
      }
    };
  }
  function show() {
    if (!needed()) return;
    if (!el) build();
    if (!el.isConnected) document.body.appendChild(el);
    const input = el.querySelector('input');
    setTimeout(() => input && input.focus(), 50);
  }
  function hide() { if (el && el.isConnected) el.remove(); }
  // Lock again when the app has been in the background for a minute.
  document.addEventListener('visibilitychange', () => {
    if (!needed()) return;
    if (document.hidden) { sessionStorage.setItem(HIDDEN, String(Date.now())); return; }
    const left = Number(sessionStorage.getItem(HIDDEN) || 0);
    sessionStorage.removeItem(HIDDEN);
    if (left && Date.now() - left > AWAY_MS) { sessionStorage.removeItem(KEY); show(); }
  });
  if (needed()) {
    if (!sessionStorage.getItem(KEY)) show();
    else api('/account/unlock/check'); // a 423 here (expired/invalid) brings the lock screen up
  }
  return { show, hide };
})();

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',showLanguagePopup);else showLanguagePopup();
