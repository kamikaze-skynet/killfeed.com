# Self-Service Whitelist Panel

Let players whitelist themselves. Staff post one button panel per server in
Discord; a player presses **Whitelist Me**, types their gamertag into the
pop-up, and the bot adds them to that server's Nitrado whitelist.

This feature ships with the SkyNet Killfeed bot
(`module/whitelist_panel.py` in the
[SkyNet-Killfeed](https://github.com/kamikaze-skynet/SkyNet-Killfeed) repository).

## Set it up

1. Make sure the server is linked with `/settup` so the bot has its Nitrado
   token.
2. Give the staff who will manage panels the ADMIN permission level if they
   don't have it: `/permissions set ADMIN @role`. Guild owners always pass.
3. Run **`/whitelistpanel create`**, choose the server and the channel the
   panel should live in.
4. Optionally set a title, description, button label, a role to grant once a
   player is whitelisted, and a staff log channel.

That's it. The panel keeps working through bot restarts, and re-running
`/whitelistpanel create` for the same server replaces the old message.

## For players

1. Press the button.
2. Enter your exact in-game gamertag.
3. You get a private confirmation (and the granted role, if staff set one).

Each member holds one gamertag per server. Pressing the button again and
entering a different gamertag replaces the old entry, so one account cannot
whitelist a pile of friends.

## Managing panels

| Command | Purpose |
|---|---|
| `/whitelistpanel list` | Every panel in your Discord, with jump links |
| `/whitelistpanel remove` | Delete a panel |
| `/whitelistpanel requests` | Who whitelisted themselves, with which gamertag |

## Safeguards

- Gamertags are validated so a submission can never smuggle extra lines into
  the whitelist.
- 30-second cooldown per member.
- One gamertag per member per server; resubmitting replaces it.
- Every request is logged, and can be mirrored to a staff channel.

Full technical reference: `docs/WHITELIST_PANEL.md` in the bot repository.
