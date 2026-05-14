# AGENTS.md

## Project Overview

This is a minimalist realtime multiplayer **Connect Four / 4 in a Row** browser game.

Stack:

- React + Vite
- Firebase Anonymous Authentication
- Firebase Realtime Database
- Cloudflare Pages for static hosting

The app is intentionally serverless from the hosting point of view. Cloudflare Pages only serves static files. Firebase provides anonymous identity, room state, realtime subscriptions, and transactional writes.

## Repository Structure

```text
src/
  App.jsx        # Main React UI, room flow, Firebase listeners, user actions
  firebase.js   # Firebase initialization and anonymous auth helper
  game.js       # Pure game logic: board, moves, winner detection, room mutations
  main.jsx      # React entry point
  styles.css    # Premium visual system and responsive layout
public/
  _headers      # Cloudflare Pages security/cache headers
.env.example    # Required Vite Firebase variables
database.rules.json
package.json
vite.config.js
wrangler.toml
README.md
```

## Commands

Use these commands from the project root:

```bash
npm install
npm run dev
npm run build
npm run preview
```

For Cloudflare Pages direct deploy:

```bash
npm run build
npx wrangler pages deploy dist
```

Build output directory: `dist`.

## Environment Variables

Do not hardcode Firebase credentials in source files. Use Vite environment variables only.

Required variables:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Rules:

- Keep real values in `.env.local` locally.
- Keep placeholders in `.env.example`.
- Never commit `.env.local`.
- For Cloudflare Pages, add the same variables in project environment settings.

## Firebase Requirements

Firebase project must have:

1. Authentication enabled.
2. Anonymous sign-in provider enabled.
3. Realtime Database created.
4. Realtime Database rules copied from `database.rules.json`.

The app expects authenticated anonymous users. Database writes should not be available to unauthenticated clients.

## Data Model

Rooms are stored under:

```text
rooms/{roomCode}
```

Expected room shape:

```js
{
  code: string,
  board: string,           // 42-character board string
  turn: 'R' | 'Y',
  status: 'waiting' | 'playing' | 'finished',
  winner: '' | 'R' | 'Y' | 'draw',
  winningLine: [[row, col]],
  createdAt: number,
  updatedAt: number,
  lastMove: {
    by: 'R' | 'Y',
    row: number,
    col: number,
    at: number
  },
  players: {
    red: {
      uid: string,
      name: string,
      online: boolean,
      joinedAt: number
    },
    yellow: {
      uid: string,
      name: string,
      online: boolean,
      joinedAt: number
    }
  }
}
```

Keep the board compact as a string to reduce database payload size.

## Game Logic Rules

Core game rules belong in `src/game.js`.

Preserve these invariants:

- Board is always 6 rows by 7 columns.
- Board string length is always 42.
- Empty cell is `.`.
- Red disc is `R`.
- Yellow disc is `Y`.
- Only the current player may move.
- Moves drop to the lowest available cell in a column.
- Finished rooms must not accept new moves.
- A move can only change board, turn, status, winner, winningLine, and lastMove.
- Winner detection must check horizontal, vertical, and both diagonal directions.

`src/game.js` should stay pure and framework-free where possible. Do not import React or Firebase there.

## Multiplayer Write Safety

Moves must be written with Firebase transactions, not plain overwrites.

Reason: two players can click at nearly the same time. A transaction ensures the move is applied to the latest room snapshot and prevents stale clients from overwriting the room.

When changing multiplayer behavior:

- Prefer `runTransaction` for state mutations that depend on current room state.
- Do not let a client write arbitrary room state directly from UI events.
- Keep validation close to `applyMoveToRoom` or a similarly pure function.
- Re-check player identity, current turn, room status, and column validity inside the transaction.

## Presence Rules

Presence should use Firebase `onDisconnect` where available.

Expected behavior:

- Player becomes `online: true` after joining/creating a room.
- Player becomes `online: false` on disconnect.
- Do not delete players on disconnect; keep room history stable.

## Security Notes

This is a client-authoritative MVP. It is acceptable for a private demo, study project, or game with friends.

Do not describe it as cheat-proof.

For a public ranked game, move authoritative validation to a server-side layer such as:

