export class GenericAdapter {
  name = 'web';
  selector = '';
  identity(url = location.href) { const u = new URL(url); u.hash = ''; return `${this.name}:${u.href}`; }
  root(node) { const el = node?.nodeType === 1 ? node : node?.parentElement; return (this.selector && el?.closest(this.selector)) || document.body; }
  messageId(root) { return root === document.body ? null : root.getAttribute('data-message-id') || root.id || null; }
  roots() { return this.selector ? [...document.querySelectorAll(this.selector)] : [document.body]; }
}
export class ChatGPTAdapter extends GenericAdapter {
  name = 'chatgpt'; selector = '[data-message-id]';
  identity(url = location.href) { const u = new URL(url); return `${this.name}:${u.origin}${u.pathname}`; }
}
export class ClaudeAdapter extends ChatGPTAdapter {
  name = 'claude'; selector = '[data-message-id], [data-testid="user-message"], .font-claude-response';
}
export class GeminiAdapter extends ChatGPTAdapter {
  name = 'gemini'; selector = 'user-query, model-response';
}
export function adapterFor(url = location.href) {
  const host = new URL(url).hostname;
  return /^(chatgpt\.com|chat\.openai\.com)$/.test(host) ? new ChatGPTAdapter() : host === 'claude.ai' ? new ClaudeAdapter() : host === 'gemini.google.com' ? new GeminiAdapter() : new GenericAdapter();
}
