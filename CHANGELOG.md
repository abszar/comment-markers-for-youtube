# Changelog

## 1.2.0

- Comments now show their YouTube like count, formatted 1.2K / 12K / 1.2M
- Fixed like counts being misread on non-English YouTube: "1,2 k" was parsed
  as 12000 instead of 1200, which scrambled the most-liked-first ordering
- Ties in like count now fall back to the earlier timestamp, so the order of
  the avatar tabs is stable

## 1.1.1

- Fixed the playing popup jumping when switching between comments of
  different lengths at the same timestamp

## 1.1.0

- New icon: a comment bubble dropping onto the video timeline
- Settings page and toolbar popup now show the icon in their header
- Redrawn store icon and promo tiles to match

## 1.0.0

First public release.

- Timestamps from comments marked as ticks on the YouTube progress bar
- Nearby timestamps grouped into one marker; most-liked comment leads
- Hover the timeline to read every comment for that moment, stacked
- SoundCloud-style popups during playback, frozen while paused
- Optional commenter avatars on the timeline, size adjustable
- Settings page: colour, avatars, popup behaviour, scan depth, filters
- Comments fetched through YouTube's own endpoint, with a DOM fallback