- Cloudflare Workers + Durable Objects
- a Node.js WebSocket server
- Colyseus
- another authoritative game server

Until then, Firebase rules can restrict broad access, but they cannot fully prove that every move is fair because the game logic runs in the browser.

## UI and Visual Direction

Keep the interface minimal, premium, and cinematic.

Follow these visual principles:

- Use a dark, polished, atmospheric aesthetic.
- Preserve generous whitespace and large rounded containers.
- Use nested card construction: outer shell plus inner core.
- Use subtle hairlines, ambient glow, and inset highlights instead of generic borders or harsh shadows.
- Use premium-feeling typography stacks. Do not use Arial, Roboto, Helvetica, Open Sans, or Inter as the primary visual identity.
- Avoid generic Bootstrap-like layouts.
- Buttons should feel physical: rounded pill shape, inner icon island when an icon is present, subtle press/hover transform.
- Motion should use custom cubic-bezier transitions, not default `linear` or `ease-in-out`.
- Animate only `transform` and `opacity` for interactive transitions.
- Avoid applying heavy blur to large scrolling containers.
- On mobile, collapse complex layouts into one column and keep touch targets comfortable.

When modifying `styles.css`, maintain the current design language instead of replacing it with a generic component-library look.

## Accessibility and UX

Maintain these UX expectations:

- Columns should be usable by keyboard or at least clear clickable buttons.
- Disabled columns must visually communicate that they cannot be played.
- Game status should be visible without relying only on color.
- Room code and invite link actions should be obvious.
- The UI must work on mobile widths.
- Avoid tiny tap targets on the game board.

## Code Style

General rules:

- Use ES modules.
- Prefer small pure helper functions.
- Use descriptive names.
- Keep game logic separate from UI and Firebase side effects.
- Avoid unnecessary dependencies.
- Avoid adding TypeScript migration unless explicitly requested.
- Do not introduce a backend unless explicitly requested.
- Do not add server-only secrets to frontend code.
- Keep user-facing strings in Russian unless the product direction changes.

React rules:

- Keep state derived where practical.
- Clean up Firebase listeners in `useEffect` return handlers.
- Avoid stale closures around `room`, `user`, and `roomCode` during writes.
- Show clear loading and configuration-missing states.

CSS rules:

- Prefer existing CSS custom properties and class patterns.
- Keep responsive behavior explicit.
- Do not add heavyweight animation libraries for small transitions.

## Testing Checklist Before Committing

Manual checks:

1. `npm run build` succeeds.
2. App opens without Firebase config and shows a useful setup message.
3. App opens with valid Firebase config.
4. User can create a room.
5. Second browser/incognito window can join the room.
6. Red moves first.
7. Players cannot move out of turn.
8. Full columns reject moves.
9. Horizontal win is detected.
10. Vertical win is detected.
11. Both diagonal wins are detected.
12. Draw is detected.
13. New round resets board correctly.
14. Refreshing the page keeps the player in the room when Firebase anonymous auth persists.
15. Invite link with `?room=CODE` opens the correct room.
16. Mobile layout remains usable.
17. Cloudflare Pages build output is `dist`.

Optional pure-logic checks can be run with a small Node script that imports `src/game.js` and verifies `dropDisc`, `detectWinner`, and `applyMoveToRoom`.

## Deployment Notes

Cloudflare Pages settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

Environment variables must be configured separately for production and preview deployments if previews are used.

## Agent Workflow

When making changes:

1. Understand whether the request affects UI, game rules, Firebase data, or deployment.
2. Keep changes minimal and localized.
3. Preserve the realtime transaction model for moves.
4. Preserve the premium visual system.
5. Run `npm run build` before finalizing.
6. Explain any Firebase rule or data model changes clearly.
7. Never invent credentials, project IDs, or deployment URLs.

## Known Limitations

- No accounts beyond Firebase anonymous auth.
- No matchmaking.
- No ranked leaderboard.
- No anti-cheat authoritative server.
- No room cleanup job.
- No spectator-specific UI beyond non-player room viewing behavior.

These limitations are acceptable for the current MVP. Add complexity only when the feature requires it.
