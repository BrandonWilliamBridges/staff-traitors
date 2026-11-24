# Staff Traitors

A staff-only version of the social deduction game The Traitors, built to run among the teachers, staff and departments of a public high school. A small secret team of Traitors tries to survive the season; everyone else is Faithful and tries to find and banish them. The game runs for one school week, Monday to Friday, with one roundtable vote a day and the Final Roundtable on Friday.

No student data. No money from staff. Nothing during class time. Free tools only.

## What is in this first version

- **Sign in without passwords.** The Game Master adds staff email addresses to an allow list and prints one-time sign-in codes. Signing in on a new phone signs out the old one.
- **Setup gates.** The season cannot open until the principal sponsor approves it in the app and the Game Master ticks off a checklist (staff association told, district technology office says it is fine, no school systems connected).
- **Registration and consent.** Display name, department, optional lunch period, and four consent boxes. Late joiners play as Faithful.
- **Secret casting.** A secure random draw spread across departments. Evaluators (principal, assistant principals) can be kept Faithful only. The draw's fingerprint is shown on casting day and the seed is revealed at the end so anyone can check it. Optional sealed mode hides roles even from the Game Master.
- **Press-and-hold role screen.** Notifications only ever say "Your role is ready."
- **Missions.** A ready one-week plan that opens five or six missions each school day, built from 30 starter missions (department challenges, code-card scavenger hunts, kindness missions, trivia, cross-department pairs, split-clue puzzles). Check-in by code word, quiz answer, photo (with a no-students warning) or Game Master review. Missions fill a shared prize pot; some award a secret Shield.
- **The Traitors' Hideout.** Private board, murder vote, one Sabotage card a day (halves one group mission's payout), and recruitment when one Traitor is left.
- **Murders.** Most traitor votes wins, random draw on a tie, Shields block, away players are safe. Two murders a night for groups of 18 to 20.
- **The roundtable.** One a school day; a second one the same day needs the Game Master's override, which is logged. One secret vote each, change it until close, no self votes, optional Dagger (double vote), tie goes to one revote between the tied players, a second tie banishes nobody. Reveal as totals only or every vote by name.
- **Endgame.** Final Roundtable at five players or on Friday, the season's last day, whichever comes first. The game ends only if every remaining player votes End Game.
- **Calendar.** Blackout dates and weekends block every game step unless the Game Master overrides (logged). Personal notices wait for quiet hours to pass (class periods from the bell schedule, evenings, weekends).
- **Friendly by design.** Opt out with one button, Away status, a private Report a Concern button, and a Pause button for the principal sponsor.
- **Organizer dashboard** for the Game Master and a read-only view for the principal sponsor (no roles, no emails).
- **Leaderboards** for players and departments (average per player so small departments are not punished).
- **Season story, export and deletion.** When the season ends everyone can see every role and round. The Game Master downloads the data and deletes all player data.

## Run it

You need Node 22.5 or newer (it uses Node's built-in SQLite, so there is nothing to install).

```
GM_EMAIL=you@yourschool.org npm start
```

The first start creates the Game Master account and prints a one-time sign-in code. Open http://localhost:8787/admin.html, sign in, and follow the dashboard from top to bottom.

Sign-in codes print in the server window (`EMAIL_MODE=console`) so the Game Master can hand them out. Adding a real email sender on a free plan is a later step.

Settings: `PORT` (default 8787), `DB_FILE` (default `data/game.db`), `GM_EMAIL`, `SECURE_COOKIE=1` when served over https.

## Tests

```
npm test             # 22 tests: rules, one roundtable a day, the week plan, tie handling, endgame, privacy, the web interface
npm run simulate     # 300 one-week games of 15 fake players, day by day
npm run simulate -- 150 20 2    # games, players, murders a night
```

The simulation plays Monday to Friday with one roundtable a day and checks that every game ends, nobody ever votes twice, no notice to a Faithful player names a role, and no evaluator is cast as a Traitor.

## How many players fit one week

Monday to Thursday each have one murder and one roundtable, so four days remove about four times (murders a night plus one) players. Friday is the Final Roundtable: one meeting with a few quick votes until the players end the game. From 150 to 200 simulated games each (random voters, so the win rates are only a rough guide):

| Players | Murders a night | Reach Friday | Left on Friday | Friday votes | Faithful win |
| --- | --- | --- | --- | --- | --- |
| 12 | 1 | 27% | about 6 | about 2 | 21% |
| 15 | 1 | 87% | about 8 | about 3 | 46% |
| 18 | 2 | 84% | about 8 | about 3 | 49% |
| 20 | 2 | 87% | about 10 | about 4 | 57% |
| 25 | 2 | 98% | about 14 | about 7 | 56% |
| 30 | 3 | 96% | about 17 | about 7 | 76% |

**15 to 20 players fits one week best:** 1 murder a night for about 15, 2 for 18 to 20. Under 15 the Traitors usually win before Friday. Over about 22, Friday turns into a long string of votes. For a whole faculty, run separate games (by building, floor or lunch period) or stretch the dates to two weeks.

## The one-week mission plan

Load it from the Missions card (Load the one-week plan), then press Open today's planned missions each morning. It opens that day's missions and closes the ones whose time is up. Every mission stays editable while it is a draft.

| Day | Missions |
| --- | --- |
| Monday | Lounge Clue, Copy Room Clue, Department Haiku, School History One (trivia), Three in Common (pairs, to Tuesday), Thank a Custodian (to Tuesday), New Teacher Welcome (all week, Shield), Six Card Sweep (all week) |
| Tuesday | Mailroom Clue, Fact Swap, School History Two (trivia), The Broken Map (split-clue puzzle, Shield), Swap a Tip (pairs, to Wednesday), Cafeteria Shout-out (to Wednesday) |
| Wednesday | Tower of Power (lunch build), Library Clue, Staff Fun Fact (trivia), Four Letters (puzzle), Cross the Hall (to Thursday), Lounge Makeover (to Friday, Shield) |
| Thursday | Front Office Riddle, Mascot Sketch, Bell Schedule Sprint (trivia), The Cipher (puzzle), Walk and Talk (pairs), Coffee Run (to Friday) |
| Friday | Spirit Day, Lunch Line Logic (trivia), Numbers Station (puzzle) |

Faculty Meeting Bingo is left out of the plan; open it by hand on your faculty meeting day.

## Free hosting

The app is one Node process and one SQLite file, so it needs a machine that keeps its disk:

1. **Simplest, free:** run it on a home computer that stays on and expose it with a free Cloudflare Tunnel on a subdomain you already own. Set `SECURE_COOKIE=1`.
2. **Later:** move the engine onto Cloudflare Workers with the D1 database (free plan). The engine's SQL is plain SQLite, so it ports with small changes.

Do not host it on a school or district server without written approval from the district technology office.

## Not built yet

- Email delivery of sign-in codes (printed codes and the console work today).
- Web push notifications (notices show in the app and respect quiet hours).
- Spanish language setting.
- A pairing tool that assigns cross-department partners (the Game Master announces pairs for now).
- Paper ballot entry screen for staff without a phone (the Game Master can sign in on a shared device for now).
- Automatic deletion 30 days after the season (the delete button works; the timer does not exist yet).
