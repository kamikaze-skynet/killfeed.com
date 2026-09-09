# Self-Service Whitelist Panel

Let players whitelist themselves. Staff post one button panel per server in
Discord; a player presses **Whitelist me**, types their gamertag into the
pop-up, and the bot adds them to that server's Nitrado whitelist.

This feature ships with the SkyNet Killfeed bot
(`module/whitelist_panel.py` in the
[SkyNet-Killfeed](https://github.com/kamikaze-skynet/SkyNet-Killfeed) repository).

## Set it up

1. Make sure the server is linked with `/settup` so the bot has its Nitrado
   token.
2. Run **`/whitelistpanel create`**, choose the server and the channel the
   panel should live in.
3. Optionally set a title, description, button label, a role players must
   hold, whether only `/link`-ed gamertags are accepted, how many gamertags each
   member may whitelist, and a staff log channel.

That's it. The panel keeps working through bot restarts, and re-running
`/whitelistpanel create` for the same server replaces the old message.

## For players

1. Press the button.
2. Enter your exact in-game gamertag.
3. You'll get a private confirmation. You can join after the next server
   restart.

## Managing panels

| Command | Purpose |
|---|---|
| `/whitelistpanel list` | Every panel in your Discord |
| `/whitelistpanel toggle` | Pause or resume a panel |
| `/whitelistpanel remove` | Delete a panel |
| `/whitelistpanel requests` | Recent submissions and their results |

## Safeguards

- Gamertags are validated; commas and line breaks are rejected so nobody can
  slip extra names in.
- 30-second cooldown per member, plus a per-member limit you choose.
- Optional **linked accounts only** mode: the gamertag must match the player's
  `/link`-ed name.
- Every request is logged, and can be mirrored to a staff channel.

Full technical reference: `docs/WHITELIST_PANEL.md` in the bot repository.
