const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");

const ROOT_DIR = __dirname;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const REJOIN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const pendingVerifications = new Map();
const pendingRejoins = new Map();
const pendingAdminLinks = new Map();
const activeSessions = new Map();
const LAPTOP_ADMIN_HEADER = "x-this-laptop-admin";

loadEnvFile(path.join(ROOT_DIR, ".env"));

const PORT = Number(process.env.APP_PORT || 3000);
const HOST = process.env.APP_HOST || "0.0.0.0";
const DATA_FILE =
  process.env.APP_DATA_FILE || path.join(ROOT_DIR, "data", "users.json");
const PRO_PRICE = 25;
const usersStore = loadUsersStore();
const aiModelsStore = { models: [] };
const firebaseConfig = { enabled: false };
let firebaseTokenCache = null;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, getOrigin(request));

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      await handleServerStatus(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/send-verification-link") {
      await handleSendVerificationLink(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/verification") {
      handleVerificationLookup(requestUrl, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/rejoin") {
      handleRejoinLookup(requestUrl, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/approve-verification") {
      await handleApproveVerification(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/local-login") {
      await handleLocalLogin(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/password-login") {
      await handlePasswordLogin(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/create-verification-link") {
      await handleCreateAdminVerificationLink(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin-verification") {
      handleAdminVerificationLookup(requestUrl, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/approve-admin-verification") {
      await handleApproveAdminVerification(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin/users") {
      await handleAdminUsers(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/session") {
      await handleSessionLookup(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/users/action") {
      await handleAdminUserAction(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chat/threads") {
      await handleChatThreads(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chat/messages") {
      await handleChatMessages(requestUrl, request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chat/messages") {
      await handleSendChatMessage(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/agent/model") {
      await handleCreateAiModel(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/agent/chat") {
      await handleAgentChat(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStaticFile(requestUrl, request, response);
      return;
    }

    sendJson(response, 405, { message: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { message: "Something went wrong on the server." });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try a different APP_PORT in .env.`);
  } else if (error.code === "EACCES" || error.code === "EPERM") {
    console.error(
      `The app could not open http://${HOST}:${PORT}/. Allow local network access or set APP_HOST=127.0.0.1 for laptop-only testing.`,
    );
  } else {
    console.error(error.message);
  }

  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Secure Entry is running at http://${HOST}:${PORT}/`);
  getServerAccessUrls().forEach((url) => {
    console.log(`Open from devices here: ${url}`);
  });
});

async function handleServerStatus(request, response) {
  await refreshUsersFromDatabase();
  sendJson(response, 200, {
    ok: true,
    databaseMode: "Built-in shared server",
    userCount: Object.keys(usersStore.users).length,
    accessUrl: getOrigin(request),
  });
}

async function handleSendVerificationLink(request, response) {
  await refreshUsersFromDatabase();
  const body = await readJsonBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const username = normalizeUsername(body.username || "");
  const name = String(body.name || "").trim();
  const mobile = String(body.mobile || "").trim();
  const password = String(body.password || "");
  const rejoinToken = String(body.rejoinToken || "").trim();
  const previewOnly = body.previewOnly === true || body.previewOnly === "true";

  if (!isValidEmail(email)) {
    sendJson(response, 400, { message: "Please enter a valid registered email ID." });
    return;
  }

  if (!isValidUsername(username)) {
    sendJson(response, 400, { message: "Please enter a username using 3 to 24 letters, numbers, dots, underscores, or hyphens." });
    return;
  }

  if (name.length < 2) {
    sendJson(response, 400, { message: "Please enter your name before sending the link." });
    return;
  }

  if (!/^[0-9+\-\s()]{7,16}$/.test(mobile)) {
    sendJson(response, 400, { message: "Please enter a valid mobile number." });
    return;
  }

  if (password && password.length < 6) {
    sendJson(response, 400, { message: "Password must be at least 6 characters." });
    return;
  }

  const existingUser = usersStore.users[email];
  normalizeAccountStatus(existingUser);
  if (existingUser?.status === "suspended") {
    sendJson(response, 403, {
      message: `This account is suspended until ${formatServerDate(existingUser.suspendedUntil)}.`,
    });
    return;
  }

  if (existingUser?.status === "removed" && !isValidRejoinForEmail({ token: rejoinToken, email })) {
    sendJson(response, 403, {
      message: "This account was removed from the app. Ask an admin or pre-admin to send a rejoin link.",
    });
    return;
  }

  cleanupExpiredTokens();

  const token = crypto.randomBytes(32).toString("hex");
  const verificationLink = `${getOrigin(request)}/index.html#verify/${token}`;
  const profile = {
    email,
    username,
    name,
    mobile,
    password,
    rejoinToken: isValidRejoinForEmail({ token: rejoinToken, email }) ? rejoinToken : "",
    ipAddress: getClientIp(request),
    userAgent: request.headers["user-agent"] || "Unknown device",
    createdAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  pendingVerifications.set(token, profile);
  await upsertPendingUserFromProfile(profile, request);

  if (previewOnly || process.env.DISABLE_EMAIL_DELIVERY === "1") {
    sendJson(response, 200, {
      sent: false,
      token,
      previewLink: verificationLink,
      message:
        "Registration saved in the no-Firebase shared server. Admin can now see this user from any device using the same app address. The verification link is ready for the user to approve login.",
    });
    return;
  }

  try {
    await sendVerificationEmail({ email, name, verificationLink });
    sendJson(response, 200, {
      sent: true,
      message: `Registration saved in the no-Firebase shared server. Verification link sent to your registered email ID: ${email}.`,
    });
  } catch (error) {
    console.error("Email delivery failed:", error.message);

    if (process.env.ALLOW_DEV_EMAIL_PREVIEW === "1") {
      sendJson(response, 200, {
        sent: false,
        token,
        previewLink: verificationLink,
        message:
          "Registration saved in the no-Firebase shared server. Email delivery is in development preview mode. Configure SMTP settings to send the link to the registered email ID.",
      });
      return;
    }

    pendingVerifications.delete(token);
    sendJson(response, 503, {
      message:
        "Email sending is not configured yet. Add SMTP settings to .env, then try sending the verification link again.",
    });
  }
}

function handleVerificationLookup(requestUrl, response) {
  cleanupExpiredTokens();
  const token = requestUrl.searchParams.get("token") || "";
  const profile = pendingVerifications.get(token);

  if (!profile) {
    sendJson(response, 404, { valid: false, message: "This verification link is invalid or expired." });
    return;
  }

  sendJson(response, 200, {
    valid: true,
    profile: {
      email: profile.email,
      username: profile.username,
      name: profile.name,
      mobile: profile.mobile,
      role: usersStore.users[profile.email]?.role || "user",
      status: usersStore.users[profile.email]?.status || "pending",
      pro: Boolean(usersStore.users[profile.email]?.pro),
    },
  });
}

function handleRejoinLookup(requestUrl, response) {
  cleanupExpiredTokens();
  const token = requestUrl.searchParams.get("token") || "";
  const rejoin = pendingRejoins.get(token);

  if (!rejoin) {
    sendJson(response, 404, { valid: false, message: "This rejoin link is invalid or expired." });
    return;
  }

  sendJson(response, 200, {
    valid: true,
    email: rejoin.email,
    message: "Rejoin link accepted. Complete login to return to the app.",
  });
}

async function handleApproveVerification(request, response) {
  await refreshUsersFromDatabase();
  cleanupExpiredTokens();
  const body = await readJsonBody(request);
  const token = String(body.token || "");
  const profile = pendingVerifications.get(token);

  if (!profile) {
    sendJson(response, 404, { message: "This verification link is invalid or expired." });
    return;
  }

  const existingUser = usersStore.users[profile.email];
  normalizeAccountStatus(existingUser);
  if (existingUser?.status === "suspended") {
    sendJson(response, 403, {
      message: `This account is suspended until ${formatServerDate(existingUser.suspendedUntil)}.`,
    });
    return;
  }

  if (existingUser?.status === "removed" && !isValidRejoinForEmail({ token: profile.rejoinToken, email: profile.email })) {
    sendJson(response, 403, {
      message: "This account was removed from the app. A rejoin link is required.",
    });
    return;
  }

  pendingVerifications.delete(token);
  if (profile.rejoinToken) {
    pendingRejoins.delete(profile.rejoinToken);
  }
  const user = await upsertUserFromProfile(profile, request);
  const sessionToken = createSession(user.email);

  sendJson(response, 200, {
    profile: {
      email: user.email,
      username: user.username,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      pro: user.pro,
    },
    sessionToken,
    user: toPublicUser(user),
  });
}

async function handleLocalLogin(request, response) {
  await refreshUsersFromDatabase();
  const body = await readJsonBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const username = normalizeUsername(body.username || "");
  const name = String(body.name || "").trim();
  const mobile = String(body.mobile || "").trim();
  const password = String(body.password || "");

  if (!isValidEmail(email)) {
    sendJson(response, 400, { message: "Please enter a valid registered email ID." });
    return;
  }

  if (!isValidUsername(username)) {
    sendJson(response, 400, { message: "Please enter a username using 3 to 24 letters, numbers, dots, underscores, or hyphens." });
    return;
  }

  if (name.length < 2) {
    sendJson(response, 400, { message: "Please enter your name before login." });
    return;
  }

  if (!/^[0-9+\-\s()]{7,16}$/.test(mobile)) {
    sendJson(response, 400, { message: "Please enter a valid mobile number." });
    return;
  }

  const existingUser = usersStore.users[email];
  normalizeAccountStatus(existingUser);
  if (existingUser?.status === "suspended") {
    sendJson(response, 403, {
      message: `This account is suspended until ${formatServerDate(existingUser.suspendedUntil)}.`,
    });
    return;
  }

  if (existingUser?.status === "removed") {
    sendJson(response, 403, {
      message: "This account was removed from the app. A rejoin link is required.",
    });
    return;
  }

  const user = await upsertUserFromProfile(
    {
      email,
      username,
      name,
      mobile,
      password,
      ipAddress: getClientIp(request),
      userAgent: request.headers["user-agent"] || "Unknown device",
    },
    request,
  );
  const sessionToken = createSession(user.email);

  sendJson(response, 200, {
    profile: {
      email: user.email,
      username: user.username,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      pro: user.pro,
    },
    sessionToken,
    user: toPublicUser(user),
  });
}

async function handlePasswordLogin(request, response) {
  await refreshUsersFromDatabase();
  const body = await readJsonBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!isValidEmail(email) || password.length < 6) {
    sendJson(response, 400, { message: "Enter the email ID and password for this account." });
    return;
  }

  const user = usersStore.users[email];
  normalizeAccountStatus(user);
  if (!user) {
    sendJson(response, 404, { message: "No saved account was found for this email ID." });
    return;
  }

  if (user.status === "suspended") {
    sendJson(response, 403, {
      message: `This account is suspended until ${formatServerDate(user.suspendedUntil)}.`,
    });
    return;
  }

  if (user.status === "removed") {
    sendJson(response, 403, { message: "This account was removed from the app." });
    return;
  }

  if (!user.passwordHash) {
    sendJson(response, 403, {
      message: "This account needs one full login once before password-only sign in works.",
    });
    return;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    sendJson(response, 403, { message: "The password does not match this account." });
    return;
  }

  await promoteUserForLaptopAdminRequest(user, request);

  user.lastLoginAt = Date.now();
  user.loginCount = (user.loginCount || 0) + 1;
  user.lastIpAddress = getClientIp(request) || user.lastIpAddress || "Unknown network";
  user.lastDevice = request.headers["user-agent"] || user.lastDevice || "Unknown device";
  user.updatedAt = Date.now();
  await persistUserRecord(user);

  const sessionToken = createSession(user.email);
  sendJson(response, 200, {
    profile: {
      email: user.email,
      username: user.username,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      pro: user.pro,
    },
    sessionToken,
    user: toPublicUser(user),
  });
}

async function handleCreateAdminVerificationLink(request, response) {
  await refreshUsersFromDatabase();
  const actor = requireAdminActor(request, response);
  if (!actor) {
    return;
  }

  if (actor.role !== "admin") {
    sendJson(response, 403, { message: "Only admins can create verification links for users." });
    return;
  }

  const body = await readJsonBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const mobile = String(body.mobile || "").trim();
  const password = String(body.password || "");
  const forcedRole = normalizeInviteRole(body.role || "user");
  const username = normalizeUsername(body.username || email.split("@")[0] || name.replace(/\s+/g, "."));

  if (!isValidEmail(email)) {
    sendJson(response, 400, { message: "Enter a valid email ID." });
    return;
  }

  if (!isValidUsername(username)) {
    sendJson(response, 400, { message: "The generated username is not valid. Try a different email ID." });
    return;
  }

  if (name.length < 2) {
    sendJson(response, 400, { message: "Enter the user's name." });
    return;
  }

  if (!/^[0-9+\-\s()]{7,16}$/.test(mobile)) {
    sendJson(response, 400, { message: "Enter a valid phone number." });
    return;
  }

  if (password.length < 6) {
    sendJson(response, 400, { message: "Enter a temporary password with at least 6 characters." });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const verificationLink = `${getOrigin(request)}/index.html#admin-verify/${token}`;
  pendingAdminLinks.set(token, {
    email,
    username,
    name,
    mobile,
    password,
    forcedRole,
    createdBy: actor.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + REJOIN_TOKEN_TTL_MS,
  });
  await upsertPendingUserFromProfile(
    {
      email,
      username,
      name,
      mobile,
      password,
      forcedRole,
      ipAddress: getClientIp(request),
      userAgent: request.headers["user-agent"] || "Unknown device",
    },
    request,
  );

  sendJson(response, 200, {
    verificationLink,
    message: `${formatRoleName(forcedRole)} verification link created for ${email}.`,
  });
}

function handleAdminVerificationLookup(requestUrl, response) {
  cleanupExpiredTokens();
  const token = requestUrl.searchParams.get("token") || "";
  const profile = pendingAdminLinks.get(token);

  if (!profile) {
    sendJson(response, 404, { valid: false, message: "This admin-created verification link is invalid or expired." });
    return;
  }

  sendJson(response, 200, {
    valid: true,
    profile: {
      email: profile.email,
      username: profile.username,
      name: profile.name,
      mobile: profile.mobile,
      role: profile.forcedRole || "user",
    },
  });
}

async function handleApproveAdminVerification(request, response) {
  await refreshUsersFromDatabase();
  cleanupExpiredTokens();
  const body = await readJsonBody(request);
  const token = String(body.token || "");
  const profile = pendingAdminLinks.get(token);

  if (!profile) {
    sendJson(response, 404, { message: "This admin-created verification link is invalid or expired." });
    return;
  }

  pendingAdminLinks.delete(token);
  const user = await upsertUserFromProfile(profile, request);
  const sessionToken = createSession(user.email);

  sendJson(response, 200, {
    profile: {
      email: user.email,
      username: user.username,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      pro: user.pro,
    },
    sessionToken,
    user: toPublicUser(user),
  });
}

async function handleAdminUsers(request, response) {
  await refreshUsersFromDatabase();
  const actor = requireAdminActor(request, response);
  if (!actor) {
    return;
  }

  sendJson(response, 200, {
    actor: toPublicUser(actor),
    users: Object.values(usersStore.users)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toPublicUser),
    proPrice: PRO_PRICE,
  });
}

async function handleSessionLookup(request, response) {
  await refreshUsersFromDatabase();
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "This login session is no longer active." });
    return;
  }

  sendJson(response, 200, { user: toPublicUser(actor) });
}

async function handleAdminUserAction(request, response) {
  await refreshUsersFromDatabase();
  const actor = requireAdminActor(request, response);
  if (!actor) {
    return;
  }

  const body = await readJsonBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const action = String(body.action || "").trim();
  const target = usersStore.users[email];

  if (!target) {
    sendJson(response, 404, { message: "User registration was not found." });
    return;
  }

  const permissionError = getActionPermissionError({ actor, target, action });
  if (permissionError) {
    sendJson(response, 403, { message: permissionError });
    return;
  }

  if (action === "suspend") {
    let suspensionDays;
    try {
      suspensionDays = clampSuspensionDays(body.days);
    } catch (error) {
      sendJson(response, 400, { message: error.message });
      return;
    }
    target.status = "suspended";
    target.suspendedAt = Date.now();
    target.suspendedUntil = Date.now() + suspensionDays * 24 * 60 * 60 * 1000;
    target.suspensionDays = suspensionDays;
    target.updatedAt = Date.now();
    invalidateUserSessions(target.email);
    await persistUserRecord(target);
  } else if (action === "remove") {
    target.status = "removed";
    target.role = "user";
    target.pro = false;
    target.removedAt = Date.now();
    target.removedBy = actor.email;
    target.rejoinRequired = true;
    target.updatedAt = Date.now();
    invalidateUserSessions(target.email);
    await persistUserRecord(target);
  } else if (action === "make-pre-admin") {
    target.role = "pre-admin";
    target.status = "active";
    target.suspendedAt = null;
    target.suspendedUntil = null;
    target.suspensionDays = null;
    target.updatedAt = Date.now();
    await persistUserRecord(target);
  } else if (action === "make-admin") {
    target.role = "admin";
    target.status = "active";
    target.suspendedAt = null;
    target.suspendedUntil = null;
    target.suspensionDays = null;
    target.updatedAt = Date.now();
    await persistUserRecord(target);
  } else if (action === "give-free-pro") {
    target.pro = true;
    target.proGrantedAt = Date.now();
    target.proValueUsd = PRO_PRICE;
    target.updatedAt = Date.now();
    await persistUserRecord(target);
  } else if (action === "send-rejoin-link") {
    let result;
    try {
      result = await sendRejoinLink({ target, request });
    } catch (error) {
      sendJson(response, 503, { message: error.message });
      return;
    }
    target.lastRejoinLinkAt = Date.now();
    target.updatedAt = Date.now();
    await persistUserRecord(target);
    const updatedActor = usersStore.users[actor.email] || actor;
    sendJson(response, 200, {
      actor: toPublicUser(updatedActor),
      users: Object.values(usersStore.users)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(toPublicUser),
      proPrice: PRO_PRICE,
      rejoin: result,
    });
    return;
  } else {
    sendJson(response, 400, { message: "Unknown admin action." });
    return;
  }

  const updatedActor = usersStore.users[actor.email] || actor;
  sendJson(response, 200, {
    actor: toPublicUser(updatedActor),
    users: Object.values(usersStore.users)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toPublicUser),
    proPrice: PRO_PRICE,
  });
}

async function handleChatThreads(request, response) {
  await refreshUsersFromDatabase();
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "Please login before opening Chat." });
    return;
  }

  sendJson(response, 200, {
    threads: getChatThreadsForActor(actor),
  });
}

async function handleChatMessages(requestUrl, request, response) {
  await refreshUsersFromDatabase();
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "Please login before opening Chat." });
    return;
  }

  const threadUserEmail = resolveChatThreadUserEmail({
    actor,
    requestedEmail: requestUrl.searchParams.get("userEmail"),
  });
  if (!threadUserEmail) {
    sendJson(response, 400, { message: "Choose a user to chat with." });
    return;
  }

  sendJson(response, 200, {
    threadUserEmail,
    messages: getChatMessagesForThread(threadUserEmail),
    threads: getChatThreadsForActor(actor),
  });
}

async function handleSendChatMessage(request, response) {
  await refreshUsersFromDatabase();
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "Please login before sending chat messages." });
    return;
  }

  const body = await readJsonBody(request);
  const text = String(body.text || "").trim();
  const threadUserEmail = resolveChatThreadUserEmail({
    actor,
    requestedEmail: body.userEmail,
  });

  if (!threadUserEmail) {
    sendJson(response, 400, { message: "Choose a user to chat with." });
    return;
  }

  if (text.length < 1 || text.length > 1200) {
    sendJson(response, 400, { message: "Chat message must be between 1 and 1200 characters." });
    return;
  }

  const target = usersStore.users[threadUserEmail];
  if (!target) {
    sendJson(response, 404, { message: "This chat user was not found in the app database." });
    return;
  }

  const now = Date.now();
  usersStore.chatMessages.push({
    id: crypto.randomUUID(),
    threadUserEmail,
    fromEmail: actor.email,
    fromName: actor.name || actor.username || actor.email,
    fromRole: actor.role || "user",
    toEmail: isAdminLike(actor) ? threadUserEmail : "admins",
    text,
    createdAt: now,
  });
  saveUsersStore();

  sendJson(response, 200, {
    threadUserEmail,
    messages: getChatMessagesForThread(threadUserEmail),
    threads: getChatThreadsForActor(actor),
  });
}

function resolveChatThreadUserEmail({ actor, requestedEmail }) {
  if (!isAdminLike(actor)) {
    return actor.email;
  }

  const email = String(requestedEmail || "").trim().toLowerCase();
  if (!email || email === actor.email || !usersStore.users[email]) {
    return "";
  }

  return email;
}

function getChatMessagesForThread(threadUserEmail) {
  return usersStore.chatMessages
    .filter((message) => message.threadUserEmail === threadUserEmail)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(-100)
    .map(toPublicChatMessage);
}

function getChatThreadsForActor(actor) {
  const threadUsers = isAdminLike(actor)
    ? Object.values(usersStore.users).filter((user) => user.email !== actor.email)
    : [actor];

  return threadUsers
    .map((user) => {
      const latestMessage = usersStore.chatMessages
        .filter((message) => message.threadUserEmail === user.email)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

      return {
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        status: user.status,
        latestMessageAt: latestMessage?.createdAt || user.updatedAt || user.createdAt || 0,
        latestMessage: latestMessage?.text || "",
      };
    })
    .sort((a, b) => (b.latestMessageAt || 0) - (a.latestMessageAt || 0));
}

function toPublicChatMessage(message) {
  return {
    id: message.id,
    threadUserEmail: message.threadUserEmail,
    fromEmail: message.fromEmail,
    fromName: message.fromName,
    fromRole: message.fromRole,
    toEmail: message.toEmail,
    text: message.text,
    createdAt: message.createdAt,
  };
}

async function handleCreateAiModel(request, response) {
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "Please login before asking the AI agent to build a model." });
    return;
  }

  const body = await readJsonBody(request);
  const prompt = String(body.prompt || "").trim();
  if (prompt.length < 4) {
    sendJson(response, 400, { message: "Give the AI agent a clearer prompt first." });
    return;
  }

  const model = createPromptModel({ prompt, user: actor });
  let execution;
  try {
    execution = await createAgentChatReply({ prompt, user: actor, model, history: [] });
  } catch (error) {
    console.error("AI model execution failed:", error.message);
    execution = {
      provider: "local",
      reply: createLocalAgentReply({ prompt, user: actor, model }),
    };
  }

  model.execution = {
    provider: execution.provider,
    status: "completed",
    result: execution.reply,
    executedAt: Date.now(),
  };
  model.status = "executed";
  model.updatedAt = Date.now();

  aiModelsStore.models.push(model);
  await persistAiModelRecord(model);

  sendJson(response, 200, {
    message: `Executed and saved ${model.name}.`,
    model,
    provider: execution.provider,
  });
}

