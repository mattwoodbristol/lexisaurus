---
name: course-author
description: Design or edit a language course for this app as a course pack (course outline, lesson Markdown files, conversation topics), validate it and sync it. Use when asked to create a course, plan lessons, write or revise a lesson, add drills or common errors, reorder lessons, or change conversation topics.
---

# Writing course content

The course lives in a course pack: plain files that `npm run course -- sync` loads into the app.
Read `docs/course-packs.md` for the full format before editing. `examples/course-zh/` is a
complete small example.

The learner's own pack is `data/courses/<lang>/` (git-ignored). If it does not exist yet,
create it from the live app with `npm run course -- export data/courses/zh --remote`, or start
from a copy of the example.

## Steps

1. **Read before writing.** Open `course.json` and the lessons next to the ones you will touch, so
   new lessons build on what is taught and do not repeat it. Note the learner's level and their
   recurring mistakes from existing "Common errors" sections.
2. **Outline first when designing a course.** Write the order as `lessons` (written) and
   `planned` (title, level and a specific `focus` sentence each). Show the outline to the user
   and agree it before writing many lesson files.
3. **Write lesson files** in `lessons/<id>.md`, exactly in the documented format:
   - At least 2 examples, 8 drills and 1 grammar point, plus the practice sections
     ("## Recognise": 4 multiple-choice questions; "## Lesson check": 3 choice, 3 typed,
     2 fixes). Wrong options must be wrong because of this lesson's pattern.
     `npm run course -- practice <pack> --lesson <id>` drafts them for you to review.
   - Chinese fields are Hanzi only. Never write pinyin anywhere: the app generates it.
   - Use the separators exactly: ` — ` in examples, ` → ` in drills, `✗ … → ✓ … — note` in errors.
   - Drills should practise the lesson's pattern with the learner's own life where known.
   - Keep the title without "Lesson N:"; numbers come from the order.
4. **Never change an existing id.** Progress is keyed on it. To reorder, move ids in
   `course.json`. To retire a lesson, remove its id and file; it is kept in the app unless synced
   with `--prune`, which deletes its review cards, so ask before pruning.
5. **Check:** `npm run course -- check <pack>`. Fix every problem it lists.
6. **Preview:** `npm run course -- sync <pack> --local --dry-run`, then `--local` to try it in
   `npm run dev`.
7. **Live:** syncing with `--remote` changes the live app. Run the `--remote --dry-run` first,
   show the summary to the user, and only run `--remote` when they confirm.
