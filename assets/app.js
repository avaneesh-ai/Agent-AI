const root = document.querySelector("#screen-root");
const progressDots = [...document.querySelectorAll(".step-dot")];
const themeToggle = document.querySelector("#theme-toggle");
const THEME_STORAGE_KEY = "secure-entry-theme";
const LOCAL_USERS_STORAGE_KEY = "secure-entry-local-users";
const LOCAL_DEVICE_ADMIN_STORAGE_KEY = "secure-entry-this-laptop-admin";
const LOCAL_DEVICE_ADMIN_HASH = "this-laptop-admin";
const LOCAL_ADMIN_USERNAMES = ["avaneesh"];
let sessionValidationInFlight = false;
let deferredInstallPrompt = null;
let installMessage = "";

const state = {
  email: "",
  username: "",
  name: "",
  mobile: "",
  token: "",
  verified: false,
  agentMessages: [],
  deliveryStatus: "",
  deliveryMessage: "",
  verificationLink: "",
  sessionToken: "",
  role: "",
  status: "",
  pro: false,
  activeAppTab: "account",
  adminUsers: [],
  adminActor: null,
  adminStatus: "idle",
  adminMessage: "",
  adminPreviewLink: "",
  aiModels: [],
  latestAiModel: null,
  rejoinToken: "",
  rejoinMessage: "",
};

const storedSession = sessionStorage.getItem("secure-entry-session");
if (storedSession) {
  Object.assign(state, JSON.parse(storedSession));
}

function saveSession() {
  sessionStorage.setItem("secure-entry-session", JSON.stringify(state));
}

function clearSession() {
  sessionStorage.removeItem("secure-entry-session");
  Object.assign(state, {
    email: "",
    username: "",
    name: "",
    mobile: "",
    token: "",
    verified: false,
    agentMessages: [],
    deliveryStatus: "",
    deliveryMessage: "",
    verificationLink: "",
    sessionToken: "",
    role: "",
    status: "",
    pro: false,
    activeAppTab: "account",
    adminUsers: [],
    adminActor: null,
    adminStatus: "idle",
    adminMessage: "",
    adminPreviewLink: "",
    aiModels: [],
    latestAiModel: null,
    rejoinToken: "",
    rejoinMessage: "",
  });
}

function getRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === LOCAL_DEVICE_ADMIN_HASH) {
    return { name: "device-admin-setup" };
  }

  if (hash.startsWith("verify/")) {
    return { name: "confirm", token: hash.split("/")[1] };
  }

  if (hash.startsWith("rejoin/")) {
    return { name: "rejoin", token: hash.split("/")[1] };
  }

  return { name: hash || "credentials" };
}

function goTo(route) {
  window.location.hash = route;
}

function getInitialTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  if (!themeToggle) {
    return;
  }

  themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
  themeToggle.setAttribute("title", theme === "dark" ? "Light mode" : "Dark mode");
}

function setupThemeToggle() {
  if (!themeToggle) {
    return;
  }

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });
}

function render() {
  const route = getRoute();
  updateProgress(route.name);

  if (state.verified && route.name !== "app" && route.name !== "rejoin") {
    goTo("app");
    return;
  }

  if (route.name === "profile") {
    renderProfileScreen();
    return;
  }

  if (route.name === "device-admin-setup") {
    renderDeviceAdminSetupScreen();
    return;
  }

  if (route.name === "sent") {
    renderSentScreen();
    return;
  }

  if (route.name === "confirm") {
    renderConfirmScreen(route.token);
    return;
  }

  if (route.name === "rejoin") {
    renderRejoinScreen(route.token);
    return;
  }

  if (route.name === "app") {
    renderAppScreen();
    return;
  }

  renderCredentialsScreen();
}

function updateProgress(routeName) {
  const activeStep = {
    credentials: 0,
    profile: 1,
    sent: 2,
    confirm: 2,
    app: 2,
  }[routeName] ?? 0;

  progressDots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === activeStep);
    dot.classList.toggle("is-done", index < activeStep || state.verified);
  });
}

function renderCredentialsScreen() {
  const rejoinNotice = state.rejoinToken
    ? `<div class="notice">
        <strong>Rejoin approved</strong>
        <span>${escapeHtml(state.rejoinMessage || "Complete login with this registered email ID to return to the app.")}</span>
      </div>`
    : "";

  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Step 1</p>
      <h1>Start with your login details</h1>
      <p class="screen-copy">Enter your email ID and password first. After this, the app will ask for your personal details.</p>
      ${rejoinNotice}

      <form class="form-stack" id="credentials-form" novalidate>
        <div class="field">
          <label for="email">Email ID</label>
          <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeHtml(state.email)}" required />
          <p class="error" id="email-error"></p>
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required minlength="6" />
          <p class="error" id="password-error"></p>
        </div>

        <div class="actions">
          <button class="button" type="submit">Next</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector("#credentials-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));

    const emailError = document.querySelector("#email-error");
    const passwordError = document.querySelector("#password-error");
    emailError.textContent = "";
    passwordError.textContent = "";

    let hasError = false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError.textContent = "Please enter a valid email ID.";
      hasError = true;
    }

    if (password.length < 6) {
      passwordError.textContent = "Password must be at least 6 characters.";
      hasError = true;
    }

    if (hasError) {
      return;
    }

    if (state.email !== email) {
      state.username = "";
      state.name = "";
      state.mobile = "";
      state.token = "";
      state.agentMessages = [];
      state.deliveryStatus = "";
      state.deliveryMessage = "";
      state.verificationLink = "";
      state.sessionToken = "";
      state.role = "";
      state.status = "";
      state.pro = false;
      state.activeAppTab = "account";
      state.adminUsers = [];
      state.adminActor = null;
      state.adminStatus = "idle";
      state.adminMessage = "";
      state.adminPreviewLink = "";
      state.aiModels = [];
      state.latestAiModel = null;
      state.rejoinToken = "";
      state.rejoinMessage = "";
    }

    state.email = email;
    state.verified = false;
    saveSession();
    goTo("profile");
  });
}

