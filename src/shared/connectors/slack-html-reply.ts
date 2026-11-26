import { splitHtmlDocumentFences } from '../markdown/html-document-fences'
import { redactLocalPaths } from './slack-local-paths'

/** Keep the whole reply inline if Slack's text formatter would change any page. */
export function splitSlackHtmlReply(text: string): { text: string; documents: string[] } | null {
  const split = splitHtmlDocumentFences(text)
  return split.documents.length > 0 &&
    split.documents.every((document) => redactLocalPaths(document) === document)
    ? split
    : null
}
