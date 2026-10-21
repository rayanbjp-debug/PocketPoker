# PocketPoker

A party-based Texas Hold'em web game with fake chips. 3 to 10 players, a bot dealer, a round table, and a hand-ranking guide on top of the page. Whoever wins the most hands wins the game.

## Run it

```
npm install
npm start
```

Open http://localhost:3000. One player creates a party and shares the 4-letter code (or the invite link); everyone else opens the same address and joins. For friends on other networks, deploy it anywhere that runs Node 18+ (Render, Railway, Fly.io, a VPS). It needs WebSocket support and a single instance, because parties live in memory. Set `PORT` if your host asks for it.

## How a game works

- **Host settings:** starting chips, rebuy chips, rebuys per player, turn timer, blind increase (%) and how often (every N hands), and game length (a number of hands or a time limit).
- **Blinds:** big blind is 1% of the starting chips, small blind is half of that. They rise by the host's percentage every N hands. The dealer button moves clockwise each hand; seats are random only on the first hand.
- **Betting:** standard no-limit Hold'em. Side pots, split pots and odd chips are handled by the dealer bot.
- **Scoring:** a hand counts for whoever wins the main pot (+1, or +0.5 each when split). The player with the most hands wins; the party keeps a tally of game wins until everyone leaves.
- **Busting and rebuying:** a player with no chips spectates until the hand ends, then can rebuy (up to the host's limit) or keep watching.
- **Late joiners:** join between hands, get the rebuy amount, sit immediately left of the dealer (everyone else shifts clockwise) and start with 0 rebuys used.
- **Disconnects:** the player keeps their chips and is auto-checked when checking is free. Facing a bet they fold and become a spectator. After 5 minutes offline they sit out; after 15 minutes they are removed, and rejoining makes them a new player.
- **Fewer than 3 players:** play stops and the host chooses to end the game or wait.
- **Host powers:** change settings, start the game, mute and remove players. If the host leaves, the earliest-joined remaining player becomes host.

## Files

```
server/cards.js    deck, shuffling, hand evaluation
server/pots.js     main and side pots, payouts
server/party.js    parties, seating, betting, timers, disconnects, rebuys
server/index.js    HTTP + WebSocket server
public/            the browser game (index.html, app.js, art.js, style.css)
test/              unit tests, engine simulation, browser tests
```

## Tests

```
npm test                     # hand ranking, pots, blinds, and 60 randomized full games
npm start &                  # then, with Playwright installed:
node test/e2e.js             # six real browsers play a full game
node test/e2e10.js           # ten players plus a refused eleventh
node test/e2e-resume.js      # reload, mute, kick, leave
```

The server deals and shuffles with Node's `crypto`, and each browser only ever receives its own hole cards until showdown.