function renderProfileScreen() {
  if (!state.email) {
    goTo("credentials");
    return;
  }

  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Step 2</p>
      <h1>Add your profile details</h1>
      <p class="screen-copy">Fill in your username, name, and mobile number. When you click next, the app will create a verification link for this login.</p>

      <form class="form-stack" id="profile-form" novalidate>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" placeholder="your_username" value="${escapeHtml(state.username)}" required />
          <p class="error" id="username-error"></p>
        </div>

        <div class="field">
          <label for="name">Name</label>
          <input id="name" name="name" type="text" autocomplete="name" placeholder="Your full name" value="${escapeHtml(state.name)}" required />
          <p class="error" id="name-error"></p>
        </div>

        <div class="field">
          <label for="mobile">Mobile number</label>
          <input id="mobile" name="mobile" type="tel" autocomplete="tel" inputmode="tel" placeholder="10 digit mobile number" value="${escapeHtml(state.mobile)}" required />
          <p class="error" id="mobile-error"></p>
        </div>

        <div class="actions">
          <button class="button secondary" type="button" id="back-to-email">Back</button>
          <button class="button" type="submit" id="send-link-button">Next</button>
        </div>
        <p class="error" id="delivery-error"></p>
      </form>
    </section>
  `;

  document.querySelector("#back-to-email").addEventListener("click", () => goTo("credentials"));

  document.querySelector("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = normalizeUsername(form.get("username"));
    const name = String(form.get("name")).trim();
    const mobile = String(form.get("mobile")).trim();

    const usernameError = document.querySelector("#username-error");
    const nameError = document.querySelector("#name-error");
    const mobileError = document.querySelector("#mobile-error");
    const deliveryError = document.querySelector("#delivery-error");
    const submitButton = document.querySelector("#send-link-button");
    usernameError.textContent = "";
    nameError.textContent = "";
    mobileError.textContent = "";
    deliveryError.textContent = "";

    let hasError = false;
    if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
      usernameError.textContent = "Use 3 to 24 letters, numbers, dots, underscores, or hyphens.";
      hasError = true;
    }

    if (name.length < 2) {
      nameError.textContent = "Please enter your name.";
      hasError = true;
    }

    if (!/^[0-9+\-\s()]{7,16}$/.test(mobile)) {
      mobileError.textContent = "Please enter a valid mobile number.";
      hasError = true;
    }

    if (hasError) {
      return;
    }

    state.username = username;
    state.name = name;
    state.mobile = mobile;
    state.token = "";
    state.verified = false;
    state.agentMessages = [];
    state.deliveryStatus = "";
    state.deliveryMessage = "";
    state.verificationLink = "";
    state.sessionToken = "";
    state.role = "";
    state.status = "";
    state.pro = false;
    state.activeAppTab = "account";
    state.adminUsers = [];
    state.adminActor = null;
    state.adminStatus = "idle";
    state.adminMessage = "";
    state.adminPreviewLink = "";
    state.aiModels = [];
    state.latestAiModel = null;
    saveSession();

    submitButton.disabled = true;
    submitButton.textContent = "Creating link...";

    try {
      await requestVerificationEmail();
      goTo("sent");
    } catch (error) {
      deliveryError.textContent = error.message;
      submitButton.disabled = false;
      submitButton.textContent = "Next";
    }
  });
}

function renderDeviceAdminSetupScreen() {
  markThisLaptopAsAdminDevice();

  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Laptop admin</p>
      <h1>This laptop is marked for Admin access</h1>
      <p class="screen-copy">Anyone who logs in from this browser on this laptop will see the Admin tab. Other laptops will not get this marker automatically.</p>

      <div class="notice">
        <strong>Admin marker saved</strong>
        <span>The setting is stored only in this browser on this laptop.</span>
      </div>

      <div class="actions">
        <button class="button warning" type="button" id="continue-login">Continue to login</button>
      </div>
    </section>
  `;

  document.querySelector("#continue-login").addEventListener("click", () => {
    if (state.verified) {
      goTo("app");
      return;
    }

    goTo("credentials");
  });
}

