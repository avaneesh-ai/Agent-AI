# Agent_Ai

Agent_Ai is a browser app with email-link login, username registration, admin and pre-admin controls, a no-Firebase shared server, and an AI agent tab.

## Best GitHub Folder

Use the project root on the `main` branch:

```text
AI Agent 2/
```

Do not put these files inside a `docs` folder. For the simple browser upload, put `index.html` and `assets/` in the root.

## Files To Upload

For the simple browser upload shape, upload these files and folders to the root of the GitHub repository:

```text
README.md
assets/
index.html
```

That gives you the simple `index.html` plus `assets/` structure.

For users from other phones, laptops, desktops, tabs, or Wi-Fi networks to appear in Admin, run the Node server and make everyone open the same server address. Do not upload a real `.env` file. Keep SMTP passwords and admin settings secret on the hosting service.

## Run Locally

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

The server also prints a network address like `http://192.168.x.x:3000/`. People on the same Wi-Fi should open that address so their registration details go into the same admin list.

## Installable App

The app includes a web manifest, app icons, and a service worker. After a user logs in, an install icon appears at the top of the app. On supported browsers, clicking it opens the browser's install prompt.