async function handleAgentChat(request, response) {
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "Please login before chatting with the AI agent." });
    return;
  }

  const body = await readJsonBody(request);
  const prompt = String(body.prompt || "").trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  if (prompt.length < 2) {
    sendJson(response, 400, { message: "Type a message for the AI chatbot first." });
    return;
  }

  let chat;
  try {
    chat = await createGeneralChatReply({ prompt, user: actor, history });
  } catch (error) {
    console.error("AI chat failed:", error.message);
    chat = {
      provider: "local",
      reply: createLocalGeneralChatReply({ prompt, user: actor }),
    };
  }

  sendJson(response, 200, {
    message: chat.reply,
    provider: chat.provider,
  });
}

async function upsertUserFromProfile(profile, request) {
  const email = profile.email.toLowerCase();
  const existing = usersStore.users[email];
  const now = Date.now();
  const role =
    profile.forcedRole ||
    getInitialRoleForProfile({ email, username: profile.username }, existing, request);

  const user = {
    id: existing?.id || crypto.randomUUID(),
    email,
    username: profile.username,
    name: profile.name,
    mobile: profile.mobile,
    role,
    status: "active",
    passwordHash: profile.password ? hashPassword(profile.password) : existing?.passwordHash || null,
    passwordUpdatedAt: profile.password ? now : existing?.passwordUpdatedAt || null,
    pro: Boolean(existing?.pro),
    proGrantedAt: existing?.proGrantedAt || null,
    proValueUsd: existing?.proValueUsd || null,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionDays: null,
    removedAt: null,
    removedBy: null,
    rejoinRequired: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastRegistrationAt: existing?.lastRegistrationAt || now,
    lastLoginAt: now,
    loginCount: (existing?.loginCount || 0) + 1,
    lastIpAddress: getClientIp(request) || profile.ipAddress || "Unknown network",
    lastDevice: request.headers["user-agent"] || profile.userAgent || "Unknown device",
  };

  usersStore.users[email] = user;
  await persistUserRecord(user);
  return user;
}

