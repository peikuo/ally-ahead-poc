import { Marked, type MarkedToken, type Token } from "marked";
import markedCjkFriendly from "marked-cjk-friendly";

// Visual output and speech share a mature Markdown parser, including GFM/CJK.
const markdown = new Marked({ gfm: true, breaks: true }, markedCjkFriendly());
export function markdownTokens(source: string) {
  return markdown.lexer(source);
}

export function decodeCharacterReferences(text: string): string {
  // Only an individual reference reaches this detached textarea, never HTML.
  // React escapes the resulting characters again when displaying them.
  return text.replace(
    /&(?:#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][\da-zA-Z]+);/g,
    (reference) => {
      const decoder = document.createElement("textarea");
      decoder.innerHTML = reference;
      return decoder.value;
    },
  );
}

export function safeMarkdownHref(href: string): string | undefined {
  try {
    const url = new URL(
      decodeCharacterReferences(href).trim(),
      window.location.href,
    );
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function markdownTokensToSpeech(tokens: readonly Token[]): string {
  return tokens
    .map((value) => {
      const token = value as MarkedToken;
      switch (token.type) {
        case "heading":
        case "paragraph":
        case "blockquote":
          return `\n${markdownTokensToSpeech(token.tokens)}\n`;
        case "strong":
        case "em":
        case "del":
        case "link":
        case "image":
          return markdownTokensToSpeech(token.tokens);
        case "list":
          return `\n${token.items
            .map(
              (item, index) =>
                `${token.ordered ? `${Number(token.start) + index}. ` : ""}${markdownTokensToSpeech(item.tokens).trim()}`,
            )
            .join("\n")}\n`;
        case "list_item":
          return `${markdownTokensToSpeech(token.tokens)}\n`;
        case "table":
          return `\n${[token.header, ...token.rows]
            .map((row) =>
              row.map((cell) => markdownTokensToSpeech(cell.tokens)).join("；"),
            )
            .join("\n")}\n`;
        case "text":
          return token.tokens
            ? markdownTokensToSpeech(token.tokens)
            : decodeCharacterReferences(token.text);
        case "escape":
        case "codespan":
          return token.text;
        case "code":
          return `\n${token.text}\n`;
        case "br":
        case "space":
        case "hr":
          return "\n";
        // Raw HTML, link definitions and checkbox syntax are not spoken.
        default:
          return "";
      }
    })
    .join("");
}

export function markdownToSpeech(source: string): string {
  return markdownTokensToSpeech(markdownTokens(source))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
