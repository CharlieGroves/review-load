# ReviewLoad privacy policy

_Last updated 12 October 2026_

ReviewLoad is a browser extension that shows, inside GitHub's reviewer picker, how many open pull requests are waiting on each person's review.

## What it stores

- **Your GitHub token**, which you paste into the options page. It is kept in the browser's local extension storage (`storage.local`), on your device only. It is not synced to other devices and is not encrypted at rest. You can remove it at any time from the options page, and uninstalling the extension deletes it.
- **Your settings**: scope, colour thresholds, and the team-request, hover and demo toggles, stored in the same place.
- **A short-lived cache** of review counts and pull request titles, and whether you were found signed out of GitHub, kept in session storage for up to 5 minutes so that reopening the picker doesn't repeat requests. The browser clears it when it closes.

## What it sends, and where

ReviewLoad sends requests only to GitHub:

- **With a token saved**, to GitHub's API at `api.github.com`, authenticated with your token.
- **Without a token**, to GitHub's pull request dashboard at `github.com/pulls`, using the GitHub session you're already signed in with. These requests are made from the GitHub tab you have open. ReviewLoad never reads, stores or sends your session cookies itself; the browser attaches them as it does for any GitHub page.

Either way, the requests contain GitHub search queries for the people shown in the reviewer picker, for example `user-review-requested:<login>`, and the number of the pull request you're viewing.

Nothing is sent to the developer of ReviewLoad or to any third party. There is no analytics, telemetry, error reporting or advertising, and no remote code is loaded.

## What it reads on GitHub pages

On github.com pull request pages, ReviewLoad reads the logins shown in the Reviewers sidebar and menu so it can draw a count next to each one. It reads nothing else from the page.

## Your data is not sold or shared

ReviewLoad does not sell, transfer or use any data for any purpose other than showing review counts to you. Its use of data follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

Open an issue at https://github.com/CharlieGroves/review-load/issues.
