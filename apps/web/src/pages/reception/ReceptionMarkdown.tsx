import { Fragment, useMemo, type ReactNode } from "react";
import type { MarkedToken, Token } from "marked";
import {
  decodeCharacterReferences,
  markdownTokens,
  markdownTokensToSpeech,
  safeMarkdownHref,
} from "./markdown";

function renderTokens(
  tokens: readonly Token[],
  allowLinks: boolean,
): ReactNode {
  return tokens.map((value, index) => {
    const token = value as MarkedToken;
    let content: ReactNode;
    switch (token.type) {
      case "heading": {
        // Message headings sit under the page and section titles.
        const Heading =
          token.depth <= 2 ? "h3" : token.depth === 3 ? "h4" : "h5";
        content = <Heading>{renderTokens(token.tokens, allowLinks)}</Heading>;
        break;
      }
      case "paragraph":
        content = <p>{renderTokens(token.tokens, allowLinks)}</p>;
        break;
      case "blockquote":
        content = (
          <blockquote>{renderTokens(token.tokens, allowLinks)}</blockquote>
        );
        break;
      case "strong":
        content = <strong>{renderTokens(token.tokens, allowLinks)}</strong>;
        break;
      case "em":
        content = <em>{renderTokens(token.tokens, allowLinks)}</em>;
        break;
      case "del":
        content = <del>{renderTokens(token.tokens, allowLinks)}</del>;
        break;
      case "code":
        content = (
          <pre>
            <code>{token.text}</code>
          </pre>
        );
        break;
      case "codespan":
        content = <code>{token.text}</code>;
        break;
      case "br":
        content = <br />;
        break;
      case "hr":
        content = <hr />;
        break;
      case "list": {
        const List = token.ordered ? "ol" : "ul";
        content = (
          <List start={token.ordered ? Number(token.start) : undefined}>
            {token.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {item.task ? (
                  <input
                    type="checkbox"
                    checked={Boolean(item.checked)}
                    disabled
                    aria-label={markdownTokensToSpeech(item.tokens).trim()}
                  />
                ) : null}
                {renderTokens(item.tokens, allowLinks)}
              </li>
            ))}
          </List>
        );
        break;
      }
      case "table":
        content = (
          <div
            className="reception-markdown-table"
            tabIndex={0}
            role="region"
            aria-label="表格 / Table"
          >
            <table>
              <thead>
                <tr>
                  {token.header.map((cell, i) => (
                    <th
                      key={i}
                      scope="col"
                      style={{ textAlign: cell.align ?? undefined }}
                    >
                      {renderTokens(cell.tokens, allowLinks)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {token.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        style={{ textAlign: cell.align ?? undefined }}
                      >
                        {renderTokens(cell.tokens, allowLinks)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        break;
      case "link": {
        const href = allowLinks ? safeMarkdownHref(token.href) : undefined;
        content = href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {renderTokens(token.tokens, allowLinks)}
          </a>
        ) : (
          renderTokens(token.tokens, allowLinks)
        );
        break;
      }
      // Images retain their description without making a network request.
      case "image":
        content = <span>{renderTokens(token.tokens, allowLinks)}</span>;
        break;
      case "text":
        content = token.tokens
          ? renderTokens(token.tokens, allowLinks)
          : decodeCharacterReferences(token.text);
        break;
      case "escape":
        content = token.text;
        break;
      // Raw HTML never reaches a DOM parser or live element.
      default:
        content = null;
    }
    return <Fragment key={index}>{content}</Fragment>;
  });
}

export function ReceptionMarkdown({
  text,
  className = "",
  allowLinks = true,
}: {
  text: string;
  className?: string;
  allowLinks?: boolean;
}) {
  const tokens = useMemo(() => markdownTokens(text), [text]);
  return (
    <div className={`reception-markdown ${className}`.trim()}>
      {renderTokens(tokens, allowLinks)}
    </div>
  );
}
