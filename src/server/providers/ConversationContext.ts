type ConversationTurn = { role: string; content: string };
type UserMemory = { kind?: string; text?: string; tags?: string[] };

export interface PreparedConversationContext {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  memoryContext: string;
}

/** Prepare bounded model context from conversation turns and already owner-scoped memories. */
export function prepareConversationContext(
  prompt: string,
  messages: ConversationTurn[],
  authorizedMemories: UserMemory[],
): PreparedConversationContext {
  const last = messages[messages.length - 1];
  const previousMessages = last?.role === 'user' && last.content.trim() === prompt.trim()
    ? messages.slice(0, -1)
    : messages;

  const history = previousMessages
    .slice(-8)
    .filter((message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content.trim().slice(0, 800),
    }));

  const stopWords = new Set([
    'about', 'after', 'again', 'before', 'being', 'could', 'should', 'their',
    'there', 'these', 'those', 'think', 'would', 'where', 'which', 'while',
    'what', 'when', 'with', 'from', 'have', 'does', 'that', 'this', 'your',
    'youre', 'please',
  ]);
  const promptTerms = new Set(
    (prompt.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
      .filter((term) => !stopWords.has(term)),
  );
  const relevantMemories = authorizedMemories
    .filter((memory) => {
      const searchable = `${memory.text || ''} ${(memory.tags || []).join(' ')} ${memory.kind || ''}`.toLowerCase();
      return [...promptTerms].some((term) => searchable.includes(term));
    })
    .slice(0, 5);
  const memoryContext = relevantMemories
    .map((memory) => `• [${String(memory.kind || 'memory').slice(0, 40)}] ${String(memory.text || '').slice(0, 500)}`)
    .join('\n');

  return { history, memoryContext };
}
