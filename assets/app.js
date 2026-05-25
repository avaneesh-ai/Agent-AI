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
let pendingPassword = "";
let voiceModeActive = false;
let voiceRecognition = null;

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

  if (hash.startsWith("admin-verify/")) {
    return { name: "admin-verify", token: hash.split("/")[1] };
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

  if (
    state.verified &&
    route.name !== "app" &&
    route.name !== "rejoin" &&
    route.name !== "admin-verify"
  ) {
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

  if (route.name === "admin-verify") {
    renderAdminVerificationScreen(route.token);
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
    "admin-verify": 2,
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
      <p class="screen-copy">Enter your email ID and password. Existing users can sign in directly, while new users can continue to profile details.</p>
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
          <button class="button secondary" type="submit" name="intent" value="signin">Sign in</button>
          <button class="button" type="submit" name="intent" value="profile">Next</button>
        </div>
        <p class="error" id="signin-error"></p>
      </form>
    </section>
  `;

  document.querySelector("#credentials-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    const intent = event.submitter?.value || "profile";

    const emailError = document.querySelector("#email-error");
    const passwordError = document.querySelector("#password-error");
    const signInError = document.querySelector("#signin-error");
    emailError.textContent = "";
    passwordError.textContent = "";
    signInError.textContent = "";

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
    pendingPassword = password;
    state.verified = false;
    saveSession();

    if (intent === "signin") {
      const submitButton = event.submitter;
      submitButton.disabled = true;
      submitButton.textContent = "Signing in...";

      try {
        await signInExistingAccount({ email, password });
        goTo("app");
      } catch (error) {
        signInError.textContent = error.message;
        submitButton.disabled = false;
        submitButton.textContent = "Sign in";
      }
      return;
    }

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
            : await approveLocalVerification(profile);
        applyApprovedLogin(approval, profile);
        state.token = token;
        recordLocalUserFromState();
        await rememberLocalPasswordForCurrentUser();
        pendingPassword = "";
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

async function renderAdminVerificationScreen(token) {
  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Admin link</p>
      <h1>Checking the verification link</h1>
      <p class="screen-copy">Please wait while the app confirms this admin-created login link.</p>

      <div class="confirm-card">
        <h2>Checking link</h2>
        <p>The app is checking whether this invite is still valid.</p>
      </div>
    </section>
  `;

  const verification = await resolveAdminVerificationToken(token);
  const isValidToken = verification.valid;
  const profile = verification.profile || {};

  root.innerHTML = `
    <section class="screen">
      <p class="screen-kicker">Admin link</p>
      <h1>${isValidToken ? "Do you want to login to this app?" : "This verification link is not valid"}</h1>
      <p class="screen-copy">
        ${
          isValidToken
            ? `This link was created for ${escapeHtml(profile.email || "this user")}. Click okay to enter the app.`
            : "Ask an admin to create a fresh verification link."
        }
      </p>

      <div class="confirm-card">
        <h2>${isValidToken ? "Ready to continue" : "Link expired"}</h2>
        <p>${
          isValidToken
            ? `${escapeHtml(profile.name || "The user")} will be logged in with the registered email ID and phone number on this link.`
            : "For safety, admin-created links expire and cannot be reused."
        }</p>
      </div>

      <div class="actions">
        ${
          isValidToken
            ? `<button class="button warning" type="button" id="approve-admin-login">Okay</button>
               <button class="button secondary" type="button" id="cancel-admin-login">Cancel</button>`
            : `<button class="button" type="button" id="restart-login">Start again</button>`
        }
      </div>
    </section>
  `;

  if (isValidToken) {
    document.querySelector("#approve-admin-login").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Opening...";

      try {
        const approval = await approveAdminVerificationToken(token, profile, verification.source);
        applyApprovedLogin(approval, profile);
        state.token = token;
        pendingPassword = "";
        recordLocalUserFromState();
        saveSession();
        goTo("app");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Okay";
        document.querySelector(".confirm-card p").textContent = error.message;
      }
    });
    document.querySelector("#cancel-admin-login").addEventListener("click", () => goTo("credentials"));
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
          <h2>Secure Entry AI Chatbot</h2>
          <p>Ask anything. Every prompt becomes a saved AI model blueprint.</p>
        </div>
      </div>

      <div class="agent-messages" id="agent-messages" aria-live="polite">
        ${state.agentMessages.map(renderAgentMessage).join("")}
      </div>

      <div class="agent-quick-actions" aria-label="AI agent quick actions">
        ${["Summarize my account", "Create a login support model", "Security checklist", "Draft welcome message"]
          .map((label) => `<button class="agent-chip" type="button" data-prompt="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
          .join("")}
      </div>

      <div class="agent-tools">
        ${renderVoiceModeControl()}
      </div>

      ${renderLatestAiModel()}

      <form class="agent-form" id="agent-form">
        <label class="sr-only" for="agent-input">Message the AI agent</label>
        <input id="agent-input" name="message" type="text" autocomplete="off" placeholder="Message the AI chatbot" />
        <button class="button agent-send" type="submit">Send</button>
      </form>
    </div>
  `;
}

function renderVoiceModeControl() {
  if (!state.pro) {
    return `
      <button class="agent-chip voice-chip is-locked" type="button" disabled title="Voice mode is available only for Pro accounts">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
        <span>Voice mode Pro</span>
      </button>
    `;
  }

  return `
    <button class="agent-chip voice-chip ${voiceModeActive ? "is-active" : ""}" type="button" id="voice-mode" aria-pressed="${voiceModeActive}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
      <span>${voiceModeActive ? "Listening" : "Voice mode"}</span>
    </button>
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
  const createLinkForm = state.role === "admin" ? renderAdminVerificationForm() : "";
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
      ${createLinkForm}
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

function renderAdminVerificationForm() {
  return `
    <form class="admin-link-form" id="admin-link-form" novalidate>
      <h3>Create user verification link</h3>
      <div class="admin-link-fields">
        <label>
          <span>Name</span>
          <input name="name" type="text" autocomplete="off" placeholder="User name" required />
        </label>
        <label>
          <span>Email ID</span>
          <input name="email" type="email" autocomplete="off" placeholder="user@example.com" required />
        </label>
        <label>
          <span>Phone number</span>
          <input name="mobile" type="tel" autocomplete="off" placeholder="10 digit mobile number" required />
        </label>
      </div>
      <div class="actions compact-actions">
        <button class="button" type="submit">Create verification link</button>
      </div>
    </form>
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

  document.querySelector("#admin-link-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const mobile = String(form.get("mobile") || "").trim();
    const submitButton = event.currentTarget.querySelector("button[type='submit']");

    submitButton.disabled = true;
    submitButton.textContent = "Creating...";
    state.adminMessage = "";
    state.adminPreviewLink = "";
    saveSession();

    try {
      const result = await createAdminVerificationLink({ name, email, mobile });
      state.adminStatus = "ready";
      state.adminMessage = result.message || `Verification link created for ${email}.`;
      state.adminPreviewLink = result.verificationLink || "";
    } catch (error) {
      state.adminStatus = "ready";
      state.adminMessage = error.message;
      state.adminPreviewLink = "";
    }

    saveSession();
    renderAppScreen();
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

  document.querySelectorAll(".agent-chip[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      sendAgentMessage(button.dataset.prompt);
    });
  });

  document.querySelector("#voice-mode")?.addEventListener("click", handleVoiceModeClick);
}

async function sendAgentMessage(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }

  state.agentMessages.push({ role: "user", text: message });
  state.agentMessages.push({ role: "agent", text: "Thinking, executing your prompt, and saving an AI model..." });
  saveSession();
  renderAppScreen();

  try {
    const result = await requestAgentChat(message);
    state.latestAiModel = result.model;
    state.aiModels = [result.model, ...state.aiModels].slice(0, 5);
    const replyText = result.message;
    state.agentMessages[state.agentMessages.length - 1] = {
      role: "agent",
      text: replyText,
    };
  } catch (error) {
    const model = createLocalAiModel(message);
    const replyText = `${getAgentReply(message)}\n\nSaved locally as ${model.name}.`;
    state.latestAiModel = model;
    state.aiModels = [model, ...state.aiModels].slice(0, 5);
    state.agentMessages[state.agentMessages.length - 1] = {
      role: "agent",
      text: replyText,
    };
  }

  state.agentMessages = state.agentMessages.slice(-12);
  const latestReply = state.agentMessages[state.agentMessages.length - 1]?.text || "";
  saveSession();
  renderAppScreen();

  if (state.pro && (options.speakReply || voiceModeActive)) {
    speakText(latestReply);
  }
}