function renderSentScreen() {
  if (!state.email || !state.deliveryStatus) {
    goTo("credentials");
    return;
  }

  const isPreview = state.deliveryStatus === "preview" && state.verificationLink;

  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Step 3</p>
      <h1>Open your verification link</h1>
      <p class="screen-copy">Your verification link is ready for ${escapeHtml(state.email)}. It has not been sent by email.</p>

      <div class="notice ${isPreview ? "warning-notice" : ""}">
        <strong>Verification link ready</strong>
        <span>${escapeHtml(state.deliveryMessage || "Open the verification email and click the login link to continue.")}</span>
      </div>

      ${
        isPreview
          ? `<div class="email-preview">
              <div class="email-preview-header">
                <span>To: ${escapeHtml(state.email)}</span>
                <span>Local login confirmation link</span>
              </div>
              <a class="link-box" href="${escapeHtml(state.verificationLink)}">${escapeHtml(state.verificationLink)}</a>
            </div>`
          : ""
      }

      <p class="screen-footer-note">Only the latest verification link can be used to enter the app.</p>
      <p class="error" id="resend-error"></p>

      <div class="actions">
        <button class="button secondary" type="button" id="edit-profile">Edit details</button>
        <button class="button" type="button" id="resend-link">Create link again</button>
        ${isPreview ? `<a class="button warning" href="${escapeHtml(state.verificationLink)}">Open verification link</a>` : ""}
      </div>
    </section>
  `;

  document.querySelector("#edit-profile").addEventListener("click", () => goTo("profile"));
  document.querySelector("#resend-link").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const resendError = document.querySelector("#resend-error");
    resendError.textContent = "";
    button.disabled = true;
    button.textContent = "Creating...";

    try {
      await requestVerificationEmail();
      renderSentScreen();
    } catch (error) {
      resendError.textContent = error.message;
      button.disabled = false;
      button.textContent = "Create link again";
    }
  });
}

async function renderConfirmScreen(token) {
  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Confirm</p>
      <h1>Checking your login link</h1>
      <p class="screen-copy">Please wait while the app confirms that this link is valid.</p>

      <div class="confirm-card">
        <h2>Verifying link</h2>
        <p>The app is checking this token with the server.</p>
      </div>
    </section>
  `;

  const verification = await resolveVerificationToken(token);
  const isValidToken = verification.valid;
  const profile = verification.profile || {};
  const email = profile.email || state.email;

  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Confirm</p>
      <h1>${isValidToken ? "Do you want to login to this app?" : "This login link is not valid"}</h1>
      <p class="screen-copy">
        ${
          isValidToken
            ? `The login link was created for ${escapeHtml(email)}. Click okay to enter the app.`
            : "Please start again so the app can create a fresh login link."
        }
      </p>

      <div class="confirm-card">
        <h2>${isValidToken ? "Ready to continue" : "Link expired"}</h2>
        <p>${
          isValidToken
            ? "This approval completes the login flow."
            : "For safety, only the latest generated link can be used."
        }</p>
      </div>

      <div class="actions">
        ${
          isValidToken
            ? `<button class="button warning" type="button" id="approve-login">Okay</button>
               <button class="button secondary" type="button" id="cancel-login">Cancel</button>`
            : `<button class="button" type="button" id="restart-login">Start again</button>`
        }
      </div>
    </section>
  `;

  if (isValidToken) {
    document.querySelector("#approve-login").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Opening...";

      try {
        const approval =
          verification.source === "server"
            ? await approveVerificationToken(token)
            : { profile, sessionToken: state.sessionToken, user: profile };
        const approvedProfile = approval.profile || profile;
        const approvedUser = approval.user || approvedProfile;

        state.email = approvedProfile.email || state.email;
        state.username = approvedProfile.username || approvedUser.username || state.username;
        state.name = approvedProfile.name || state.name;
        state.mobile = approvedProfile.mobile || state.mobile;
        state.role = approvedUser.role || approvedProfile.role || state.role || "user";
        state.status = approvedUser.status || approvedProfile.status || "active";
        state.pro = Boolean(approvedUser.pro || approvedProfile.pro);
        state.sessionToken = approval.sessionToken || state.sessionToken;
        state.token = token;
        state.verified = true;
        state.deliveryStatus = "";
        state.deliveryMessage = "";
        state.verificationLink = "";
        state.activeAppTab = "account";
        state.adminUsers = [];
        state.adminActor = null;
        state.adminStatus = "idle";
        state.adminMessage = "";
        state.adminPreviewLink = "";
        state.aiModels = [];
        state.latestAiModel = null;
        state.rejoinToken = "";
        state.rejoinMessage = "";
        recordLocalUserFromState();
        saveSession();
        goTo("app");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Okay";
        document.querySelector(".confirm-card p").textContent = error.message;
      }
    });
    document.querySelector("#cancel-login").addEventListener("click", () => goTo("sent"));
    return;
  }

  document.querySelector("#restart-login").addEventListener("click", () => {
    clearSession();
    goTo("credentials");
  });
}

async function renderRejoinScreen(token) {
  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Rejoin</p>
      <h1>Checking your rejoin link</h1>
      <p class="screen-copy">Please wait while the app confirms that this return link is valid.</p>

      <div class="confirm-card">
        <h2>Checking link</h2>
        <p>The app is asking the server whether this removed account can register again.</p>
      </div>
    </section>
  `;

  try {
    const response = await fetch(`/api/rejoin?token=${encodeURIComponent(token || "")}`);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.valid || !data.email) {
      throw new Error(data.message || "This rejoin link is invalid or expired.");
    }

    const email = String(data.email).trim().toLowerCase();
    clearSession();
    state.email = email;
    state.rejoinToken = token;
    state.rejoinMessage =
      data.message || "Rejoin link accepted. Complete login to return to the app.";
    saveSession();

    root.innerHTML = `
      <section class="screen">
        <p class="screen-kicker">Rejoin</p>
        <h1>Rejoin link accepted</h1>
        <p class="screen-copy">This registered email ID can return after completing email verification again: ${escapeHtml(email)}.</p>

        <div class="confirm-card">
          <h2>Ready to register again</h2>
          <p>Use the same email ID, add your username and profile details, then approve the verification email.</p>
        </div>

        <div class="actions">
          <button class="button warning" type="button" id="continue-rejoin">Continue</button>
        </div>
      </section>
    `;

    document.querySelector("#continue-rejoin").addEventListener("click", () => goTo("credentials"));
  } catch (error) {
    root.innerHTML = `
      <section class="screen">
        <p class="screen-kicker">Rejoin</p>
        <h1>This rejoin link cannot be used</h1>
        <p class="screen-copy">${escapeHtml(error.message)}</p>

        <div class="actions">
          <button class="button" type="button" id="restart-login">Start again</button>
        </div>
      </section>
    `;

    document.querySelector("#restart-login").addEventListener("click", () => {
      clearSession();
      goTo("credentials");
    });
  }
}

function renderAppScreen() {
  if (!state.verified) {
    goTo("credentials");
    return;
  }

  validateCurrentSession();
  const localAdminRole = getLocalRoleForUsername(state.username);
  if (localAdminRole && state.role !== localAdminRole) {
    state.role = localAdminRole;
    recordLocalUserFromState();
    saveSession();
  }

  ensureAgentGreeting();
  if (state.activeAppTab === "admin" && !canUseAdminTab()) {
    state.activeAppTab = "account";
  }
  if (state.activeAppTab === "pre-admin" && !canUsePreAdminTab()) {
    state.activeAppTab = "account";
  }

  root.innerHTML = `
    <section class="screen">
      <div class="app-topbar">
        <div>
          <p class="screen-kicker">Inside the app</p>
          <h1>Welcome, ${escapeHtml(state.name)}</h1>
          <p class="screen-copy">Your email link was confirmed, so you can now use the app.</p>
        </div>
        ${renderInstallButton()}
      </div>
      ${installMessage ? `<p class="install-message">${escapeHtml(installMessage)}</p>` : ""}

      <div class="app-tabs" role="tablist" aria-label="App tabs">
        ${renderAppTabButton("account", "Account")}
        ${canUseAdminTab() ? renderAppTabButton("admin", "Admin") : ""}
        ${canUsePreAdminTab() ? renderAppTabButton("pre-admin", "Pre-Admin") : ""}
        ${renderAppTabButton("agent", "AI Agent")}
      </div>

      <div class="dashboard-grid">
        ${renderActiveAppTab()}
      </div>

      <div class="actions">
        <button class="button secondary" type="button" id="sign-out">Sign out</button>
      </div>
    </section>
  `;

  document.querySelector("#sign-out").addEventListener("click", () => {
    clearSession();
    goTo("credentials");
  });

  setupInstallButton();
  setupAppTabInteractions();

  if (state.activeAppTab === "agent") {
    setupAgentInteractions();
  }

  if (state.activeAppTab === "admin" || state.activeAppTab === "pre-admin") {
    setupAdminInteractions();
  }
}

