# How to edit this course

This zip is your Lexisaurus course: `course.json` (the lesson order and the lessons still to
be written), one file per lesson in `lessons/`, and `topics.json` (conversation topics).
`FORMAT.md` describes the files exactly. Ignore its command-line instructions: you upload
changes in the app instead.

## With Claude (claude.ai or the Claude app)

1. Start a chat and attach this zip.
2. Say what you want, for example:
   - "Write the next three planned lessons as lesson files."
   - "Add more drills about ordering food to the lesson on measure words."
   - "Make the topics about my work as a nurse and my trip to Rome in May."
   - "Plan ten lessons on the past tenses after the last lesson."
3. Ask Claude to follow `FORMAT.md` exactly and to give you back the files it changed, or a new
   zip of the whole course.
4. In Lexisaurus open **Settings → Course → Upload course files** and choose those files (or
   the zip). The app checks them and shows what will change before anything is saved.

## By hand

Edit the files in any text editor, keeping the format in `FORMAT.md`, and upload them the same
way.

## Rules that keep your progress

- Never change a lesson's `id`. Your progress is linked to it. Titles can change freely.
- The order of `lessons` in `course.json` is the course order.
- Lessons you leave out of an upload are kept, never deleted.
- For Mandarin, write Chinese in characters only, never pinyin: the app adds pinyin itself.
