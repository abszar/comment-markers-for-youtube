# Chrome Web Store listing — copy/paste

Everything below is ready to paste into the Developer Dashboard fields.
Replace `abszar` with your GitHub username where it appears.

---

## Store listing tab

**Item name** (45 char max)

```
Comment Markers for YouTube
```

**Short description** (132 char max — this is what shows in search results)

```
Marks the moments people mention in YouTube comments on the video timeline, and shows each comment as you reach it.
```

**Detailed description**

```
The best moment in a long video is usually named in the comments — and the comments are the one place you can't see while you're watching.

Comment Markers reads the comments of the video you're on, finds every timestamp people mention (1:23, 01:23, 1:02:03), and marks those moments on the player's progress bar. As the video plays, each comment appears when playback reaches the moment it's talking about, the way comments appear on a SoundCloud waveform.

WHAT YOU GET

• Ticks on the progress bar for every moment the comments refer to. Taller ticks mean several people mentioned that spot.
• Hover the timeline to read every comment for that moment, stacked in one card above YouTube's own preview thumbnail — the preview keeps working exactly as before.
• While playing, comments pop up on their own and fade after a few seconds. Pause and the comment stays up as long as you need it; press play and it clears.
• Optional commenter avatars floating above each marker, at whatever size suits you.
• Comments are loaded for you — no scrolling to the comment section first.

MADE TO STAY OUT OF THE WAY

Markers never capture your mouse, so scrubbing feels exactly like normal YouTube. Comments that dump a whole chapter list are drawn fainter so they don't drown out real reactions. When several people mention the same second, the most-liked comment leads and the rest are one hover away.

SETTINGS

Marker colour, avatar size, popup duration and position, how many comments to scan, a minimum-likes filter, and a master on/off. Settings save as you change them.

PRIVACY

No data collection. No analytics. No servers. The extension talks only to YouTube, from the page you already have open. Your settings stay in your browser.

Open source under the MIT licence: https://github.com/abszar/comment-markers-for-youtube

Not affiliated with, endorsed by, or sponsored by YouTube or Google LLC.
```

**Category:** Entertainment
**Language:** English

**Screenshots:** upload `store/screenshot-1.png`, `store/screenshot-2.png` and `store/screenshot-3.png` (all 1280×800)

1. Timeline markers and a comment popping up during playback
2. Hovering the timeline, comment card above YouTube's own preview
3. The settings page

**Official URL / homepage:** `https://abszar.github.io/comment-markers-for-youtube/`
**Support URL:** `https://github.com/abszar/comment-markers-for-youtube/issues`

---

## Privacy tab

**Single purpose** (one sentence — reviewers read this closely)

```
Displays the timestamps mentioned in a YouTube video's comments as markers on that video's timeline, and shows the associated comment when playback reaches it.
```

**Permission justification — storage**

```
Stores the user's own display preferences (marker colour, avatar size, popup duration and position, scan limits). No user content or browsing data is stored.
```

**Permission justification — host permission (https://www.youtube.com/*)**

```
The extension reads the public comments of the YouTube video the user is watching in order to extract timestamps, and injects markers and comment cards into that video's player. It runs on no other website.
```

**Data usage — tick nothing.** The extension collects none of the listed categories.
Then certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://abszar.github.io/comment-markers-for-youtube/privacy.html
```

---

## Notes for the review

Nothing here needs to be submitted, but if a reviewer asks:

- No remote code is executed. All JavaScript ships inside the package.
- `src/inject.js` runs in the main world only to read YouTube's own `ytcfg`
  configuration object so the extension can request the comment list through
  YouTube's own endpoint from the user's existing session.
- There is a DOM-scraping fallback so the extension degrades gracefully rather
  than breaking if that endpoint changes.