function renderInstallButton() {
  const isInstalled = isRunningInstalledApp();
  return `
    <button class="install-button" type="button" id="install-app" aria-label="${isInstalled ? "App is already installed" : "Install app"}" title="${isInstalled ? "App is already installed" : "Install app"}" ${isInstalled ? "disabled" : ""}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11" />
        <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
        <path d="M5 17.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5" />
      </svg>
    </button>
  `;
}

function setupInstallButton() {
  document.querySelector("#install-app")?.addEventListener("click", handleInstallClick);
}

async function handleInstallClick() {
  const button = document.querySelector("#install-app");

  if (isRunningInstalledApp()) {
    installMessage = "Secure Entry is already installed on this device.";
    renderAppScreen();
    return;
  }

  if (!deferredInstallPrompt) {
    installMessage = "Use your browser menu and choose Install app or Add to Home Screen.";
    renderAppScreen();
    return;
  }

  button.disabled = true;
  try {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    installMessage =
      choice?.outcome === "accepted"
        ? "Secure Entry is being installed."
        : "Install was not completed.";
  } catch {
    installMessage = "Use your browser menu and choose Install app or Add to Home Screen.";
  } finally {
    deferredInstallPrompt = null;
    renderAppScreen();
  }
}

function renderAppTabButton(tab, label) {
  const isSelected = state.activeAppTab === tab;
  return `
    <button class="app-tab ${isSelected ? "is-selected" : ""}" type="button" role="tab" aria-selected="${isSelected}" data-tab="${tab}">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderActiveAppTab() {
  if (state.activeAppTab === "admin") {
    return renderAdminPanel();
  }

  if (state.activeAppTab === "pre-admin") {
    return renderAdminPanel();
  }

  if (state.activeAppTab === "agent") {
    return renderAgentPanel();
  }

  return renderAccountPanel();
}

function renderAccountPanel() {
  return `
    <div class="dashboard-card">
      <h2>Account details</h2>
      <p>This is the profile collected during login.</p>
      <div class="profile-list">
        <div class="profile-row">
          <span>Email ID</span>
          <strong>${escapeHtml(state.email)}</strong>
        </div>
        <div class="profile-row">
          <span>Username</span>
          <strong>${escapeHtml(state.username ? `@${state.username}` : "Not provided")}</strong>
        </div>
        <div class="profile-row">
          <span>Name</span>
          <strong>${escapeHtml(state.name)}</strong>
        </div>
        <div class="profile-row">
          <span>Mobile number</span>
          <strong>${escapeHtml(state.mobile)}</strong>
        </div>
        <div class="profile-row">
          <span>Role</span>
          <strong>${escapeHtml(formatRole(state.role))}</strong>
        </div>
        <div class="profile-row">
          <span>Pro subscription</span>
          <strong>${state.pro ? "Active" : "Not active"}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderAgentPanel() {
  return `
    <div class="dashboard-card agent-card">
      <div class="agent-header">
        <span class="agent-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img">
            <path d="M12 3.2 5.4 6v5.4c0 4.1 2.7 7.8 6.6 10.1 3.9-2.3 6.6-6 6.6-10.1V6L12 3.2Z" />
            <path d="M8.6 12.2h6.8" />
            <path d="M10 9.2h.1" />
            <path d="M14 9.2h.1" />
          </svg>
        </span>
        <div>
          <h2>Secure Entry AI Agent</h2>
          <p>Online for this account session.</p>
        </div>
      </div>

      <div class="agent-messages" id="agent-messages" aria-live="polite">
        ${state.agentMessages.map(renderAgentMessage).join("")}
      </div>

      <div class="agent-quick-actions" aria-label="AI agent quick actions">
        ${["Summarize my account", "Explain the email link", "Security checklist", "Draft welcome message"]
          .map((label) => `<button class="agent-chip" type="button" data-prompt="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
          .join("")}
      </div>

      ${renderLatestAiModel()}

      <form class="agent-form" id="agent-form">
        <label class="sr-only" for="agent-input">Message the AI agent</label>
        <input id="agent-input" name="message" type="text" autocomplete="off" placeholder="Ask the agent anything about your login" />
        <button class="button agent-send" type="submit">Send</button>
      </form>
    </div>
  `;
}

function renderLatestAiModel() {
  if (!state.latestAiModel) {
    return `
      <div class="ai-model-card">
        <strong>No AI model created yet</strong>
        <p>Send any prompt and the agent will execute it into a saved model blueprint.</p>
      </div>
    `;
  }

  const model = state.latestAiModel;
  return `
    <div class="ai-model-card">
      <strong>${escapeHtml(model.name)}</strong>
      <p>${escapeHtml(model.objective)}</p>
      <div class="ai-model-tags">
        ${(model.capabilities || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderAdminPanel() {
  const isPreAdminTab = state.activeAppTab === "pre-admin";
  const tabTitle = isPreAdminTab ? "Pre-Admin" : "Admin";
  const message = state.adminMessage
    ? `<div class="admin-message">
        <span>${escapeHtml(state.adminMessage)}</span>
        ${
          state.adminPreviewLink
            ? `<a href="${escapeHtml(state.adminPreviewLink)}">${escapeHtml(state.adminPreviewLink)}</a>`
            : ""
        }
      </div>`
    : "";

  if (state.adminStatus === "loading") {
    return `
      <div class="dashboard-card admin-panel">
        <h2>${tabTitle}</h2>
        <p>Loading registration details...</p>
      </div>
    `;
  }

  if (state.adminStatus === "error") {
    return `
      <div class="dashboard-card admin-panel">
        <h2>${tabTitle}</h2>
        <p>${escapeHtml(state.adminMessage || "Could not load admin records.")}</p>
        <button class="button" type="button" id="admin-refresh">Try again</button>
      </div>
    `;
  }

  return `
    <div class="dashboard-card admin-panel">
      <div class="admin-heading">
        <div>
          <h2>${tabTitle}</h2>
          <p>Registered users from Firebase appear here across WiFi, laptops, desktops, and mobile phones when they use this app server.</p>
        </div>
        <button class="button secondary admin-refresh" type="button" id="admin-refresh">Refresh</button>
      </div>
      <div class="admin-meta">
        <span>Your role: ${escapeHtml(formatRole(state.role))}</span>
        <span>Free Pro value: $25</span>
      </div>
      ${message}
      <div class="admin-users">
        ${
          state.adminUsers.length
            ? state.adminUsers.map(renderAdminUserCard).join("")
            : `<p class="screen-footer-note">No registered users found yet.</p>`
        }
      </div>
    </div>
  `;
}

function renderAdminUserCard(user) {
  const statusClass =
    user.status === "suspended" ? "is-suspended" : user.status === "removed" ? "is-removed" : "";

  return `
    <article class="admin-user-card">
      <div class="admin-user-topline">
        <strong>${escapeHtml(user.name || "Unnamed user")}</strong>
        <span class="status-pill ${statusClass}">${escapeHtml(formatStatus(user.status))}</span>
      </div>

      <div class="profile-list admin-detail-list">
        <div class="profile-row">
          <span>Email ID</span>
          <strong>${escapeHtml(user.email)}</strong>
        </div>
        <div class="profile-row">
          <span>Username</span>
          <strong>${escapeHtml(user.username ? `@${user.username}` : "Not provided")}</strong>
        </div>
        <div class="profile-row">
          <span>Mobile number</span>
          <strong>${escapeHtml(user.mobile || "Not provided")}</strong>
        </div>
        <div class="profile-row">
          <span>Role</span>
          <strong>${escapeHtml(formatRole(user.role))}</strong>
        </div>
        <div class="profile-row">
          <span>Pro subscription</span>
          <strong>${user.pro ? "Free Pro active ($25 value)" : "Not active"}</strong>
        </div>
        ${renderAdminStatusRows(user)}
        <div class="profile-row">
          <span>Last network</span>
          <strong>${escapeHtml(user.lastIpAddress || "Unknown")}</strong>
        </div>
        <div class="profile-row">
          <span>Last device</span>
          <strong>${escapeHtml(shortenDevice(user.lastDevice))}</strong>
        </div>
        <div class="profile-row">
          <span>Registered</span>
          <strong>${escapeHtml(formatDate(user.createdAt))}</strong>
        </div>
      </div>

      <div class="admin-actions">
        ${renderSuspendAction(user)}
        ${renderAdminActionButton(user, "remove", "Remove")}
        ${renderAdminActionButton(user, "make-pre-admin", "Make pre-admin")}
        ${renderAdminActionButton(user, "make-admin", "Make admin")}
        ${renderAdminActionButton(user, "send-rejoin-link", "Send rejoin link")}
        ${renderAdminActionButton(user, "give-free-pro", "Give free Pro")}
      </div>
    </article>
  `;
}

function renderAdminStatusRows(user) {
  const rows = [];

  if (user.status === "suspended") {
    rows.push(["Suspended until", formatDate(user.suspendedUntil)]);
    rows.push(["Suspension length", `${user.suspensionDays || "Selected"} days`]);
  }

  if (user.status === "removed") {
    rows.push(["Removed at", formatDate(user.removedAt)]);
    rows.push(["Removed by", user.removedBy || "Unknown"]);
    rows.push(["Rejoin link sent", user.lastRejoinLinkAt ? formatDate(user.lastRejoinLinkAt) : "Not sent yet"]);
  }

  return rows
    .map(
      ([label, value]) => `
        <div class="profile-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderSuspendAction(user) {
  const disabledReason = getDisabledAdminActionReason(user, "suspend");
  const controlId = `suspend-days-${safeDomId(user.email)}`;
  return `
    <div class="suspend-control">
      <label class="sr-only" for="${controlId}">Suspension days</label>
      <select id="${controlId}" data-suspend-days ${disabledReason ? "disabled" : ""} title="${escapeHtml(disabledReason || "Suspension days")}">
        ${[3, 4, 5, 6, 7].map((days) => `<option value="${days}">${days} days</option>`).join("")}
      </select>
      ${renderAdminActionButton(user, "suspend", "Suspend")}
    </div>
  `;
}

function renderAdminActionButton(user, action, label) {
  const disabledReason = getDisabledAdminActionReason(user, action);
  const priceLabel = action === "give-free-pro" ? `${label} ($25)` : label;
  return `
    <button class="button ${action === "remove" ? "danger" : "secondary"}" type="button" data-admin-action="${action}" data-email="${escapeHtml(user.email)}" ${disabledReason ? "disabled" : ""} title="${escapeHtml(disabledReason || priceLabel)}">
      ${escapeHtml(priceLabel)}
    </button>
  `;
}

function getDisabledAdminActionReason(user, action) {
  if (action === "send-rejoin-link") {
    return user.status === "removed" ? "" : "Rejoin links are only for removed users.";
  }

  if (user.status === "removed") {
    return "Removed users must use a rejoin link before any other action.";
  }

  if (user.email === state.email && (action === "remove" || action === "suspend")) {
    return "You cannot remove or suspend your own account.";
  }

  if (user.role === "admin" && (action === "remove" || action === "suspend")) {
    return "Admin accounts cannot be removed or suspended here.";
  }

  if (state.role === "pre-admin" && user.role !== "user") {
    return "Pre-admins cannot manage admins or pre-admins.";
  }

  if ((action === "make-pre-admin" || action === "make-admin") && state.role !== "admin") {
    return "Only admins can grant admin or pre-admin access.";
  }

  if (action === "make-pre-admin" && user.role !== "user") {
    return "This user is already an admin or pre-admin.";
  }

  if (action === "make-admin" && user.role === "admin") {
    return "This user is already an admin.";
  }

  if (action === "give-free-pro" && user.pro) {
    return "Free Pro is already active.";
  }

  if (action === "give-free-pro" && user.status !== "active") {
    return "Only active users can receive Free Pro.";
  }

  if (action === "suspend" && user.status === "suspended") {
    return "This user is already suspended.";
  }

  return "";
}

function setupAppTabInteractions() {
  document.querySelectorAll(".app-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeAppTab = button.dataset.tab;
      state.adminMessage = "";
      state.adminPreviewLink = "";
      saveSession();
      renderAppScreen();
    });
  });
}

function setupAdminInteractions() {
  document.querySelector("#admin-refresh")?.addEventListener("click", () => {
    loadAdminUsers({ force: true });
  });

  document.querySelectorAll("[data-admin-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".admin-user-card");
      const daysField = card?.querySelector("[data-suspend-days]");
      await runAdminAction({
        email: button.dataset.email,
        action: button.dataset.adminAction,
        days: button.dataset.adminAction === "suspend" ? daysField?.value : undefined,
      });
    });
  });

  if (state.adminStatus === "idle") {
    loadAdminUsers();
  }
}

function canUseAdminTab() {
  return state.role === "admin";
}

function canUsePreAdminTab() {
  return state.role === "pre-admin";
}

async function validateCurrentSession() {
  if (!state.sessionToken || sessionValidationInFlight) {
    return;
  }

  sessionValidationInFlight = true;
  try {
    const response = await fetch("/api/session", {
      headers: {
        Authorization: `Bearer ${state.sessionToken}`,
      },
    });
    const data = await readJsonResponse(response);

    if (!response.ok || !data.user) {
      throw new Error(data.message || "This login session is no longer active.");
    }

    state.email = data.user.email || state.email;
    state.username = data.user.username || state.username;
    state.name = data.user.name || state.name;
    state.mobile = data.user.mobile || state.mobile;
    state.role = data.user.role || state.role;
    state.status = data.user.status || state.status;
    state.pro = Boolean(data.user.pro);
    saveSession();
  } catch (error) {
    clearSession();
    root.innerHTML = `
      <section class="screen">
        <p class="screen-kicker">Session ended</p>
        <h1>Please login again</h1>
        <p class="screen-copy">${escapeHtml(error.message)}</p>
        <div class="actions">
          <button class="button" type="button" id="restart-login">Start again</button>
        </div>
      </section>
    `;
    document.querySelector("#restart-login").addEventListener("click", () => goTo("credentials"));
  } finally {
    sessionValidationInFlight = false;
  }
}

function ensureAgentGreeting() {
  if (state.agentMessages.length > 0) {
    return;
  }

  state.agentMessages = [
    {
      role: "agent",
      text: `Hi ${state.name || "there"}, I am your Secure Entry AI Agent. I can help with your login status, account details, verification link, and security next steps.`,
    },
  ];
  saveSession();
}

function renderAgentMessage(message) {
  return `
    <div class="agent-message ${message.role === "user" ? "from-user" : "from-agent"}">
      <span>${escapeHtml(message.text)}</span>
    </div>
  `;
}

function setupAgentInteractions() {
  const form = document.querySelector("#agent-form");
  const input = document.querySelector("#agent-input");
  const messages = document.querySelector("#agent-messages");

  messages.scrollTop = messages.scrollHeight;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendAgentMessage(input.value);
    input.value = "";
  });

  document.querySelectorAll(".agent-chip").forEach((button) => {
    button.addEventListener("click", () => {
      sendAgentMessage(button.dataset.prompt);
    });
  });
}

async function sendAgentMessage(text) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }

  state.agentMessages.push({ role: "user", text: message });
  state.agentMessages.push({ role: "agent", text: "Executing your prompt and creating an AI model blueprint..." });
  saveSession();
  renderAppScreen();

  try {
    const result = await requestAiModel(message);
    state.latestAiModel = result.model;
    state.aiModels = [result.model, ...state.aiModels].slice(0, 5);
    state.agentMessages[state.agentMessages.length - 1] = {
      role: "agent",
      text: `${result.message} It can handle: ${result.model.capabilities.join(", ")}.`,
    };
  } catch (error) {
    state.agentMessages[state.agentMessages.length - 1] = {
      role: "agent",
      text: `${getAgentReply(message)} Model creation needs the app server session. ${error.message}`,
    };
  }

  state.agentMessages = state.agentMessages.slice(-12);
  saveSession();
  renderAppScreen();
}

async function requestAiModel(prompt) {
  const response = await fetch("/api/agent/model", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.sessionToken}`,
    },
    body: JSON.stringify({ prompt }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.message || "The AI model could not be created.");
  }

  return data;
}

async function loadAdminUsers({ force = false } = {}) {
  if (!state.sessionToken) {
    loadLocalAdminUsers();
    return;
  }

  if (state.adminStatus === "loading" && !force) {
    return;
  }

  state.adminStatus = "loading";
  state.adminMessage = "";
  saveSession();
  renderAppScreen();

  try {
    const response = await fetch("/api/admin/users", {
      headers: {
        Authorization: `Bearer ${state.sessionToken}`,
      },
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data.message || "Could not load admin records.");
    }

    state.adminActor = data.actor || null;
    state.adminUsers = data.users || [];
    state.adminStatus = "ready";
    state.adminMessage = "";
    state.adminPreviewLink = "";
    if (data.actor) {
      state.role = data.actor.role || state.role;
      state.status = data.actor.status || state.status;
      state.pro = Boolean(data.actor.pro);
    }
  } catch (error) {
    state.adminUsers = [];
    state.adminStatus = "error";
    state.adminMessage = error.message;
    state.adminPreviewLink = "";
  }

  saveSession();
  renderAppScreen();
}

async function runAdminAction({ email, action, days }) {
  if (!state.sessionToken) {
    runLocalAdminAction({ email, action, days });
    return;
  }

  state.adminStatus = "loading";
  state.adminMessage = "Updating admin records...";
  state.adminPreviewLink = "";
  saveSession();
  renderAppScreen();

  try {
    const payload = { email, action };
    if (action === "suspend") {
      payload.days = days;
    }

    const response = await fetch("/api/admin/users/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.sessionToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data.message || "This admin action could not be completed.");
    }

    state.adminActor = data.actor || null;
    state.adminUsers = data.users || [];
    state.adminStatus = "ready";
    state.adminPreviewLink = data.rejoin?.previewLink || "";
    state.adminMessage =
      data.rejoin?.message || getAdminActionSuccessMessage(action, email, { days });
    if (data.actor) {
      state.role = data.actor.role || state.role;
      state.status = data.actor.status || state.status;
      state.pro = Boolean(data.actor.pro);
    }
  } catch (error) {
    state.adminStatus = "error";
    state.adminMessage = error.message;
    state.adminPreviewLink = "";
  }

  saveSession();
  renderAppScreen();
}

function loadLocalAdminUsers() {
  recordLocalUserFromState();
  const users = getLocalUsers();
  const actor = users[state.email] || null;

  state.adminActor = actor;
  state.adminUsers = Object.values(users).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  state.adminStatus = "ready";
  state.adminMessage = "Admin tab opened from this browser's saved users.";
  state.adminPreviewLink = "";

  if (actor) {
    state.role = actor.role || state.role;
    state.status = actor.status || state.status;
    state.pro = Boolean(actor.pro);
  }

  saveSession();
  renderAppScreen();
}

function runLocalAdminAction({ email, action, days }) {
  const users = getLocalUsers();
  const target = users[email];

  if (!target) {
    state.adminStatus = "error";
    state.adminMessage = "User registration was not found in this browser.";
    saveSession();
    renderAppScreen();
    return;
  }

  const disabledReason = getDisabledAdminActionReason(target, action);
  if (disabledReason) {
    state.adminStatus = "error";
    state.adminMessage = disabledReason;
    saveSession();
    renderAppScreen();
    return;
  }

  const now = Date.now();
  if (action === "suspend") {
    const suspensionDays = clampLocalSuspensionDays(days);
    target.status = "suspended";
    target.suspendedAt = now;
    target.suspendedUntil = now + suspensionDays * 24 * 60 * 60 * 1000;
    target.suspensionDays = suspensionDays;
  } else if (action === "remove") {
    target.status = "removed";
    target.role = "user";
    target.pro = false;
    target.removedAt = now;
    target.removedBy = state.email;
    target.rejoinRequired = true;
  } else if (action === "make-pre-admin") {
    target.role = "pre-admin";
    target.status = "active";
    target.suspendedAt = null;
    target.suspendedUntil = null;
    target.suspensionDays = null;
  } else if (action === "make-admin") {
    target.role = "admin";
    target.status = "active";
    target.suspendedAt = null;
    target.suspendedUntil = null;
    target.suspensionDays = null;
  } else if (action === "give-free-pro") {
    target.pro = true;
    target.proGrantedAt = now;
    target.proValueUsd = 25;
  } else if (action === "send-rejoin-link") {
    target.lastRejoinLinkAt = now;
    state.adminPreviewLink = `${window.location.href.split("#")[0]}#rejoin/local-${now}`;
  } else {
    state.adminStatus = "error";
    state.adminMessage = "Unknown admin action.";
    saveSession();
    renderAppScreen();
    return;
  }

  target.updatedAt = now;
  users[email] = target;
  saveLocalUsers(users);

  if (email === state.email) {
    state.role = target.role;
    state.status = target.status;
    state.pro = Boolean(target.pro);
  }

  state.adminActor = users[state.email] || null;
  state.adminUsers = Object.values(users).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  state.adminStatus = "ready";
  state.adminMessage = getAdminActionSuccessMessage(action, email, { days });
  if (action !== "send-rejoin-link") {
    state.adminPreviewLink = "";
  }
  saveSession();
  renderAppScreen();
}

function clampLocalSuspensionDays(days) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) {
    return 3;
  }

  return Math.min(7, Math.max(3, Math.round(parsed)));
}