async function upsertPendingUserFromProfile(profile, request) {
  const email = profile.email.toLowerCase();
  const existing = usersStore.users[email];
  const now = Date.now();
  const role =
    profile.forcedRole ||
    existing?.role ||
    getInitialRoleForProfile({ email, username: profile.username }, existing, request);
  const status = existing?.status === "active" ? "active" : "pending";

  const user = {
    id: existing?.id || crypto.randomUUID(),
    email,
    username: profile.username,
    name: profile.name,
    mobile: profile.mobile,
    role,
    status,
    passwordHash: existing?.passwordHash || null,
    passwordUpdatedAt: existing?.passwordUpdatedAt || null,
    pro: Boolean(existing?.pro),
    proGrantedAt: existing?.proGrantedAt || null,
    proValueUsd: existing?.proValueUsd || null,
    suspendedAt: existing?.suspendedAt || null,
    suspendedUntil: existing?.suspendedUntil || null,
    suspensionDays: existing?.suspensionDays || null,
    removedAt: existing?.removedAt || null,
    removedBy: existing?.removedBy || null,
    rejoinRequired: Boolean(existing?.rejoinRequired),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastRegistrationAt: now,
    lastLoginAt: existing?.lastLoginAt || null,
    loginCount: existing?.loginCount || 0,
    lastIpAddress: getClientIp(request) || profile.ipAddress || "Unknown network",
    lastDevice: request.headers["user-agent"] || profile.userAgent || "Unknown device",
  };

  usersStore.users[email] = user;
  await persistUserRecord(user);
  return user;
}

