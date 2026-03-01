# PiggyBank TODO List

## High Priority

- [ ] Implement a consistent debugging and logging library
  - Replace print statements with structured logging
  - Add log levels (debug, info, warning, error)
  - Consider using OSLog for better integration with Console.app
  - Make debug logs easily filterable

## Medium Priority

- [ ] Implement proper theming system
  - Create consistent color palette (soft pastels for kids)
  - Define typography scale with rounded, legible fonts
  - Add consistent spacing and sizing tokens
  - Implement dark/light mode support
  - Create reusable design tokens/constants

- [ ] Improve error handling in PiggyBankListView
  - Show user-friendly error messages instead of console prints
  - Add retry functionality for data loading

## Low Priority

- [ ] Generate actual Pixar-style avatar images for kids
- [ ] Add more test data scenarios

## Completed

- [x] Create initial PiggyBank list screen
- [x] Implement Kid data model
- [x] Create AvatarView component
- [x] Add fallback avatars with initials