function getAdminActionSuccessMessage(action, email, details = {}) {
  const formattedEmail = email || "the selected user";
  if (action === "suspend") {
    return `${formattedEmail} has been suspended for ${details.days || "the selected number of"} days.`;
  }

  if (action === "remove") {
    return `${formattedEmail} has been removed from the app. They need a rejoin link to return.`;
  }

  if (action === "make-pre-admin") {
    return `${formattedEmail} is now a pre-admin.`;
  }

  if (action === "make-admin") {
    return `${formattedEmail} is now an admin.`;
  }

  if (action === "send-rejoin-link") {
    return `A rejoin link has been prepared for ${formattedEmail}.`;
  }

  if (action === "give-free-pro") {
    return `${formattedEmail} now has free Pro, the $25 faster subscription.`;
  }

  return "Admin records updated.";
}

async function requestVerificationEmail() {
  const existing = getLocalUsers()[state.email];
  if (existing?.status === "suspended") {
    throw new Error(`This account is suspended until ${formatDate(existing.suspendedUntil)}.`);
  }

  if (existing?.status === "removed" && !getLocalRoleForUsername(state.username)) {
    throw new Error("This account was removed from the app. Ask an admin or pre-admin for help.");
  }

  const token = createLocalVerificationToken();
  state.deliveryStatus = "preview";
  state.deliveryMessage = "The verification link was created in the app. It was not sent by email.";
  state.verificationLink = `${window.location.href.split("#")[0]}#verify/${token}`;
  state.token = token;
  saveSession();
}