function createSession(email) {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  activeSessions.set(sessionToken, {
    email,
    createdAt: Date.now(),
  });
  return sessionToken;
}

function getSessionActor(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const session = activeSessions.get(token);

  if (!session) {
    return null;
  }

  const user = usersStore.users[session.email];
  normalizeAccountStatus(user);
  if (!user || user.status === "suspended" || user.status === "removed") {
    activeSessions.delete(token);
    return null;
  }

  promoteUserForLaptopAdminRequest(user, request).catch((error) => {
    console.error("Could not promote laptop admin:", error.message);
  });

  return user;
}

function requireAdminActor(request, response) {
  const actor = getSessionActor(request);
  if (!actor) {
    sendJson(response, 401, { message: "Please login again before opening Admin." });
    return null;
  }

  if (!isAdminLike(actor)) {
    sendJson(response, 403, { message: "Only admins and pre-admins can open this tab." });
    return null;
  }

  return actor;
}

function getActionPermissionError({ actor, target, action }) {
  const actorIsAdmin = actor.role === "admin";
  const actorIsPreAdmin = actor.role === "pre-admin";

  if (!actorIsAdmin && !actorIsPreAdmin) {
    return "Only admins and pre-admins can manage users.";
  }

  if (target.email === actor.email && (action === "remove" || action === "suspend")) {
    return "You cannot remove or suspend your own account.";
  }

  if (target.role === "admin" && (action === "remove" || action === "suspend")) {
    return "Admin accounts cannot be removed or suspended from this tab.";
  }

  if (actorIsPreAdmin && target.role !== "user") {
    return "Pre-admins can only manage regular users. They cannot remove admins or pre-admins.";
  }

  if (action === "make-pre-admin" || action === "make-admin") {
    if (!actorIsAdmin) {
      return "Only admins can grant admin or pre-admin access.";
    }

    if (target.status === "removed") {
      return "Removed users must rejoin before roles can be changed.";
    }

    if (action === "make-pre-admin" && target.role !== "user") {
      return "Only regular users can be made pre-admin.";
    }

    if (action === "make-admin" && target.role === "admin") {
      return "This user is already an admin.";
    }

    return "";
  }

  if (action === "remove") {
    if (target.role === "pre-admin" && actorIsAdmin) {
      return "";
    }

    if (target.status === "removed") {
      return "This user is already removed from the app.";
    }

    return "";
  }

  if (action === "suspend") {
    if (target.status === "removed") {
      return "Removed users cannot be suspended.";
    }

    return "";
  }

  if (action === "give-free-pro") {
    if (target.status !== "active") {
      return "Only active users can receive a free Pro subscription.";
    }

    return "";
  }

  if (action === "send-rejoin-link") {
    if (target.status !== "removed") {
      return "Rejoin links are only for removed users.";
    }

    return "";
  }

  return "Unknown admin action.";
}

