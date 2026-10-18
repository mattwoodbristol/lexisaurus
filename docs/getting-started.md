# Getting started

Your own Lexisaurus runs on your own free Cloudflare account and uses your own Claude API key,
so your data and your spending stay under your control. Setting it up takes about fifteen
minutes and needs no programming. You need three accounts: Anthropic (for Claude), GitHub and
Cloudflare. Steps 1 and 2 make the first two; Cloudflare's is made during step 3.

## 1. Get a Claude API key

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an account.
2. Add a little credit (a few pounds lasts a long time: typical daily use costs a few pence).
3. Under **Settings → Limits**, set a monthly spend limit you are comfortable with.
4. Under **API keys**, create a key and copy it. It starts `sk-ant-`. Keep it somewhere safe for
   the next step; you will not be shown it again.

## 2. Make a GitHub account

GitHub holds your copy of the app's code and keeps it up to date. It is free, and after setup
you do not need to use it.

1. Go to [github.com/signup](https://github.com/signup) and create an account (skip this if you
   have one).
2. Confirm your email address when GitHub asks.

## 3. Deploy

1. Click **Deploy to Cloudflare** in the README.
2. Sign in to Cloudflare or create a free account, and connect GitHub when asked: sign in with
   the account from step 2 and allow access. Cloudflare puts a copy of the project in your
   GitHub account, which is how your app updates itself later.
3. Fill in the two secrets:
   - **PASSPHRASE**: the passphrase you will sign in with, 12 or more characters. Anyone who
     knows it can use your tutor (and your API credit), so treat it like a password.
   - **ANTHROPIC_API_KEY**: the key from step 1.
4. Leave the other settings as they are and click **Create and deploy**. After a minute or two
   Cloudflare shows your app's address, something like `https://lexisaurus.<you>.workers.dev`.

## 4. Put it on your phone

Open the address on your phone first, then:

**iPhone or iPad** (iOS 16.4 or newer)

1. In Safari, tap the **Share** button (the square with an arrow, at the bottom of the screen).
   Other browsers have Share in the address bar or menu.
2. Scroll down and tap **Add to Home Screen**, then **Add**.
3. Open Lexisaurus from its new Home Screen icon and sign in there. Reminders only work when
   it is opened this way.

**Android**

1. In Chrome, tap **Install** on the home page (or the menu ⋮ → **Install app**).
2. Open it from the new icon and sign in.

## 5. First run

A short welcome asks which languages you want and a little about you, then a level check sets
where lessons and conversations start. To get daily reminders, open **Settings** and tap
**Turn on notifications**.

## Your course

Lessons are planned and written by Claude as you go. To steer them, open **Settings → Course**:

- **Plan the next lessons with Claude**: say what you want to be able to do and how many
  lessons, check the plan, and tap **Use this plan**.
- **Download course files** gives you a zip of your course. Attach it to a chat on claude.ai or
  in the Claude app and ask for changes ("write a lesson on ordering food", "make the topics
  about my job"). The zip includes a guide Claude follows.
- **Upload course files** takes back what Claude gives you, the whole zip or single lesson
  files. You see what will change before anything is saved, and your progress is kept.

## Updates

Your app updates itself. Once a day your copy of the project on GitHub checks for a new
version and takes it, and Cloudflare rebuilds and redeploys it, including any changes to the
database. Your words, lessons and progress are kept: they live in your database, not in the
code. The version is shown at the bottom of every screen.

If the home screen says a new version is out for more than a day:

1. Open your copy of the project on GitHub and go to **Actions**. If GitHub asks you to enable
   workflows, do so.
2. Open **Update Lexisaurus** and click **Run workflow**. After a few minutes your app is up to
   date.

GitHub pauses daily tasks in a project that has had no activity for 60 days; running it once by
hand starts it again. Changes you make to the code in your copy are replaced by each update, so
ask for a change upstream instead (your course is not code and is never touched).

## If something goes wrong

- **"No passphrase is set yet"** when you sign in: in the Cloudflare dashboard open
  **Workers & Pages →** your tutor **→ Settings → Variables and Secrets** and set `PASSPHRASE`.
  The same place lets you change your passphrase or API key at any time.
- **Chat says there is no Claude API key**: set `ANTHROPIC_API_KEY` in the same place.
- **No reminders on iPhone**: make sure you opened the app from the Home Screen icon, not
  Safari, and that notifications are allowed for Lexisaurus in the iPhone's Settings.
- `https://<your address>/api/health` shows whether the database, passphrase and API key are
  set up.