async function resolveVerificationToken(token) {
  if (state.token && token === state.token) {
    return {
      valid: true,
      source: "local",
      profile: {
        email: state.email,
        username: state.username,
        name: state.name,
        mobile: state.mobile,
        role: getLocalRoleForCurrentProfile(),
        status: state.status,
        pro: state.pro,
      },
    };
  }

  try {
    const response = await fetch(`/api/verification?token=${encodeURIComponent(token)}`);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.valid) {
      return { valid: false };
    }

    return {
      valid: true,
      source: "server",
      profile: data.profile,
    };
  } catch {
    return { valid: false };
  }
}

async function approveVerificationToken(token) {
  const response = await fetch("/api/approve-verification", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });

  const data = await readJsonResponse(response);

  if (!response.ok || !data.profile) {
    throw new Error(data.message || "This login link could not be approved.");
  }

  return data;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getAgentReply(message) {
  const text = message.toLowerCase();
  const firstName = state.name.split(" ")[0] || state.name || "there";

  if (text.includes("summarize") || text.includes("account") || text.includes("profile")) {
    return `Here is your current profile: ${state.name}, email ${state.email}, mobile ${state.mobile}. Your login is verified for this session.`;
  }

  if (text.includes("link") || text.includes("email") || text.includes("verify")) {
    return `The app creates a one-time verification link for ${state.email}. After that link opens, clicking Okay approves this session.`;
  }

  if (text.includes("security") || text.includes("safe") || text.includes("password")) {
    return "Security checklist: use a strong password, keep the email link one-time only, expire unused links quickly, and send emails through a trusted SMTP account.";
  }

  if (text.includes("welcome") || text.includes("draft") || text.includes("message")) {
    return `Welcome ${firstName}, your Secure Entry account is active. Your email link has been confirmed and you can now continue inside the app.`;
  }

  if (text.includes("mobile") || text.includes("phone")) {
    return `The mobile number saved for this session is ${state.mobile}. Add server-side verification before using it for sensitive actions.`;
  }

  if (text.includes("logout") || text.includes("sign out")) {
    return "Use the Sign out button below the dashboard. That clears this local session and returns to the first login screen.";
  }

  if (text.includes("help") || text.includes("do")) {
    return "I can summarize this account, explain the email-link login, suggest security improvements, draft a welcome message, or help plan the next app feature.";
  }

  return "I can help with login, verification, profile details, and safety checks. Try asking for an account summary or a security checklist.";
}

