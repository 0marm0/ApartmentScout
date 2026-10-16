# Security policy

ApartmentScout runs on your own machine over files in your own folder. It has no server, accounts or API keys, but it does read
public web data, write files, and publish a static site, so a flaw can still matter (for example a way to leak a private
search into a published page, a path traversal in `apartmentscout serve`, or a script injection through listing data).

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. Open the repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting).
2. Say what you found, how to reproduce it (the command, the page or the data file), which version or commit, and what an attacker
   could do with it.

You should get a first reply within a week. We will confirm the problem, work out a fix with you, and credit you in the release
notes if you want that. Please give us a reasonable time to fix it before you share details.

If the Security tab does not show **Report a vulnerability**, open a public issue that says only "I need to report a security
problem privately" and nothing else, and a maintainer will contact you.

## What not to include in a report or any issue

- **No secrets.** Never paste API keys, tokens, passwords, cookies or session data, yours or anyone else's.
- **No personal data.** Do not attach a renter's `criteria.yaml`, a `searches/` folder, saved picks, visit notes, photos or
  anything with a home address, income or identity. A short made-up example that shows the problem is better.
- **No private listing data.** Listing photos and descriptions belong to their owners.

If you find that a secret or private file is already in the repository or its history, report it the same private way so it can be
removed and rotated.

## Supported versions

Only the latest commit on `main` and the live demo are supported. There are no long-lived release branches.

## Scope

In scope: the Python package and CLI, the dashboard and landing page (`dashboard/`, `landing/`), the build and publish scripts
(`scripts/`), and the GitHub workflows.

Out of scope: vulnerabilities in third-party services this project reads (listing portals, NYC Open Data, OpenStreetMap, transit
agencies, map tile hosts), in a dependency (report it upstream, and tell us if we should update), and findings that need the
attacker to already control your machine or your search folder.

## What ApartmentScout does about portals

It never bypasses CAPTCHAs or bot checks, never logs in for you, and never sends messages on your behalf. A report that it can be
made to do so is a security report.
