# Dashboard Visual System Refresh — Follow-up

This follow-up refresh applies the dashboard's warm restaurant visual language more consistently across the frontend while preserving existing functionality and data flows.

## Visual system alignment

- Primary interactive accent standardized from blue to orange across frontend screens.
- Shared application surfaces now use the dashboard's warm off-white background.
- Common light borders use a subtle warm orange tint.
- Navigation, buttons, focus states, selected states and primary links follow the orange accent.
- Dark mode remains intact with the existing charcoal surfaces and contrast behavior.
- Semantic success, warning and error colors remain distinct for operational clarity.

## Dashboard additions

### Circular status charts

- **Table status** now uses a multi-segment circular chart for available, occupied, reserved, cleaning and out-of-service tables.
- **Menu availability** now uses a circular availability chart with active/unavailable counts and a menu-health percentage.

### Service pulse

The previous simple recent-activity card has been replaced with a compact operational pulse containing:

- Active orders currently in the workflow.
- Low-stock items requiring attention.
- A lightweight seven-day order-activity mini chart derived from existing dashboard trend data.

No database reset or schema change is required for this visual refresh.
