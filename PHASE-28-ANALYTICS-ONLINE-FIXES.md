# Phase 28 — Analytics & Online Ordering Fixes

## Completed

- Fixed the Dashboard **Sales Performance** chart so it is driven by completed sales rather than payment timestamps.
- Fixed the Advanced Analytics **Sales Trend** chart using the same completed-sale source, keeping both charts consistent with the dashboard sales totals.
- Fixed date bucketing to use local calendar dates instead of UTC date slicing, preventing sales from appearing on the wrong day.
- Dashboard trend order counts now count completed sales only.
- Added a light/dark mode toggle to the public **Order Online** page. The setting uses the same `rms-theme` local-storage preference as the staff application.
- Added dark-theme styling to the most visible public-ordering controls and states.

## Validation

The modified TypeScript/TSX files were syntax-checked successfully. A full dependency build could not be completed in the isolated build environment because the extracted project did not contain a complete installed dependency tree; run `npm install` in the project before local build/testing.