function isAdminLike(user) {
  return user.role === "admin" || user.role === "pre-admin";
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    pro: Boolean(user.pro),
    proGrantedAt: user.proGrantedAt,
    proValueUsd: user.proValueUsd,
    suspendedAt: user.suspendedAt,
    suspendedUntil: user.suspendedUntil,
    suspensionDays: user.suspensionDays,
    removedAt: user.removedAt,
    removedBy: user.removedBy,
    lastRejoinLinkAt: user.lastRejoinLinkAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastRegistrationAt: user.lastRegistrationAt,
    lastLoginAt: user.lastLoginAt,
    loginCount: user.loginCount,
    lastIpAddress: user.lastIpAddress,
    lastDevice: user.lastDevice,
  };
}

function invalidateUserSessions(email) {
  for (const [token, session] of activeSessions) {
    if (session.email === email) {
      activeSessions.delete(token);
    }
  }
}

async function serveStaticFile(requestUrl, request, response) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.normalize(path.join(ROOT_DIR, pathname));
  const isInsideRoot = filePath.startsWith(ROOT_DIR + path.sep);
  const fileName = path.basename(filePath);

  if (
    !isInsideRoot ||
    fileName.startsWith(".") ||
    fileName === "server.js" ||
    fileName === "package.json"
  ) {
    sendJson(response, 404, { message: "File not found." });
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { message: "File not found." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath).pipe(response);
}

async function sendVerificationEmail({ email, name, verificationLink }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const subject = "Confirm your Secure Entry login";
  const text = [
    `Hi ${name},`,
    "",
    "Click this one-time verification link to continue logging in to Secure Entry:",
    verificationLink,
    "",
    "This link expires in 15 minutes.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #182230; line-height: 1.5;">
      <h2>Confirm your Secure Entry login</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Click this one-time verification link to continue logging in to Secure Entry.</p>
      <p>
        <a href="${escapeHtml(verificationLink)}" style="display: inline-block; padding: 12px 18px; color: #ffffff; background: #1f7a5b; border-radius: 8px; text-decoration: none; font-weight: 700;">
          Confirm login
        </a>
      </p>
      <p>This link expires in 15 minutes.</p>
      <p style="color: #667085;">If the button does not work, copy and paste this link into your browser:<br>${escapeHtml(verificationLink)}</p>
    </div>
  `;

  await sendSmtpMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text,
    html,
  });
}

async function sendRejoinLink({ target, request }) {
  const token = crypto.randomBytes(32).toString("hex");
  const rejoinLink = `${getOrigin(request)}/index.html#rejoin/${token}`;
  pendingRejoins.set(token, {
    email: target.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + REJOIN_TOKEN_TTL_MS,
  });

  try {
    await sendRejoinEmail({
      email: target.email,
      name: target.name || target.username || "there",
      rejoinLink,
    });
    return {
      sent: true,
      message: `Rejoin link sent to ${target.email}.`,
    };
  } catch (error) {
    console.error("Rejoin email delivery failed:", error.message);
    if (process.env.ALLOW_DEV_EMAIL_PREVIEW === "1") {
      return {
        sent: false,
        previewLink: rejoinLink,
        message: "Rejoin email is in development preview mode.",
      };
    }

    pendingRejoins.delete(token);
    throw new Error("Could not send the rejoin link. Check SMTP settings.");
  }
}

async function sendRejoinEmail({ email, name, rejoinLink }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const subject = "Your Secure Entry rejoin link";
  const text = [
    `Hi ${name},`,
    "",
    "An admin or pre-admin has approved your return to Secure Entry.",
    "Use this one-time rejoin link to register again:",
    rejoinLink,
    "",
    "This link expires in 7 days.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; color: #182230; line-height: 1.5;">
      <h2>Return to Secure Entry</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>An admin or pre-admin has approved your return. Use this one-time rejoin link to register again.</p>
      <p>
        <a href="${escapeHtml(rejoinLink)}" style="display: inline-block; padding: 12px 18px; color: #ffffff; background: #1f7a5b; border-radius: 8px; text-decoration: none; font-weight: 700;">
          Rejoin Secure Entry
        </a>
      </p>
      <p>This link expires in 7 days.</p>
    </div>
  `;

  await sendSmtpMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text,
    html,
  });
}

async function sendSmtpMail({ from, to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const shouldStartTls = !secure && process.env.SMTP_STARTTLS !== "false";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";

  let socket = await connectSocket({ host, port, secure });
  let reader = createSmtpReader(socket);

  try {
    await expectResponse(reader, [220]);
    await sendSmtpCommand(socket, reader, `EHLO ${getLocalHostName()}`, [250]);

    if (shouldStartTls) {
      await sendSmtpCommand(socket, reader, "STARTTLS", [220]);
      reader.dispose();
      socket = await upgradeToTls(socket, host);
      reader = createSmtpReader(socket);
      await sendSmtpCommand(socket, reader, `EHLO ${getLocalHostName()}`, [250]);
    }

    if (user || pass) {
      if (!user || !pass) {
        throw new Error("SMTP user and password must both be set.");
      }

      await sendSmtpCommand(socket, reader, "AUTH LOGIN", [334]);
      await sendSmtpCommand(socket, reader, Buffer.from(user).toString("base64"), [334]);
      await sendSmtpCommand(socket, reader, Buffer.from(pass).toString("base64"), [235]);
    }

    await sendSmtpCommand(socket, reader, `MAIL FROM:<${extractEmailAddress(from)}>`, [250]);
    await sendSmtpCommand(socket, reader, `RCPT TO:<${to}>`, [250, 251]);
    await sendSmtpCommand(socket, reader, "DATA", [354]);
    socket.write(`${buildMimeMessage({ from, to, subject, text, html })}\r\n.\r\n`);
    await expectResponse(reader, [250]);
    await sendSmtpCommand(socket, reader, "QUIT", [221]);
  } finally {
    reader.dispose();
    socket.end();
  }
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `secure-entry-${crypto.randomBytes(8).toString("hex")}`;
  const safeText = dotStuff(text);
  const safeHtml = dotStuff(html);

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    safeText,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    safeHtml,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

function connectSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    socket.setEncoding("utf8");
    socket.once(secure ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host });
    secureSocket.setEncoding("utf8");
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

function createSmtpReader(socket) {
  let textBuffer = "";
  const lineQueue = [];
  const waiters = [];

  const onData = (chunk) => {
    textBuffer += String(chunk);

    let lineEnd = textBuffer.indexOf("\n");
    while (lineEnd !== -1) {
      const line = textBuffer.slice(0, lineEnd).replace(/\r$/, "");
      textBuffer = textBuffer.slice(lineEnd + 1);
      lineQueue.push(line);
      lineEnd = textBuffer.indexOf("\n");
    }

    flush();
  };

  const onError = (error) => {
    while (waiters.length) {
      waiters.shift().reject(error);
    }
  };

  socket.on("data", onData);
  socket.on("error", onError);

  return {
    readResponse() {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject, lines: [] });
        flush();
      });
    },
    dispose() {
      socket.off("data", onData);
      socket.off("error", onError);
    },
  };

  function flush() {
    if (!waiters.length) {
      return;
    }

    const waiter = waiters[0];
    while (lineQueue.length) {
      const line = lineQueue.shift();
      waiter.lines.push(line);

      if (/^\d{3}( |$)/.test(line)) {
        waiters.shift();
        waiter.resolve({
          code: Number(line.slice(0, 3)),
          message: waiter.lines.join("\n"),
        });
        flush();
        return;
      }
    }
  }
}

async function sendSmtpCommand(socket, reader, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  return expectResponse(reader, expectedCodes);
}

async function expectResponse(reader, expectedCodes) {
  const response = await reader.readResponse();
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP ${response.code}: ${response.message}`);
  }

  return response;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function loadUsersStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { users: {}, chatMessages: [] };
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
      chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
    };
  } catch (error) {
    console.error("Could not read user registry:", error.message);
    return { users: {}, chatMessages: [] };
  }
}

