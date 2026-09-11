export class GenericAdapter {
  name = "web";
  selector = "";
  identity(url = location.href) {
    const u = new URL(url);
    u.hash = "";
    return `${this.name}:${u.href}`;
  }
  root(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return (this.selector && el?.closest(this.selector)) || document.body;
  }
  messageId(root) {
    return root === document.body
      ? null
      : root.getAttribute("data-message-id") || root.id || null;
  }
  roots() {
    return this.selector
      ? [...document.querySelectorAll(this.selector)]
      : [document.body];
  }
}
const providerRoutes = [
  {
    name: "chatgpt",
    hosts: /^(chatgpt\.com|chat\.openai\.com)$/,
    paths: [/\/c\/([^/]+)/],
  },
  { name: "claude", hosts: /^claude\.ai$/, paths: [/\/chat\/([^/]+)/] },
  { name: "gemini", hosts: /^gemini\.google\.com$/, paths: [/\/app\/([^/]+)/] },
  {
    name: "deepseek",
    hosts: /^chat\.deepseek\.com$/,
    paths: [/\/(?:a\/)?chat\/s\/([^/]+)/],
  },
];

function providerRoute(url) {
  const parsed = new URL(url);
  const provider = providerRoutes.find((item) =>
    item.hosts.test(parsed.hostname),
  );
  if (!provider) return null;
  for (const pattern of provider.paths) {
    const match = parsed.pathname.match(pattern);
    if (match?.[1]) return { name: provider.name, id: match[1] };
  }
  return { name: provider.name, id: null };
}

export function stableConversationIdentity(url) {
  try {
    const match = providerRoute(url);
    return match?.id ? `${match.name}:conversation:${match.id}` : null;
  } catch {
    return null;
  }
}

export class ChatGPTAdapter extends GenericAdapter {
  name = "chatgpt";
  selector = "[data-message-id]";
  identity(url = location.href) {
    const parsed = new URL(url);
    return (
      stableConversationIdentity(url) ||
      `${this.name}:${parsed.origin}${parsed.pathname}`
    );
  }
}
export class ClaudeAdapter extends ChatGPTAdapter {
  name = "claude";
  selector =
    '[data-message-id], [data-testid="user-message"], .font-claude-response';
}
export class GeminiAdapter extends ChatGPTAdapter {
  name = "gemini";
  selector = "user-query, model-response";
}
export class DeepSeekAdapter extends ChatGPTAdapter {
  name = "deepseek";
  selector = "[data-message-id]";
}
export function adapterFor(url = location.href) {
  let provider;
  try {
    provider = providerRoute(url)?.name;
  } catch {
    return new GenericAdapter();
  }
  return provider === "chatgpt"
    ? new ChatGPTAdapter()
    : provider === "claude"
      ? new ClaudeAdapter()
      : provider === "gemini"
        ? new GeminiAdapter()
        : provider === "deepseek"
          ? new DeepSeekAdapter()
          : new GenericAdapter();
}
