# Self-Service Whitelist Panel

Let players whitelist themselves. Staff post one button panel per server in
Discord; a player presses **Whitelist Me**, types their gamertag into the
pop-up (or uses their `/link`-ed gamertag), and the bot adds them to that
server's Nitrado whitelist.

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
4. Optionally pick a mode, a title, description, button label, a role to grant
   once a player is whitelisted, a staff log channel, and how many gamertags
   each member may hold.

That's it. The panel keeps working through bot restarts, and re-running
`/whitelistpanel create` for the same server replaces the old message.

## Modes

| Mode | What players do |
|---|---|
| `manual` (default) | Type their gamertag into the pop-up. |
| `linked` | Press one button; the bot uses the gamertag they linked with `/link`. Nobody can type a friend's name. |
| `both` | Two buttons on the panel, one of each. |

## For players

1. Press the button.
2. Enter your exact in-game gamertag (or confirm your linked one).
3. You get a private confirmation (and the granted role, if staff set one).

By default each member holds one gamertag per server. Pressing the button
again with a different gamertag replaces the old entry, so one account cannot
whitelist a pile of friends. Staff can raise the limit or turn replacements
off.

## Owner controls

Change them any time with `/whitelistpanel settings` (run it with no options
to see the current values):

- `max_per_user` — gamertags one Discord account may hold (1–10).
- `allow_changes` — whether a new submission replaces the oldest gamertag, or
  is refused so staff must use `/whitelistpanel reset`.
- `cooldown_seconds` — minimum gap between a member's submissions.
- `/whitelistpanel autorole` — members holding a role get their linked
  gamertag whitelisted automatically; `/whitelistpanel sync` applies it to
  everyone who already holds the role.
- `auto_remove_on_role_loss` and `remove_on_leave` — take gamertags back off
  the whitelist when the member loses the role or leaves the Discord.

## Managing panels

| Command | Purpose |
|---|---|
| `/whitelistpanel list` | Every panel in your Discord, with jump links and settings |
| `/whitelistpanel remove` | Delete a panel |
| `/whitelistpanel requests` | Who whitelisted themselves, with which gamertag and how |
| `/whitelistpanel reset` | Remove one member's self-service gamertags |

## Safeguards

- Gamertags are validated so a submission can never smuggle extra lines into
  the whitelist.
- Cooldown per member, plus the per-member gamertag limit you choose.
- Linked mode ties the whitelist entry to the player's `/link`-ed account.
- Every request is logged, and can be mirrored to a staff channel.

Full technical reference: `docs/WHITELIST_PANEL.md` in the bot repository.
