export type BrowserLinkOpeningSettings = {
  /** Links from Orca surfaces join the browser without taking focus from the pane they came from. */
  openLinksInAppInBackground?: boolean
  /** Links open as a tab in their source group instead of a split; off keeps the split layout. */
  openLinksInTab?: boolean
}