function handleVoiceModeClick() {
  if (!state.pro) {
    state.agentMessages.push({
      role: "agent",
      text: "Voice mode is only available for Pro accounts.",
    });
    saveSession();
    renderAppScreen();
    return;
  }

  if (voiceRecognition) {
    voiceRecognition.stop();
    voiceRecognition = null;
    voiceModeActive = false;
    saveSession();
    renderAppScreen();
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    const message =
      "Voice input is not supported in this browser. Pro voice replies can still read the chatbot answer aloud when voice input is available.";
    state.agentMessages.push({ role: "agent", text: message });
    saveSession();
    renderAppScreen();
    speakText(message);
    return;
  }

  const recognition = new Recognition();
  let handledResult = false;
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  voiceRecognition = recognition;
  voiceModeActive = true;

  state.agentMessages.push({ role: "agent", text: "Voice mode is listening..." });
  state.agentMessages = state.agentMessages.slice(-12);
  saveSession();
  renderAppScreen();

  recognition.addEventListener("result", (event) => {
    handledResult = true;
    const transcript = Array.from(event.results || [])
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    voiceRecognition = null;
    voiceModeActive = false;

    if (!transcript) {
      state.agentMessages.push({ role: "agent", text: "I could not hear a message. Try voice mode again." });
      saveSession();
      renderAppScreen();
      return;
    }

    sendAgentMessage(transcript, { speakReply: true });
  });

  recognition.addEventListener("error", () => {
    handledResult = true;
    voiceRecognition = null;
    voiceModeActive = false;
    state.agentMessages.push({
      role: "agent",
      text: "Voice mode could not hear you clearly. Try again or type your prompt.",
    });
    saveSession();
    renderAppScreen();
  });

  recognition.addEventListener("end", () => {
    if (handledResult) {
      return;
    }

    voiceRecognition = null;
    voiceModeActive = false;
    saveSession();
    if (state.activeAppTab === "agent") {
      renderAppScreen();
    }
  });

  try {
    recognition.start();
  } catch {
    voiceRecognition = null;
    voiceModeActive = false;
    state.agentMessages.push({
      role: "agent",
      text: "Voice mode could not start in this browser. Try typing your prompt instead.",
    });
    saveSession();
    renderAppScreen();
  }
}

