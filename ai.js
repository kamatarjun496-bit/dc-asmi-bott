import Groq from 'groq-sdk';
import { buildSystemPrompt } from './prompt.js';
import {
  getUserMemory,
  updateUserMemory,
  getConversationHistory,
  appendToHistory,
  formatMemoryForPrompt
} from './memory.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function extractMemoryUpdate(text) {
  const match = text.match(/<memory_update>\s*([\s\S]*?)\s*<\/memory_update>/);
  if (!match) return { clean: text, update: null };

  const clean = text.replace(/<memory_update>[\s\S]*?<\/memory_update>/g, '').trim();
  try {
    const update = JSON.parse(match[1]);
    return { clean, update };
  } catch {
    return { clean, update: null };
  }
}

export async function getAsmiReply(userId, username, userMessage) {
  const [memory, history] = await Promise.all([
    getUserMemory(userId, username),
    getConversationHistory(userId)
  ]);

  const memoryText = formatMemoryForPrompt(memory);
  const systemPrompt = buildSystemPrompt(memoryText);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1024,
    messages
  });

  const rawReply = response.choices[0]?.message?.content ?? "hmm something went wrong on my end... give me a second and try again? 😅";

  const { clean: reply, update } = extractMemoryUpdate(rawReply);

  await Promise.all([
    appendToHistory(userId, 'user', userMessage),
    appendToHistory(userId, 'assistant', reply),
    update ? updateUserMemory(userId, update) : Promise.resolve()
  ]);

  return reply;
}