function formatRole(role) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "pre-admin") {
    return "Pre-admin";
  }

  return "User";
}

function formatStatus(status) {
  if (status === "suspended") {
    return "Suspended";
  }

  if (status === "removed") {
    return "Removed";
  }

  if (status === "pending") {
    return "Pending";
  }

  return "Active";
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function shortenDevice(device) {
  const value = String(device || "Unknown device");
  if (value.length <= 84) {
    return value;
  }

  return `${value.slice(0, 81)}...`;
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function getLocalUsers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_USERS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalUsers(users) {
  localStorage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(users));
}

function recordLocalUserFromState() {
  if (!state.email || !state.username || !state.name) {
    return;
  }

  const users = getLocalUsers();
  const existing = users[state.email] || {};
  const now = Date.now();
  const role = getLocalRoleForCurrentProfile();

  users[state.email] = {
    id: existing.id || `local-${now}`,
    email: state.email,
    username: state.username,
    name: state.name,
    mobile: state.mobile,
    role,
    status: existing.status === "removed" && role !== "admin" ? "removed" : "active",
    pro: Boolean(existing.pro || state.pro),
    proGrantedAt: existing.proGrantedAt || null,
    proValueUsd: existing.proValueUsd || null,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionDays: null,
    removedAt: existing.removedAt || null,
    removedBy: existing.removedBy || null,
    rejoinRequired: false,
    lastRejoinLinkAt: existing.lastRejoinLinkAt || null,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
    loginCount: (existing.loginCount || 0) + 1,
    lastIpAddress: "This browser",
    lastDevice: navigator.userAgent || "This device",
  };

  state.role = users[state.email].role;
  state.status = users[state.email].status;
  state.pro = Boolean(users[state.email].pro);
  saveLocalUsers(users);
}

function getLocalRoleForUsername(username) {
  if (isThisLaptopAdminDevice()) {
    return "admin";
  }

  return LOCAL_ADMIN_USERNAMES.includes(normalizeUsername(username)) ? "admin" : "";
}

function getLocalRoleForCurrentProfile() {
  const existing = getLocalUsers()[state.email];
  return getLocalRoleForUsername(state.username) || existing?.role || state.role || "user";
}

function markThisLaptopAsAdminDevice() {
  localStorage.setItem(LOCAL_DEVICE_ADMIN_STORAGE_KEY, "1");
  promoteLocalUsersOnThisLaptop();
}

function isThisLaptopAdminDevice() {
  return localStorage.getItem(LOCAL_DEVICE_ADMIN_STORAGE_KEY) === "1";
}

function promoteLocalUsersOnThisLaptop() {
  const users = getLocalUsers();
  const now = Date.now();

  Object.keys(users).forEach((email) => {
    users[email] = {
      ...users[email],
      role: "admin",
      status: "active",
      updatedAt: now,
    };
  });

  saveLocalUsers(users);
}

function createLocalVerificationToken() {
  const bytes = new Uint8Array(24);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeDomId(value) {
  return String(value || "user").replace(/[^a-z0-9_-]/gi, "-");
}

function isRunningInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function setupInstallEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installMessage = "";

    if (state.verified) {
      renderAppScreen();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installMessage = "Secure Entry is installed.";

    if (state.verified) {
      renderAppScreen();
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("assets/service-worker.js").catch(() => {
      installMessage = "Install support is not available from this browser right now.";
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("hashchange", render);

applyTheme(getInitialTheme());
setupThemeToggle();
setupInstallEvents();
registerServiceWorker();

if (!window.location.hash) {
  goTo("credentials");
} else {
  render();
}
