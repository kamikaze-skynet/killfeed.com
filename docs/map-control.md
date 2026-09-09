# Map Control

Switch a Nitrado DayZ server between **Chernarus**, **Livonia** and **Sakhal**
without opening the Nitrado panel. Available from Discord (`/map change`) and
from the **Map** tab on the website dashboard.

This feature ships with the SkyNet Killfeed bot and website
(`module/map_control.py`, `website/mapRoutes.js` in the
[SkyNet-Killfeed](https://github.com/kamikaze-skynet/SkyNet-Killfeed) repository).

## Choose who is allowed

Server owners and Discord administrators can always change the map. To let
other staff do it, add their role:

```
/map roles add @Map Managers
```

The same role list drives the dashboard Map tab, so a member with that role can
switch maps from Discord or the website. Remove with `/map roles remove`, review
with `/map roles list`.

## Change the map

**Discord**

```
/map change server:<your server> map:Sakhal restart:True
```

**Website** — open the dashboard, pick the server, open the **Map** tab, click
the map, choose whether to restart now, and confirm.

Nitrado loads the new map on the next restart. With *restart* on (the default)
the bot restarts the server immediately, so everyone online is disconnected.

## See what happened

- `/map current` shows the configured map, the map running right now and the
  server status.
- `/map history` (and the Map tab) list recent changes: who, from → to,
  whether a restart was sent, and whether it came from Discord or the website.

## Notes

- The change edits Nitrado's `config.mission` setting only. Mods, mission files
  and the FTP layout are untouched.
- The website needs the bot token configured (`DISCORD_BOT_TOKEN`) to honour
  Discord roles; without it only the server owner and dashboard admins can
  change maps from the site.

Full technical reference: `docs/MAP_CONTROL.md` in the bot repository.
