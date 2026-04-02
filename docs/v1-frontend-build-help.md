  ### Frontend Build Order
  
  1. Layout shell — three-pane skeleton (sidebar, chat, visibility) with placeholder content and collapse/expand toggles. All other sections are built        inside this container.                                                                                                                                      2. Sidebar — fills the left pane. No dependency on other sections; establishes conversation list + New Chat button early.                                   3. Top bar — fills the chat pane header. Comes before messages so the provider/model controls exist when we start testing the chat flow.                  
  4. Chat input + empty state — bottom of the chat pane plus the "no messages" welcome view. Simpler than messages; establishes the input pattern before the
   complex message rendering.
  5. Chat messages — user bubbles + assistant message blocks (thinking indicator, tool steps, summary indicator, markdown, footer metadata, inspect button).
   Most complex section; built last in the chat pane so the surrounding shell is already in place.
  6. Visibility pane shell — tab bar (7 tabs) + persistent footer. Fills the right pane structurally before any tab content exists.
  7. Visibility pane — simple tabs — Response Metadata, Token Counts, Reasoning Content, Summary Event, Config. All are data-display only; no complex custom
   rendering.
  8. Visibility pane — complex tabs — Request Payload (collapsible JSON viewer with auto-collapse on long strings) and Tool Trace (timeline stepper with    
  expandable step data). Saved for last because both require non-trivial custom components.

  ### ShadCN 

  Here's my component inventory by section, followed by one install run:

  Layout shell: sidebar (SidebarProvider + SidebarInset wraps entire app), button, separator
  Sidebar: sidebar, scroll-area, context-menu, dropdown-menu, alert-dialog, tooltip, badge, input
  Top bar: select, separator, tooltip, badge, button, progress
  Chat input + empty state: textarea, button, empty
  Chat messages: scroll-area, collapsible, badge, button, spinner, alert, skeleton, tooltip
  Visibility pane shell: tabs, scroll-area, separator
  Visibility simple tabs: badge, collapsible, empty, skeleton, spinner
  Visibility complex tabs: collapsible, accordion, badge, spinner

  Unique install list (20 components): button, badge, separator, scroll-area, sidebar, context-menu, dropdown-menu, alert-dialog, tooltip, select, textarea,     
   input, empty, collapsible, alert, skeleton, spinner, tabs, accordion, progress