function speakText(text) {
  if (!state.pro || !("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(
    String(text || "")
      .replace(/\s+/g, " ")
      .slice(0, 700),
  );
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function requestAgentChat(prompt) {
  if (!state.sessionToken) {
    throw new Error("The server session is not available.");
  }

  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.sessionToken}`,
    },
    body: JSON.stringify({
      prompt,
      history: state.agentMessages.slice(-8),
    }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.message || "The AI chatbot could not answer.");
  }

  return data;
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

function createLocalAiModel(prompt) {
  const words = String(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6);
  const topic = words.length ? titleCase(words.join(" ")) : "Custom Assistant";
  const now = Date.now();
  const model = {
    id: `local-model-${now}`,
    ownerEmail: state.email,
    name: `${topic} Model`,
    prompt,
    objective: `Execute this user request: ${prompt}`,
    inputs: ["user prompt", "current account context", "saved registration details"],
    outputs: ["chatbot answer", "action summary", "saved model blueprint"],
    capabilities: inferLocalModelCapabilities(prompt),
    workflow: [
      "Understand the prompt.",
      "Check the current user context.",
      "Answer in chat and save the model locally.",
    ],
    execution: {
      provider: "local",
      status: "completed",
      result: getAgentReply(prompt),
      executedAt: now,
    },
    status: "executed",
    createdAt: now,
    updatedAt: now,
  };

  saveLocalAiModel(model);
  return model;
}

function saveLocalAiModel(model) {
  const models = JSON.parse(localStorage.getItem("secure-entry-local-ai-models") || "[]");
  models.unshift(model);
  localStorage.setItem("secure-entry-local-ai-models", JSON.stringify(models.slice(0, 20)));
}

function inferLocalModelCapabilities(prompt) {
  const text = String(prompt).toLowerCase();
  const capabilities = ["chatbot response", "prompt execution", "saved model blueprint"];
  if (text.includes("admin") || text.includes("user") || text.includes("account")) {
    capabilities.push("account-aware actions");
  }
  if (text.includes("login") || text.includes("verify")) {
    capabilities.push("login guidance");
  }
  if (text.includes("pro") || text.includes("subscription")) {
    capabilities.push("subscription workflow");
  }
  return capabilities;
}

function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
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
  const existing = findLocalUserByEmail(state.email).user;
  if (existing?.status === "suspended") {
    throw new Error(`This account is suspended until ${formatDate(existing.suspendedUntil)}.`);
  }

  if (existing?.status === "removed" && !getLocalRoleForUsername(state.username)) {
    throw new Error("This account was removed from the app. Ask an admin or pre-admin for help.");
  }

  recordLocalUserFromState({ status: "pending" });

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

async function approveLocalVerification(profile) {
  try {
    const response = await fetch("/api/local-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: profile.email || state.email,
        username: profile.username || state.username,
        name: profile.name || state.name,
        mobile: profile.mobile || state.mobile,
        password: pendingPassword,
      }),
    });
    const data = await readJsonResponse(response);

    if (!response.ok && (response.status === 404 || response.status === 405)) {
      return { profile, sessionToken: "", user: profile };
    }

    if (!response.ok) {
      throw new Error(data.message || "The app server could not save this login.");
    }

    return data;
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    return { profile, sessionToken: "", user: profile };
  }
}

function applyApprovedLogin(approval, fallbackProfile = {}) {
  const approvedProfile = approval.profile || fallbackProfile;
  const approvedUser = approval.user || approvedProfile;
  const username = approvedProfile.username || approvedUser.username || state.username;

  state.email = (approvedProfile.email || approvedUser.email || state.email).toLowerCase();
  state.username = username;
  state.name = approvedProfile.name || approvedUser.name || state.name;
  state.mobile = approvedProfile.mobile || approvedUser.mobile || state.mobile;
  state.role =
    approvedUser.role ||
    approvedProfile.role ||
    getLocalRoleForUsername(username) ||
    state.role ||
    "user";
  state.status = approvedUser.status || approvedProfile.status || "active";
  state.pro = Boolean(approvedUser.pro || approvedProfile.pro);
  state.sessionToken = approval.sessionToken || "";
  state.verified = true;
  state.deliveryStatus = "";
  state.deliveryMessage = "";
  state.verificationLink = "";
  state.activeAppTab = "account";
  state.agentMessages = [];
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

async function signInExistingAccount({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let serverMessage = "";

  try {
    const response = await fetch("/api/password-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    const data = await readJsonResponse(response);

    if (response.ok && data.profile) {
      applyApprovedLogin(data, data.profile);
      pendingPassword = password;
      recordLocalUserFromState();
      await rememberLocalPasswordForCurrentUser();
      pendingPassword = "";
      saveSession();
      return;
    }

    serverMessage = data.message || "No saved account was found for this email ID.";
    if (response.status !== 404 && response.status !== 405) {
      throw new Error(serverMessage);
    }
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }
  }

  await signInLocalSavedAccount({
    email: normalizedEmail,
    password,
    serverMessage,
  });
}

async function signInLocalSavedAccount({ email, password, serverMessage }) {
  const found = findLocalUserByEmail(email);
  const user = found.user;

  if (!user) {
    throw new Error(serverMessage || "No saved account was found for this email ID.");
  }

  if (normalizeLocalUserStatus(user)) {
    found.users[found.email] = user;
    saveLocalUsers(found.users);
  }

  if (user.status === "suspended") {
    throw new Error(`This account is suspended until ${formatDate(user.suspendedUntil)}.`);
  }

  if (user.status === "removed") {
    throw new Error("This account was removed from the app. Ask an admin or pre-admin for a rejoin link.");
  }

  if (!user.passwordHash) {
    throw new Error("This account needs one full login once before password-only sign in works.");
  }

  const passwordMatches = await verifyLocalPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new Error("The password does not match this account.");
  }

  const now = Date.now();
  user.lastLoginAt = now;
  user.loginCount = (user.loginCount || 0) + 1;
  user.updatedAt = now;
  user.lastIpAddress = "This browser";
  user.lastDevice = navigator.userAgent || "This device";
  found.users[found.email] = user;
  saveLocalUsers(found.users);

  applyApprovedLogin({ profile: user, user, sessionToken: "" }, user);
  pendingPassword = "";
  saveSession();
}

async function createAdminVerificationLink({ name, email, mobile }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const username = deriveUsernameFromEmail(normalizedEmail, name);

  if (state.role !== "admin") {
    throw new Error("Only admins can create verification links.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email ID.");
  }

  if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
    throw new Error("The generated username is not valid. Try a different email ID.");
  }

  if (name.length < 2) {
    throw new Error("Enter the user's name.");
  }

  if (!/^[0-9+\-\s()]{7,16}$/.test(mobile)) {
    throw new Error("Enter a valid phone number.");
  }

  if (state.sessionToken) {
    try {
      const response = await fetch("/api/admin/create-verification-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.sessionToken}`,
        },
        body: JSON.stringify({
          name,
          email: normalizedEmail,
          mobile,
          username,
        }),
      });
      const data = await readJsonResponse(response);

      if (response.ok && data.verificationLink) {
        return data;
      }

      if (response.status !== 404 && response.status !== 405) {
        throw new Error(data.message || "The verification link could not be created.");
      }
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }

  return createLocalAdminVerificationLink({
    name,
    email: normalizedEmail,
    mobile,
    username,
  });
}