function saveUsersStore() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(usersStore, null, 2)}\n`);
}

async function refreshUsersFromDatabase() {
  if (!firebaseConfig.enabled) {
    Object.values(usersStore.users).forEach(normalizeAccountStatus);
    return;
  }

  try {
    const users = await firebaseListDocuments("users");
    usersStore.users = Object.fromEntries(users.map((user) => [user.email, user]));
    Object.values(usersStore.users).forEach(normalizeAccountStatus);
  } catch (error) {
    console.error("Firebase user refresh failed:", error.message);
  }
}

async function persistUserRecord(user) {
  usersStore.users[user.email] = user;
  saveUsersStore();

  if (!firebaseConfig.enabled) {
    return;
  }

  try {
    await firebaseSetDocument("users", user.email, user);
  } catch (error) {
    console.error("Firebase user save failed:", error.message);
  }
}

async function deleteUserRecord(email) {
  delete usersStore.users[email];
  saveUsersStore();

  if (!firebaseConfig.enabled) {
    return;
  }

  try {
    await firebaseDeleteDocument("users", email);
  } catch (error) {
    console.error("Firebase user delete failed:", error.message);
  }
}

async function persistAiModelRecord(model) {
  if (!firebaseConfig.enabled) {
    return;
  }

  try {
    await firebaseSetDocument("aiModels", model.id, model);
  } catch (error) {
    console.error("Firebase AI model save failed:", error.message);
  }
}

function createPromptModel({ prompt, user }) {
  const now = Date.now();
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6);
  const topic = words.length ? titleCase(words.join(" ")) : "Custom Assistant";
  const id = crypto.randomUUID();

  return {
    id,
    ownerEmail: user.email,
    name: `${topic} Model`,
    prompt,
    objective: `Execute this user request: ${prompt}`,
    inputs: ["user prompt", "current account context", "saved registration details"],
    outputs: ["step-by-step result", "action summary", "next recommended action"],
    capabilities: inferModelCapabilities(prompt),
    workflow: [
      "Understand the prompt and extract the requested goal.",
      "Check the current user context and permissions.",
      "Execute the safe app action or create a structured plan.",
      "Return a concise result and save this model blueprint.",
    ],
    safetyRules: [
      "Do not expose passwords or private tokens.",
      "Ask for admin approval before destructive account actions.",
      "Use shared records only through server-side permission checks.",
    ],
    status: "created",
    createdAt: now,
    updatedAt: now,
  };
}

async function createAgentChatReply({ prompt, user, model, history }) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "local",
      reply: createLocalAgentReply({ prompt, user, model }),
    };
  }

  const reply = await createOpenAiAgentReply({ prompt, user, model, history });
  return {
    provider: "openai",
    reply,
  };
}

async function createGeneralChatReply({ prompt, user, history }) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "local",
      reply: createLocalGeneralChatReply({ prompt, user }),
    };
  }

  const reply = await createOpenAiGeneralChatReply({ prompt, user, history });
  return {
    provider: "openai",
    reply,
  };
}

async function createOpenAiAgentReply({ prompt, user, model, history }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions:
        "You are Secure Entry's AI chatbot. Answer like a helpful assistant, execute the user's prompt as far as this app safely can, and explain the saved AI model blueprint in plain language. Never reveal secrets, passwords, tokens, or private keys.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Current user: ${user.name} (${user.email}), role ${user.role}.`,
                `Saved model name: ${model.name}.`,
                `Saved model capabilities: ${model.capabilities.join(", ")}.`,
                "Recent chat:",
                history
                  .map((item) => `${item.role || "user"}: ${String(item.text || "").slice(0, 500)}`)
                  .join("\n"),
                "User prompt:",
                prompt,
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 700,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI chat request failed.");
  }

  return extractOpenAiText(data) || createLocalAgentReply({ prompt, user, model });
}

