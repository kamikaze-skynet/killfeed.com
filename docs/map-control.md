# Map Control

Switch a Nitrado DayZ server between **Chernarus**, **Livonia** and **Sakhal**
without opening the Nitrado panel. Available from Discord (`/changemap`) and
from the **Map** tab on the website dashboard.

This feature ships with the SkyNet Killfeed bot and website
(`module/change_map.py`, `website/mapRoutes.js` in the
[SkyNet-Killfeed](https://github.com/kamikaze-skynet/SkyNet-Killfeed) repository).

## Choose who is allowed

Anyone holding the ADMIN permission level (`/permissions set ADMIN @role`)
can change maps, and guild owners always can. To let other staff do it without
giving them full admin power, add their role to the map list:

```
/maproles add @Map Managers
```

The same role list drives the dashboard Map tab, so a member with that role can
switch maps from Discord or the website. Remove with `/maproles remove`, review
with `/maproles list`.

## Change the map

**Discord**

```
/changemap server:<your server> map:Sakhal restart:True
```

The bot shows what will change and asks you to confirm before touching the
server.

**Website** — open the dashboard, pick the server, open the **Map** tab, click
the map, choose whether to restart now, and confirm.

Nitrado loads the new map on the next restart. With *restart* on (the default)
the bot restarts the server immediately, so everyone online is disconnected.

## See what happened

The Map tab lists recent changes: who, from → to, whether a restart was sent,
and whether it came from Discord or the website. Discord changes are also
written to the bot's command log.

## Notes

- The change edits Nitrado's `config.mission` setting only. Mods, mission files
  and the FTP layout are untouched.
- The website needs the bot token configured (`DISCORD_BOT_TOKEN`) to honour
  Discord roles; without it only the server owner and dashboard admins can
  change maps from the site.

Full technical reference: `docs/CHANGE_MAP.md` in the bot repository.