function createLocalAdminVerificationLink(profile) {
  const token = `local-${base64UrlEncodeJson({
    ...profile,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })}`;

  return {
    verificationLink: `${window.location.href.split("#")[0]}#admin-verify/${token}`,
    message: `Verification link created locally for ${profile.email}.`,
  };
}

async function resolveAdminVerificationToken(token) {
  if (String(token || "").startsWith("local-")) {
    const profile = base64UrlDecodeJson(String(token).slice(6));
    if (!profile || Number(profile.expiresAt) <= Date.now()) {
      return { valid: false };
    }

    return {
      valid: true,
      source: "local",
      profile,
    };
  }

  try {
    const response = await fetch(`/api/admin-verification?token=${encodeURIComponent(token || "")}`);
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

async function approveAdminVerificationToken(token, profile, source) {
  if (source === "local" || String(token || "").startsWith("local-")) {
    return approveLocalAdminVerification(profile);
  }

  const response = await fetch("/api/approve-admin-verification", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok || !data.profile) {
    throw new Error(data.message || "This admin-created verification link could not be approved.");
  }

  return data;
}

function approveLocalAdminVerification(profile) {
  const found = findLocalUserByEmail(profile.email);
  const existing = found.user || {};
  normalizeLocalUserStatus(existing);

  if (existing.status === "suspended") {
    throw new Error(`This account is suspended until ${formatDate(existing.suspendedUntil)}.`);
  }

  if (existing.status === "removed") {
    throw new Error("This account was removed from the app. Ask an admin or pre-admin for a rejoin link.");
  }

  const now = Date.now();
  const email = String(profile.email || "").trim().toLowerCase();
  const username = normalizeUsername(profile.username || deriveUsernameFromEmail(email, profile.name));
  const role = getLocalRoleForUsername(username) || existing.role || "user";
  const user = {
    ...existing,
    id: existing.id || `local-${now}`,
    email,
    username,
    name: profile.name,
    mobile: profile.mobile,
    role,
    status: "active",
    pro: Boolean(existing.pro),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
    loginCount: (existing.loginCount || 0) + 1,
    lastIpAddress: "This browser",
    lastDevice: navigator.userAgent || "This device",
  };

  const users = found.users || getLocalUsers();
  users[email] = user;
  saveLocalUsers(users);

  return {
    profile: user,
    user,
    sessionToken: "",
  };
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

function deriveUsernameFromEmail(email, fallbackName = "") {
  const fromEmail = String(email || "").split("@")[0];
  const fallback = String(fallbackName || "").replace(/\s+/g, ".");
  return normalizeUsername(fromEmail || fallback).replace(/[^a-z0-9._-]/g, "").slice(0, 24);
}

function isNetworkError(error) {
  const message = String(error?.message || "");
  return (
    error instanceof TypeError ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("URL scheme")
  );
}

function base64UrlEncodeJson(value) {
  const json = JSON.stringify(value);
  const bytes =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(json)
      : Uint8Array.from(unescape(encodeURIComponent(json)), (char) => char.charCodeAt(0));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecodeJson(value) {
  try {
    const padded = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
    const base64 = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json =
      typeof TextDecoder !== "undefined"
        ? new TextDecoder().decode(bytes)
        : decodeURIComponent(escape(binary));
    return JSON.parse(json);
  } catch {
    return null;
  }
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

function findLocalUserByEmail(email) {
  const users = getLocalUsers();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (users[normalizedEmail]) {
    return { users, email: normalizedEmail, user: users[normalizedEmail] };
  }

  const matchedEmail = Object.keys(users).find((key) => key.toLowerCase() === normalizedEmail);
  if (!matchedEmail) {
    return { users, email: normalizedEmail, user: null };
  }

  return { users, email: matchedEmail, user: users[matchedEmail] };
}

function recordLocalUserFromState(options = {}) {
  if (!state.email || !state.username || !state.name) {
    return;
  }

  const users = getLocalUsers();
  const normalizedEmail = state.email.toLowerCase();
  const existing = users[normalizedEmail] || {};
  const now = Date.now();
  const role = getLocalRoleForCurrentProfile();

  users[normalizedEmail] = {
    id: existing.id || `local-${now}`,
    email: normalizedEmail,
    username: state.username,
    name: state.name,
    mobile: state.mobile,
    role,
    status:
      options.status ||
      (existing.status === "removed" && role !== "admin" ? "removed" : "active"),
    passwordHash: existing.passwordHash || null,
    passwordUpdatedAt: existing.passwordUpdatedAt || null,
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

  state.email = normalizedEmail;
  state.role = users[normalizedEmail].role;
  state.status = users[normalizedEmail].status;
  state.pro = Boolean(users[normalizedEmail].pro);
  saveLocalUsers(users);
}

async function rememberLocalPasswordForCurrentUser(password = pendingPassword) {
  if (!password || !state.email) {
    return;
  }

  const found = findLocalUserByEmail(state.email);
  if (!found.user) {
    return;
  }

  const salt = found.user.passwordSalt || createLocalVerificationToken();
  found.user.passwordSalt = salt;
  found.user.passwordHash = await hashLocalPassword(password, salt);
  found.user.passwordUpdatedAt = Date.now();
  found.users[found.email] = found.user;
  saveLocalUsers(found.users);
}

async function hashLocalPassword(password, salt) {
  const payload = `${salt}:${password}`;
  if (window.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(payload),
    );
    return `local_sha256$${salt}$${toHex(digest)}`;
  }

  return `local_simple$${salt}$${simpleLocalPasswordHash(payload)}`;
}

async function verifyLocalPassword(password, storedHash) {
  const [method, salt, expected] = String(storedHash || "").split("$");
  if (!method || !salt || !expected) {
    return false;
  }

  if (method === "local_sha256" && window.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const actual = await hashLocalPassword(password, salt);
    return actual === storedHash;
  }

  if (method === "local_simple") {
    return simpleLocalPasswordHash(`${salt}:${password}`) === expected;
  }

  return false;
}

function simpleLocalPasswordHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeLocalUserStatus(user) {
  if (!user || user.status !== "suspended" || !user.suspendedUntil) {
    return false;
  }

  if (Number(user.suspendedUntil) > Date.now()) {
    return false;
  }

  user.status = "active";
  user.suspendedAt = null;
  user.suspendedUntil = null;
  user.suspensionDays = null;
  user.updatedAt = Date.now();
  return true;
}

function getLocalRoleForUsername(username) {
  if (isThisLaptopAdminDevice()) {
    return "admin";
  }

  return LOCAL_ADMIN_USERNAMES.includes(normalizeUsername(username)) ? "admin" : "";
}

function getLocalRoleForCurrentProfile() {
  const existing = findLocalUserByEmail(state.email).user;
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