async function createOpenAiGeneralChatReply({ prompt, user, history }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions:
        "You are Secure Entry's general AI chat box. Answer questions on any topic in plain language. Use the user's account context only when the question is about this app. Do not reveal secrets, passwords, private keys, or tokens.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Current user: ${user.name} (${user.email}), role ${user.role}.`,
                "Recent chat:",
                history
                  .map((item) => `${item.role || "user"}: ${String(item.text || "").slice(0, 500)}`)
                  .join("\n"),
                "Question:",
                prompt,
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 700,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI chat request failed.");
  }

  return extractOpenAiText(data) || createLocalGeneralChatReply({ prompt, user });
}

function extractOpenAiText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      } else if (content.text?.value) {
        parts.push(content.text.value);
      }
    }
  }

  return parts.join("\n").trim();
}

function createLocalAgentReply({ prompt, user, model }) {
  const capabilities = model.capabilities.join(", ");
  return [
    `I executed your prompt for ${user.name || "this account"} and saved it as ${model.name}.`,
    `Goal: ${model.objective}`,
    `What I can do with this model: ${capabilities}.`,
    `Result: ${getLocalExecutionSummary(prompt)}`,
  ].join("\n\n");
}

function createLocalGeneralChatReply({ prompt, user }) {
  const originalPrompt = String(prompt || "").trim();
  const text = originalPrompt.toLowerCase();
  const firstName = (user.name || "").split(" ")[0] || "there";

  if (text.includes("hello") || text.includes("hi ") || text === "hi") {
    return `Hi ${firstName}. Ask me anything, or ask me to help with this app, study notes, writing, coding, planning, or account questions.`;
  }

  if (text.includes("account") || text.includes("profile")) {
    return `Here is the profile I can see: ${user.name}, email ${user.email}, role ${user.role}.`;
  }

  if (text.includes("login") || text.includes("verify")) {
    return "This app uses a login flow with email ID, password, profile details, and a confirmation step before entering the app.";
  }

  if (text.includes("security") || text.includes("safe") || text.includes("password")) {
    return "Use a strong password, keep verification links short-lived, avoid sharing admin access, and store private keys only on the server.";
  }

  if (text.includes("welcome") || text.includes("message")) {
    return `Welcome ${firstName}, your Secure Entry account is active and ready to use.`;
  }

  const mathReply = getSimpleServerMathReply(originalPrompt);
  if (mathReply) {
    return mathReply;
  }

  return createHelpfulServerLocalReply(originalPrompt, firstName);
}

function getSimpleServerMathReply(prompt) {
  const expression = String(prompt || "")
    .toLowerCase()
    .replace(/\b(what is|calculate|solve|answer|please|equals)\b/g, "")
    .replace(/[?=]/g, "")
    .trim();

  if (!/^[0-9+\-*/().\s]+$/.test(expression) || !/\d\s*[+\-*/]\s*\d/.test(expression)) {
    return "";
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(result) ? `${expression} = ${result}.` : "";
  } catch {
    return "";
  }
}

function createHelpfulServerLocalReply(prompt, firstName) {
  const text = prompt.toLowerCase();

  if (text.includes("ai") || text.includes("artificial intelligence")) {
    return "AI means artificial intelligence. It is software that can understand patterns, answer questions, write text, classify information, and help automate tasks.";
  }

  if (text.includes("html") || text.includes("css") || text.includes("javascript") || text.includes("coding")) {
    return "For coding questions, break the problem into three parts: what should appear on screen, what data must be saved, and what should happen after a click. Then build the HTML, style it with CSS, and add the behavior with JavaScript.";
  }

  if (text.includes("database") || text.includes("firebase")) {
    return "The app can use its built-in shared server to store records in one place. That is what lets Admin see users who log in from different phones, laptops, desktops, tabs, or Wi-Fi networks without Firebase.";
  }

  if (text.includes("admin") || text.includes("pre-admin")) {
    return "Admins can manage users, roles, suspensions, removals, and Pro access. Pre-admins can help manage normal users, but they should not be able to remove admins or change admin-only roles.";
  }

  if (text.includes("study") || text.includes("exam") || text.includes("learn")) {
    return "A good study plan is: read the topic once, write short notes, practice questions, then revise the mistakes. Study in small sessions and test yourself instead of only rereading.";
  }

  if (text.includes("write") || text.includes("letter") || text.includes("essay")) {
    return "I can help write it. A clear structure is: start with the main point, add two or three supporting details, and end with the action or conclusion you want.";
  }

  if (text.includes("plan") || text.includes("idea")) {
    return "A simple plan is: decide the goal, list the steps, choose the first small action, then improve after testing. Good apps usually start with one useful workflow and grow from there.";
  }

  return `I can help with that, ${firstName}. A simple way to answer "${prompt}" is to break it into: what it means, why it matters, and one example. Ask me to explain it simply, make notes, draft text, or turn it into steps.`;
}

function getLocalExecutionSummary(prompt) {
  const text = prompt.toLowerCase();
  if (text.includes("admin") || text.includes("user")) {
    return "I prepared an account-aware workflow that checks role permissions before changing user records.";
  }

  if (text.includes("login") || text.includes("verify")) {
    return "I prepared a login workflow that confirms the current session and records registration details for admin review.";
  }

  if (text.includes("subscription") || text.includes("pro")) {
    return "I prepared a Pro subscription workflow that can mark eligible active users for faster access.";
  }

  return "I converted the prompt into a reusable model blueprint with inputs, outputs, workflow steps, and safety rules.";
}

function inferModelCapabilities(prompt) {
  const text = prompt.toLowerCase();
  const capabilities = ["prompt execution", "task planning", "saved model blueprint"];

  if (text.includes("admin") || text.includes("user") || text.includes("account")) {
    capabilities.push("account-aware actions");
  }

  if (text.includes("email") || text.includes("verify") || text.includes("login")) {
    capabilities.push("login and verification guidance");
  }

  if (text.includes("fast") || text.includes("pro") || text.includes("subscription")) {
    capabilities.push("subscription-aware workflow");
  }

  return capabilities;
}

function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

async function promoteUserForLaptopAdminRequest(user, request) {
  if (!isLaptopAdminRequest(request) || !user || user.role === "admin") {
    return user;
  }

  user.role = "admin";
  user.status = "active";
  user.suspendedAt = null;
  user.suspendedUntil = null;
  user.suspensionDays = null;
  user.updatedAt = Date.now();
  await persistUserRecord(user);
  return user;
}

function isLaptopAdminRequest(request) {
  return request?.headers?.[LAPTOP_ADMIN_HEADER] === "1";
}

function getInitialRoleForProfile({ email, username }, existing, request) {
  if (isLaptopAdminRequest(request)) {
    return "admin";
  }

  if (
    getConfiguredAdminEmails().includes(email) ||
    getConfiguredAdminUsernames().includes(normalizeUsername(username))
  ) {
    return "admin";
  }

  if (existing?.role && existing.status !== "removed") {
    return existing.role;
  }

  const hasAdmin = Object.values(usersStore.users).some(
    (user) => user.role === "admin" && user.status !== "removed",
  );
  return hasAdmin ? "user" : "admin";
}

function getConfiguredAdminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getConfiguredAdminUsernames() {
  const configured = String(process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map(normalizeUsername)
    .filter(Boolean);
  return [...new Set(["avaneesh", ...configured])];
}

function normalizeAccountStatus(user) {
  if (!user || user.status !== "suspended" || !user.suspendedUntil) {
    return;
  }

  if (Number(user.suspendedUntil) <= Date.now()) {
    user.status = "active";
    user.suspendedAt = null;
    user.suspendedUntil = null;
    user.suspensionDays = null;
    user.updatedAt = Date.now();
    persistUserRecord(user).catch((error) => {
      console.error("Could not persist restored suspension status:", error.message);
    });
  }
}

function clampSuspensionDays(days) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) {
    throw new Error("Suspension length must be between 3 and 7 days.");
  }

  return Math.min(7, Math.max(3, Math.round(parsed)));
}

function isValidRejoinForEmail({ token, email }) {
  cleanupExpiredTokens();
  const rejoin = pendingRejoins.get(token);
  return Boolean(rejoin && rejoin.email === email);
}

function normalizeUsername(value) {
  return String(value).trim().replace(/^@/, "").toLowerCase();
}

function isValidUsername(username) {
  return /^[a-z0-9._-]{3,24}$/.test(username);
}

function normalizeInviteRole(role) {
  const value = String(role || "user").trim().toLowerCase();
  return ["user", "pre-admin", "admin"].includes(value) ? value : "user";
}

function formatRoleName(role) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "pre-admin") {
    return "Pre-admin";
  }

  return "User";
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const iterations = 120000;
  const hash = crypto
    .pbkdf2Sync(password, salt, iterations, 32, "sha256")
    .toString("base64url");
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, iterationsValue, salt, expectedHash] = String(storedHash || "").split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsValue || !salt || !expectedHash) {
    return false;
  }

  const actual = crypto
    .pbkdf2Sync(password, salt, Number(iterationsValue), 32, "sha256")
    .toString("base64url");
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expectedHash);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function formatServerDate(timestamp) {
  if (!timestamp) {
    return "the selected date";
  }

  return new Date(timestamp).toLocaleString();
}

function getFirebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");

  return {
    enabled: Boolean(projectId && clientEmail && privateKey),
    projectId,
    clientEmail,
    privateKey,
    databaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
  };
}

async function firebaseListDocuments(collection) {
  const token = await getFirebaseAccessToken();
  const url = firebaseCollectionUrl(collection);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Could not list Firebase documents.");
  }

  return (data.documents || []).map((document) => firestoreFieldsToObject(document.fields || {}));
}

async function firebaseSetDocument(collection, documentId, value) {
  const token = await getFirebaseAccessToken();
  const url = `${firebaseCollectionUrl(collection)}/${encodeURIComponent(documentId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: objectToFirestoreFields(value) }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Could not save Firebase document.");
  }
}

async function firebaseDeleteDocument(collection, documentId) {
  const token = await getFirebaseAccessToken();
  const url = `${firebaseCollectionUrl(collection)}/${encodeURIComponent(documentId)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || "Could not delete Firebase document.");
  }
}

function firebaseCollectionUrl(collection) {
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${encodeURIComponent(firebaseConfig.databaseId)}/documents/${collection}`;
}

async function getFirebaseAccessToken() {
  if (firebaseTokenCache && firebaseTokenCache.expiresAt > Date.now() + 60_000) {
    return firebaseTokenCache.token;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: firebaseConfig.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const unsignedJwt = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedJwt)
    .sign(firebaseConfig.privateKey, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Could not authenticate Firebase.");
  }

  firebaseTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return firebaseTokenCache.token;
}

function objectToFirestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, toFirestoreValue(item)]),
  );
}

function toFirestoreValue(value) {
  if (value === null) {
    return { nullValue: null };
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }

  if (typeof value === "object") {
    return { mapValue: { fields: objectToFirestoreFields(value) } };
  }

  return { stringValue: String(value) };
}

function firestoreFieldsToObject(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]),
  );
}

function fromFirestoreValue(value) {
  if ("nullValue" in value) {
    return null;
  }

  if ("booleanValue" in value) {
    return value.booleanValue;
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  if ("doubleValue" in value) {
    return value.doubleValue;
  }

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }

  if ("mapValue" in value) {
    return firestoreFieldsToObject(value.mapValue.fields || {});
  }

  return value.stringValue || "";
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizePrivateKey(value) {
  return String(value).replace(/\\n/g, "\n");
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, profile] of pendingVerifications) {
    if (profile.expiresAt <= now) {
      pendingVerifications.delete(token);
    }
  }

  for (const [token, rejoin] of pendingRejoins) {
    if (rejoin.expiresAt <= now) {
      pendingRejoins.delete(token);
    }
  }

  for (const [token, profile] of pendingAdminLinks) {
    if (profile.expiresAt <= now) {
      pendingAdminLinks.delete(token);
    }
  }
}

function getOrigin(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = getShareableHost(request.headers.host || `localhost:${PORT}`);
  return `${protocol}://${host}`;
}

function getShareableHost(hostHeader) {
  const { hostname, port } = splitHostHeader(hostHeader);
  const address = isLoopbackHostname(hostname) ? getPrimaryLanAddress() : hostname;
  const resolvedHost = address || hostname || "localhost";
  const resolvedPort = port || String(PORT);

  if (resolvedHost.includes(":") && !resolvedHost.startsWith("[")) {
    return `[${resolvedHost}]:${resolvedPort}`;
  }

  return `${resolvedHost}:${resolvedPort}`;
}

function splitHostHeader(hostHeader) {
  const cleanHost = String(hostHeader || "").split(",")[0].trim();

  if (cleanHost.startsWith("[")) {
    const closingBracketIndex = cleanHost.indexOf("]");
    return {
      hostname: cleanHost.slice(1, closingBracketIndex),
      port: cleanHost.slice(closingBracketIndex + 2) || "",
    };
  }

  const [hostname, port] = cleanHost.split(":");
  return {
    hostname: hostname || "localhost",
    port: port || "",
  };
}

function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(
    String(hostname || "").toLowerCase(),
  );
}

function getPrimaryLanAddress() {
  return getLanAddresses()[0] || "";
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}

function getServerAccessUrls() {
  const urls = new Set([`http://localhost:${PORT}/`]);
  getLanAddresses().forEach((address) => {
    urls.add(`http://${address}:${PORT}/`);
  });
  return [...urls];
}

function getClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (forwardedFor) {
    return String(forwardedFor).split(",")[0].trim();
  }

  return request.socket.remoteAddress || "Unknown network";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractEmailAddress(value) {
  const match = String(value).match(/<([^>]+)>/);
  return match ? match[1] : String(value).trim();
}

function dotStuff(value) {
  return String(value).replace(/^\./gm, "..");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getLocalHostName() {
  return process.env.SMTP_EHLO_DOMAIN || "localhost";
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
